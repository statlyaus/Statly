import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createLocalAflTradeArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createGovernedPrivateEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import { createReadyFixtureGovernedPrivateEvaluationAuthorityInspection } from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationAuthoritySnapshot';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';
import {
  createGovernedPrivateEvaluationTransitionIntent,
  createGovernedPrivateEvaluationTransitionReceipt,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';
import { createPostgresGovernedPrivateEvaluationLifecycleRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationLifecycleRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_governed_lifecycle_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const selector = {
  valuationScopeKey: 'afl-trade-history:test-fixture',
  tradeId: 'trade:adelaide-st-kilda',
};
const client = createPgAflOutcomeSqlClient(pool);
let artifactRoot = '';
let artifactRepository: ReturnType<
  typeof createLocalAflTradeArtifactRepository
>;
let staging: ReturnType<typeof createPostgresGovernedPrivateEvaluationStagingRepository>;
let lifecycle: ReturnType<typeof createPostgresGovernedPrivateEvaluationLifecycleRepository>;

type Head = {
  readonly status: 'absent' | 'active' | 'withdrawn';
  readonly revision: number;
  readonly generationId: string | null;
};
type Action =
  | { readonly kind: 'construct_and_activate' }
  | { readonly kind: 'withdraw'; readonly reason: string }
  | { readonly kind: 'rollback'; readonly targetGenerationId: string }
  | { readonly kind: 'recover' };

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeAflTradeJson(value));
}

async function trustedNow(): Promise<string> {
  const result = await pool.query<{ trusted_at: Date }>(
    `SELECT date_trunc('milliseconds',clock_timestamp()) AS trusted_at`
  );
  return result.rows[0]!.trusted_at.toISOString();
}

async function retainJson(value: unknown, createdAt: string) {
  const reference = createAflTradeCanonicalJsonArtifactRef(value, createdAt);
  await staging.retainArtifact({ reference, bytes: canonicalBytes(value) });
  return reference;
}

async function seedPrivateEvaluationOperator(authorizedAt: string) {
  const principalId = 'firebase:test-operator';
  const authorityContent = {
    principalRef: principalId,
    role: 'afl_trade_private_evaluation_operator',
    scopeKey: selector.valuationScopeKey,
    provider: 'statly_modeling',
    capabilityId: 'manage_private_trade_evaluation',
    competition: 'AFLM',
    validFromSeason: 1897,
    validThroughSeason: 2200,
    validFrom: authorizedAt,
    validThrough: '2099-01-01T00:00:00.000Z',
  };
  const evidenceDocument = {
    evidenceKind: 'reviewer_authority_evidence',
    environment: 'test_fixture',
    ...authorityContent,
  };
  const artifact = await retainJson(evidenceDocument, authorizedAt);
  const authorityEvidenceId = createAflTradeContentAddress(
    'reviewer-authority-evidence',
    evidenceDocument
  );
  const decisionId = createAflTradeContentAddress('review-decision', {
    authorityEvidenceId,
    decision: 'approved',
    decidedAt: authorizedAt,
  });
  const authorityClient = await pool.connect();
  try {
    await authorityClient.query('BEGIN');
    await authorityClient.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'governed_evidence_reference',$2,'approved',$3,$4::jsonb,$5,$6)`,
      [
        decisionId,
        authorityEvidenceId,
        'Approve fixture operator authority for governed private lifecycle proof.',
        canonicalizeAflTradeJson({ artifact }),
        'fixture-governance-writer',
        authorizedAt,
      ]
    );
    await authorityClient.query(
      `INSERT INTO outcome_governed_evidence_reference
        (reference_id,reference_sha256,evidence_kind,artifact_id,environment,status,
         approval_decision_id,created_at,evidence_canonical_json,evidence_json)
       VALUES ($1,$2,'reviewer_authority_evidence',$3,'test_fixture','approved',$4,$5,$6,$7::jsonb)`,
      [
        authorityEvidenceId,
        authorityEvidenceId.slice('reviewer-authority-evidence:'.length),
        artifact.artifactId,
        decisionId,
        authorizedAt,
        canonicalizeAflTradeJson(evidenceDocument),
        canonicalizeAflTradeJson(evidenceDocument),
      ]
    );
    await authorityClient.query(
      `INSERT INTO outcome_operational_principal_authority
        (authority_evidence_id,principal_ref,role,scope_key,provider,capability_id,
         competition,valid_from_season,valid_through_season,valid_from,valid_through)
       VALUES ($1,$2,'afl_trade_private_evaluation_operator',$3,'statly_modeling',
               'manage_private_trade_evaluation','AFLM',1897,2200,$4,$5)`,
      [
        authorityEvidenceId,
        principalId,
        selector.valuationScopeKey,
        authorizedAt,
        '2099-01-01T00:00:00.000Z',
      ]
    );
    await authorityClient.query('COMMIT');
  } catch (error) {
    await authorityClient.query('ROLLBACK');
    throw error;
  } finally {
    authorityClient.release();
  }
}

async function seedInspection(head: Head, inspectedAt: string) {
  const validThrough = new Date(Date.parse(inspectedAt) + 300_000).toISOString();
  const retained = createReadyFixtureGovernedPrivateEvaluationAuthorityInspection({
    selector,
    head,
    capturedAt: inspectedAt,
    validThrough,
    lastTransitionId:
      head.status === 'absent'
        ? null
        : (
            await pool.query<{ last_transition_id: string }>(
              `SELECT last_transition_id FROM outcome_local_private_trade_evaluation_head
                WHERE valuation_scope_key=$1 AND trade_id=$2`,
              [selector.valuationScopeKey, selector.tradeId]
            )
          ).rows[0]!.last_transition_id,
    playerModelRunId: `model-run:${'1'.repeat(64)}`,
    pickModelRunId: `model-run:${'2'.repeat(64)}`,
  });
  const { snapshot, inspection } = retained;
  const snapshotArtifact = await retainJson(snapshot, inspectedAt);
  await pool.query(
    `INSERT INTO outcome_private_evaluation_authority_snapshot
      (snapshot_id,valuation_scope_key,trade_id,artifact_id,captured_at,valid_through,
       expected_head_status,expected_head_revision,expected_head_generation_id,
       content_sha256,content_canonical_json,snapshot_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      snapshot.snapshotId,
      selector.valuationScopeKey,
      selector.tradeId,
      snapshotArtifact.artifactId,
      inspectedAt,
      validThrough,
      head.status,
      head.revision,
      head.generationId,
      snapshot.snapshotId.slice('private-evaluation-authority-snapshot:'.length),
      canonicalizeAflTradeJson(snapshot.content),
      canonicalizeAflTradeJson(snapshot),
    ]
  );
  const inspectionArtifact = await retainJson(inspection, inspectedAt);
  await pool.query(
    `INSERT INTO outcome_private_evaluation_inspection_receipt
      (inspection_id,snapshot_id,valuation_scope_key,trade_id,artifact_id,state,
       inspected_at,valid_through,expected_head_status,expected_head_revision,
       expected_head_generation_id,content_sha256,content_canonical_json,receipt_json)
     VALUES ($1,$2,$3,$4,$5,'ready',$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      inspection.inspectionId,
      snapshot.snapshotId,
      selector.valuationScopeKey,
      selector.tradeId,
      inspectionArtifact.artifactId,
      inspectedAt,
      validThrough,
      head.status,
      head.revision,
      head.generationId,
      inspection.inspectionId.slice('private-evaluation-inspection:'.length),
      canonicalizeAflTradeJson(inspection.content),
      canonicalizeAflTradeJson(inspection),
    ]
  );
  return {
    inspectionId: inspection.inspectionId,
    snapshotId: snapshot.snapshotId,
    validThrough,
  };
}

async function transition(input: {
  readonly marker: string;
  readonly action: Action;
  readonly fromHead: Head;
  readonly previousTransitionId: string | null;
  readonly generationId?: string;
  readonly generationCreatedAt?: string;
}) {
  const requestedAt = await trustedNow();
  const inspection = await seedInspection(input.fromHead, requestedAt);
  const intent = createGovernedPrivateEvaluationTransitionIntent({
    selector,
    inspectionId: inspection.inspectionId,
    authoritySnapshotId: input.action.kind === 'withdraw' ? null : inspection.snapshotId,
    operationId: createAflTradeContentAddress('private-evaluation-operation', {
      marker: input.marker,
    }),
    action: input.action,
    expectedHead: input.fromHead,
    review: {
      principalId: 'firebase:test-operator',
      rationale: `Exercise ${input.action.kind} against disposable PostgreSQL.`,
    },
    requestedAt,
    expiresAt: inspection.validThrough,
  });
  const materialization =
    input.action.kind === 'construct_and_activate'
      ? createGovernedPrivateEvaluationGeneration({
          selector,
          transitionIntentId: intent.transitionIntentId,
          generatedAt: input.generationCreatedAt ?? requestedAt,
          narrative: createGovernedPrivateEvaluationNarrativeFixture(),
        })
      : undefined;
  const toGenerationId = materialization?.generation.generationId ?? input.generationId ?? null;
  const intentArtifact = createAflTradeCanonicalJsonArtifactRef(intent, requestedAt);
  await staging.stage({ intent, intentArtifact, materialization });
  const receipt = createGovernedPrivateEvaluationTransitionReceipt({
    intent,
    previousTransitionId: input.previousTransitionId,
    toGenerationId,
    transitionedAt: await trustedNow(),
  });
  const receiptArtifact = await retainJson(receipt, receipt.content.transitionedAt);
  const result = await lifecycle.commit({ receipt, receiptArtifact });
  return {
    result,
    receipt,
    receiptArtifact,
    generationId: toGenerationId!,
    generationCreatedAt: materialization?.generation.content.generatedAt,
  };
}

beforeAll(async () => {
  artifactRoot = await mkdtemp(join(tmpdir(), 'statly-governed-lifecycle-'));
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  artifactRepository = createLocalAflTradeArtifactRepository({
    rootDirectory: artifactRoot,
    repositoryId: 'governed-lifecycle-postgres-proof',
    artifactClass: 'derived_private',
    maximumObjectBytes: 4 * 1024 * 1024,
  });
  staging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client,
    artifactRepository,
    maximumArtifactBytes: 4 * 1024 * 1024,
  });
  lifecycle = createPostgresGovernedPrivateEvaluationLifecycleRepository({
    client,
    artifactRepository,
    maximumArtifactBytes: 4 * 1024 * 1024,
  });
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
  if (artifactRoot !== '') await rm(artifactRoot, { recursive: true, force: true });
});

describe('governed private evaluation PostgreSQL lifecycle', () => {
  it('stages, activates, exactly replays, withdraws, verifies, and blocks unavailable reactivation', async () => {
    const operatorAuthorizedAt = new Date(Date.parse(await trustedNow()) - 1_000).toISOString();
    await seedPrivateEvaluationOperator(operatorAuthorizedAt);
    const activation = await transition({
      marker: 'activate',
      action: { kind: 'construct_and_activate' },
      fromHead: { status: 'absent', revision: 0, generationId: null },
      previousTransitionId: null,
    });
    expect(activation.result).toMatchObject({ state: 'committed' });
    await expect(
      lifecycle.commit({
        receipt: activation.receipt,
        receiptArtifact: activation.receiptArtifact,
      })
    ).resolves.toMatchObject({ state: 'replayed' });

    const workspace = createPostgresGovernedPrivateEvaluationWorkspace({
      client,
      artifactRepository,
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:test-operator',
      authorizeReader: async ({ principalId }) => principalId === 'firebase:test-operator',
    });
    const withdrawalInspection = await workspace.inspect(selector);
    expect(withdrawalInspection).toMatchObject({
      state: 'unavailable',
      head: { status: 'active', revision: 1, generationId: activation.generationId },
      blockers: [{ code: 'insufficient_data' }],
    });
    const readerWorkspace = createPostgresGovernedPrivateEvaluationWorkspace({
      client,
      artifactRepository,
      maximumArtifactBytes: 4 * 1024 * 1024,
      principalId: 'firebase:registered-reader',
      authorizeReader: async ({ principalId }) => principalId === 'firebase:registered-reader',
    });
    await expect(
      readerWorkspace.execute({
        inspectionId: withdrawalInspection.inspectionId,
        operationId: createAflTradeContentAddress('private-evaluation-operation', {
          marker: 'registered-reader-withdrawal',
        }),
        action: { kind: 'withdraw', reason: 'Reader must not control lifecycle state.' },
        review: { rationale: 'Prove registered-reader lifecycle denial.' },
      })
    ).rejects.toThrow('current governed operator authority');
    const withdrawalOperationId = createAflTradeContentAddress('private-evaluation-operation', {
      marker: 'workspace-withdraw',
    });
    await expect(
      workspace.execute({
        inspectionId: withdrawalInspection.inspectionId,
        operationId: withdrawalOperationId,
        action: { kind: 'withdraw', reason: 'Fixture safety withdrawal.' },
        review: { rationale: 'Fail closed while component models are unavailable.' },
      })
    ).resolves.toMatchObject({
      state: 'withdrawn',
      head: { status: 'withdrawn', revision: 2, generationId: null },
    });
    const recoveryInspection = await workspace.inspect(selector);
    expect(recoveryInspection).toMatchObject({
      state: 'unavailable',
      head: { status: 'withdrawn', revision: 2, generationId: null },
      blockers: [{ code: 'insufficient_data' }],
    });
    await expect(
      workspace.execute({
        inspectionId: recoveryInspection.inspectionId,
        operationId: createAflTradeContentAddress('private-evaluation-operation', {
          marker: 'workspace-recover',
        }),
        action: { kind: 'recover' },
        review: { rationale: 'Unavailable real authority cannot recover a fixture grade.' },
      })
    ).resolves.toMatchObject({
      state: 'invalid_transition',
      message: 'Rollback and recovery require exact ready calculation authority.',
    });
    await expect(
      workspace.execute({
        inspectionId: recoveryInspection.inspectionId,
        operationId: createAflTradeContentAddress('private-evaluation-operation', {
          marker: 'verify-reconstruction',
        }),
        action: {
          kind: 'verify_reconstruction',
          generationId: activation.generationId,
        },
        review: { rationale: 'Verify the exact withdrawn derivation without reactivating it.' },
      })
    ).resolves.toMatchObject({
      state: 'reconstruction_verified',
      generationId: activation.generationId,
      exactMatch: true,
    });

    const withdrawnHead = await pool.query<{ last_transition_id: string }>(
      `SELECT last_transition_id FROM outcome_local_private_trade_evaluation_head
        WHERE valuation_scope_key=$1 AND trade_id=$2`,
      [selector.valuationScopeKey, selector.tradeId]
    );
    const replacement = await transition({
      marker: 'activate-replacement',
      action: { kind: 'construct_and_activate' },
      fromHead: {
        status: 'withdrawn',
        revision: 2,
        generationId: null,
      },
      previousTransitionId: withdrawnHead.rows[0]!.last_transition_id,
      generationCreatedAt: activation.generationCreatedAt,
    });
    expect(replacement.generationId).not.toBe(activation.generationId);

    const rollbackInspection = await workspace.inspect(selector);
    await expect(
      workspace.execute({
        inspectionId: rollbackInspection.inspectionId,
        operationId: createAflTradeContentAddress('private-evaluation-operation', {
          marker: 'workspace-rollback',
        }),
        action: { kind: 'rollback', targetGenerationId: activation.generationId },
        review: { rationale: 'Unavailable real authority cannot restore a fixture grade.' },
      })
    ).resolves.toMatchObject({
      state: 'invalid_transition',
      message: 'Rollback and recovery require exact ready calculation authority.',
    });

    const head = await pool.query(
      `SELECT valuation_scope_key,trade_id,revision,status,generation_id,last_transition_id
         FROM outcome_local_private_trade_evaluation_head`
    );
    expect(head.rows).toEqual([
      {
        valuation_scope_key: selector.valuationScopeKey,
        trade_id: selector.tradeId,
        revision: 3,
        status: 'active',
        generation_id: replacement.generationId,
        last_transition_id: replacement.receipt.transitionId,
      },
    ]);
    await expect(
      pool.query(`UPDATE outcome_private_evaluation_transition_receipt SET action='withdraw'`)
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query(
        `SELECT generation_id FROM outcome_local_private_trade_evaluation_generation
          WHERE valuation_scope_key=$1 AND trade_id=$2`,
        ['escaped-scope', selector.tradeId]
      )
    ).resolves.toMatchObject({ rows: [] });
  });
});
