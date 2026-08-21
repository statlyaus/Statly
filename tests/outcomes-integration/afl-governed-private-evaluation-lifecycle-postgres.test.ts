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
import {
  createLocalAflTradeArtifactRepository,
  createLocalAflTradePrivateDerivedArtifactRepository,
} from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  createAutomatedGovernedPrivateEvaluationGeneration,
  createGovernedPrivateEvaluationGeneration,
} from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import {
  createReadyFixtureGovernedPrivateEvaluationAuthorityInspection,
  createReadyGovernedPrivateEvaluationAuthorityInspectionV3,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationAuthoritySnapshot';
import { createPostgresGovernedPrivateEvaluationWorkspace } from '@/server/aflTradeIntelligence/valuation/internal/createPostgresGovernedPrivateEvaluationWorkspace';
import {
  createAutomatedGovernedPrivateEvaluationTransitionIntent,
  createAutomatedGovernedPrivateEvaluationTransitionReceipt,
  createGovernedPrivateEvaluationTransitionIntent,
  createGovernedPrivateEvaluationTransitionReceipt,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationLifecycle';
import { createPostgresGovernedPrivateEvaluationLifecycleRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationLifecycleRepository';
import { createPostgresGovernedPrivateEvaluationStagingRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationStagingRepository';
import {
  createGovernedPrivateEvaluationBatch,
  createGovernedPrivateEvaluationBatchOperationId,
} from '@/server/aflTradeIntelligence/valuation/internal/governedPrivateEvaluationBatch';
import { PostgresGovernedPrivateEvaluationBatchRepository } from '@/server/aflTradeIntelligence/valuation/internal/postgresGovernedPrivateEvaluationBatchRepository';
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
const fixtureGenerationCreatedAt = '2026-08-19T09:00:00.000Z';
const client = createPgAflOutcomeSqlClient(pool);
let artifactRoot = '';
let artifactRepository: ReturnType<
  typeof createLocalAflTradeArtifactRepository
>;
let staging: ReturnType<typeof createPostgresGovernedPrivateEvaluationStagingRepository>;
let lifecycle: ReturnType<typeof createPostgresGovernedPrivateEvaluationLifecycleRepository>;
let automatedStaging: ReturnType<
  typeof createPostgresGovernedPrivateEvaluationStagingRepository
>;
let automatedLifecycle: ReturnType<
  typeof createPostgresGovernedPrivateEvaluationLifecycleRepository
>;

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

function createAutomatedNarrativeFixture() {
  const fixture = createGovernedPrivateEvaluationNarrativeFixture();
  const content = {
    ...fixture.content,
    valuationCaseId: `valuation-case:${'e'.repeat(64)}`,
  };
  return {
    narrativeId: createAflTradeContentAddress('trade-calculation-narrative', content),
    content,
  };
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

async function seedPrivateEvaluationOperator(
  authorizedAt: string,
  options: {
    readonly principalId?: string;
    readonly validThrough?: string;
  } = {}
) {
  const principalId = options.principalId ?? 'firebase:test-operator';
  const validThrough = options.validThrough ?? '2099-01-01T00:00:00.000Z';
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
    validThrough,
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
        validThrough,
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

async function seedInspection(
  head: Head,
  inspectedAt: string,
  automated?: {
    readonly materializationManifestId: string;
    readonly materializationManifestArtifact: ReturnType<
      typeof createAflTradeCanonicalJsonArtifactRef
    >;
    readonly valuationInputBundleArtifact: ReturnType<
      typeof createAflTradeCanonicalJsonArtifactRef
    >;
  },
  targetSelector = selector
) {
  const validThrough = new Date(Date.parse(inspectedAt) + 300_000).toISOString();
  const lastTransitionId =
      head.status === 'absent'
        ? null
        : (
            await pool.query<{ last_transition_id: string }>(
              `SELECT last_transition_id FROM outcome_local_private_trade_evaluation_head
                WHERE valuation_scope_key=$1 AND trade_id=$2`,
              [targetSelector.valuationScopeKey, targetSelector.tradeId]
            )
          ).rows[0]!.last_transition_id;
  const retained = automated === undefined
    ? createReadyFixtureGovernedPrivateEvaluationAuthorityInspection({
        selector: targetSelector,
        head,
        capturedAt: inspectedAt,
        validThrough,
        lastTransitionId,
        playerModelRunId: `model-run:${'1'.repeat(64)}`,
        pickModelRunId: `model-run:${'2'.repeat(64)}`,
      })
    : createReadyGovernedPrivateEvaluationAuthorityInspectionV3({
        selector: targetSelector,
        head,
        capturedAt: inspectedAt,
        validThrough,
        lastTransitionId,
        preparedInputHeadRevision: 1,
        preparedInputSetId: `prepared-valuation-input-set:${'3'.repeat(64)}`,
        factualRegistryRevision: 1,
        factualReleaseId: `outcome-release:${'4'.repeat(64)}`,
        activeFactualReleaseRevision: 1,
        privateValuationDecisionId:
          `private-valuation-evaluation-decision:${'5'.repeat(64)}`,
        privateValuationDecisionRevision: 1,
        materializationManifestId: automated.materializationManifestId,
        materializationManifestArtifact: automated.materializationManifestArtifact,
        valuationInputBundleId: `valuation-input-bundle:${'6'.repeat(64)}`,
        valuationInputBundleArtifact: automated.valuationInputBundleArtifact,
        gateLedgerRevision: 2,
        components: [
          {
            role: 'player_contribution_and_availability',
            runId: `model-run:${'7'.repeat(64)}`,
            protocolId: `model-protocol:${'8'.repeat(64)}`,
            datasetId: `dataset:${'9'.repeat(64)}`,
            datasetAdmissionId: `dataset-admission:${'a'.repeat(64)}`,
            datasetAdmissionGateLedgerRevision: 1,
            gate3DecisionId: `gate-decision:${'b'.repeat(64)}`,
            gate3DecisionVersion: 1,
            qualificationId: `model-qualification:${'c'.repeat(64)}`,
            qualificationPolicyVersion: `model-qualification-policy:${'d'.repeat(64)}`,
          },
          {
            role: 'draft_pick_and_future_pick_distribution',
            runId: `model-run:${'e'.repeat(64)}`,
            protocolId: `model-protocol:${'f'.repeat(64)}`,
            datasetId: `dataset:${'0'.repeat(64)}`,
            datasetAdmissionId: `dataset-admission:${'1'.repeat(64)}`,
            datasetAdmissionGateLedgerRevision: 2,
            gate3DecisionId: `gate-decision:${'2'.repeat(64)}`,
            gate3DecisionVersion: 1,
            qualificationId: `model-qualification:${'c'.repeat(64)}`,
            qualificationPolicyVersion: `model-qualification-policy:${'d'.repeat(64)}`,
          },
        ],
      });
  const { snapshot, inspection } = retained;
  if (automated !== undefined) {
    const authority = snapshot.content.calculationAuthority;
    if (authority.state !== 'ready' || !('materializationManifestId' in authority)) {
      throw new Error('Automated lifecycle fixture requires ready v3 authority.');
    }
    await automatedStaging.retainArtifact({
      reference: authority.materializationManifestArtifact,
      bytes: canonicalBytes({ manifestId: authority.materializationManifestId, kind: 'authenticated-materialization' }),
    });
    await automatedStaging.retainArtifact({
      reference: authority.valuationInputBundleArtifact,
      bytes: canonicalBytes({ kind: 'valuation-input-bundle' }),
    });
    const seed = await pool.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SET LOCAL session_replication_role='replica'`);
      await seed.query(
        `INSERT INTO outcome_prepared_valuation_input_set
          (prepared_input_set_id,content_sha256,schema_version,environment,scope_key,
           factual_release_scope_key,factual_release_id,qualification_report_id,trade_count,
           ready_count,blocked_count,prepared_at,content_canonical_json,
           prepared_set_canonical_json,prepared_set_json,finalized_at)
         VALUES ($1,$2,'afl-trade-prepared-valuation-input-set/v3','non_production',$3,
                 'fixture-release-scope',$5,$6,1,1,0,$4,
                 '{}','{}','{}'::jsonb,$4)
         ON CONFLICT DO NOTHING`,
        [authority.preparedInputSetId, authority.preparedInputSetId.slice(
          'prepared-valuation-input-set:'.length
        ), targetSelector.valuationScopeKey, inspectedAt,
          `outcome-release:${'4'.repeat(64)}`,
          `valuation-source-qualification:${'5'.repeat(64)}`]
      );
      await seed.query(
        `INSERT INTO outcome_prepared_valuation_input_entry
         (prepared_input_set_id,ordinal,trade_id,state,entry_canonical_json,entry_json)
         VALUES ($1,1,$2,'ready','{}',$3::jsonb)
         ON CONFLICT DO NOTHING`,
        [authority.preparedInputSetId, targetSelector.tradeId,
          JSON.stringify({ materializationManifestId: authority.materializationManifestId })]
      );
      await seed.query(
        `INSERT INTO outcome_private_evaluation_materialization_manifest
          (materialization_manifest_id,content_sha256,valuation_scope_key,trade_id,
           artifact_id,created_at,content_canonical_json,manifest_canonical_json,manifest_json)
        VALUES ($1,$2,$3,$4,$5,$6,'{}','{}',$7::jsonb)
        ON CONFLICT DO NOTHING`,
        [authority.materializationManifestId,
          authority.materializationManifestId.slice(
            'private-evaluation-materialization-manifest:'.length
          ),
          targetSelector.valuationScopeKey,targetSelector.tradeId,
          authority.materializationManifestArtifact.artifactId,inspectedAt,
          JSON.stringify({ content: {
            valuationInputBundleId: authority.valuationInputBundleId,
            valuationInputBundleArtifact: authority.valuationInputBundleArtifact,
          } })]
      );
      await seed.query(
        `INSERT INTO outcome_current_prepared_valuation_input_set
          (scope_key,prepared_input_set_id,revision,activated_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [targetSelector.valuationScopeKey, authority.preparedInputSetId,
          authority.preparedInputHeadRevision, inspectedAt]
      );
      for (const [index, component] of authority.components.entries()) {
        await seed.query(
          `INSERT INTO outcome_governed_valuation_component_run
            (run_id,role,native_execution_kind,native_execution_id,artifact_id,
             native_execution_artifact_id,protocol_id,protocol_artifact_id,dataset_id,
             dataset_artifact_id,dataset_admission_id,dataset_admission_artifact_id,
             dataset_admission_gate_ledger_revision,registered_at,content_sha256,
             content_canonical_json,manifest_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'{}','{}'::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            component.runId,
            component.role,
            component.role === 'player_contribution_and_availability'
              ? 'admitted_player_model_run'
              : 'pick_pav_model_execution',
            component.role === 'player_contribution_and_availability'
              ? `model-run:${'5'.repeat(64)}`
              : `pick-pav-model-execution:${'6'.repeat(64)}`,
            `artifact:${(index === 0 ? '7' : '8').repeat(64)}`,
            `artifact:${(index === 0 ? '9' : 'a').repeat(64)}`,
            component.protocolId,
            `artifact:${(index === 0 ? 'b' : 'c').repeat(64)}`,
            component.datasetId,
            `artifact:${(index === 0 ? 'd' : 'e').repeat(64)}`,
            component.datasetAdmissionId,
            `artifact:${(index === 0 ? 'f' : '0').repeat(64)}`,
            component.datasetAdmissionGateLedgerRevision,
            inspectedAt,
            component.runId.slice('model-run:'.length),
          ]
        );
        const proposalId = `gate-proposal:${(index === 0 ? '1' : '2').repeat(64)}`;
        const decisionKey = `automated-private-fixture-${index}`;
        await seed.query(
          `INSERT INTO outcome_gate_decision
            (decision_id,proposal_id,gate,decision_key,version,environment,state,
             decided_at,effective_at,revalidate_at,supersedes_decision_id,decision_json)
           VALUES ($1,$2,'gate_3_model_approval',$3,$4,'non_production','approved',
                   $5,$5,'2099-01-01T00:00:00.000Z',NULL,$6::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            component.gate3DecisionId,
            proposalId,
            decisionKey,
            component.gate3DecisionVersion,
            inspectedAt,
            canonicalizeAflTradeJson({
              decisionId: component.gate3DecisionId,
              content: {
                schemaVersion: 'afl-trade-gate-decision/v1',
                proposalId,
                gate: 'gate_3_model_approval',
                decisionKey,
                version: component.gate3DecisionVersion,
                environment: 'non_production',
                state: 'approved',
                supersedesDecisionId: null,
              },
            }),
          ]
        );
      }
      await seed.query(
        `INSERT INTO outcome_governed_valuation_model_qualification
          (qualification_id,scope_key,outcome,artifact_id,player_run_id,pick_run_id,
           policy_artifact_id,player_criteria_artifact_id,pick_criteria_artifact_id,
           player_evidence_artifact_id,pick_evidence_artifact_id,evaluated_at,
           content_sha256,content_canonical_json,qualification_json)
         VALUES ($1,$2,'qualified',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}',$13::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          authority.components[0]!.qualificationId,
          targetSelector.valuationScopeKey,
          `artifact:${'1'.repeat(64)}`,
          authority.components[0]!.runId,
          authority.components[1]!.runId,
          `artifact:${'2'.repeat(64)}`,
          `artifact:${'3'.repeat(64)}`,
          `artifact:${'4'.repeat(64)}`,
          `artifact:${'5'.repeat(64)}`,
          `artifact:${'6'.repeat(64)}`,
          inspectedAt,
          'c'.repeat(64),
          canonicalizeAflTradeJson({
            content: {
              policy: {
                policyVersion: authority.components[0]!.qualificationPolicyVersion,
              },
            },
          }),
        ]
      );
      await seed.query(
        `INSERT INTO outcome_current_governed_valuation_model_pair
          (scope_key,revision,qualification_id,player_run_id,pick_run_id,
           player_gate3_decision_id,pick_gate3_decision_id,work_id,advanced_at)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [targetSelector.valuationScopeKey, authority.components[0]!.qualificationId,
          authority.components[0]!.runId,authority.components[1]!.runId,
          authority.components[0]!.gate3DecisionId,authority.components[1]!.gate3DecisionId,
          `model-qualification-work:${'4'.repeat(64)}`,inspectedAt]
      );
      await seed.query('COMMIT');
    } catch (error) {
      await seed.query('ROLLBACK');
      throw error;
    } finally {
      seed.release();
    }
  }
  const retainInspectionDocument = async (document: unknown) => {
    if (automated === undefined) return retainJson(document, inspectedAt);
    const reference = createAflTradeCanonicalJsonArtifactRef(document, inspectedAt);
    await automatedStaging.retainArtifact({
      reference,
      bytes: canonicalBytes(document),
    });
    return reference;
  };
  const snapshotArtifact = await retainInspectionDocument(snapshot);
  await pool.query(
    `INSERT INTO outcome_private_evaluation_authority_snapshot
      (snapshot_id,valuation_scope_key,trade_id,artifact_id,captured_at,valid_through,
       expected_head_status,expected_head_revision,expected_head_generation_id,
       content_sha256,content_canonical_json,snapshot_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      snapshot.snapshotId,
      targetSelector.valuationScopeKey,
      targetSelector.tradeId,
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
  const inspectionArtifact = await retainInspectionDocument(inspection);
  await pool.query(
    `INSERT INTO outcome_private_evaluation_inspection_receipt
      (inspection_id,snapshot_id,valuation_scope_key,trade_id,artifact_id,state,
       inspected_at,valid_through,expected_head_status,expected_head_revision,
       expected_head_generation_id,content_sha256,content_canonical_json,receipt_json)
     VALUES ($1,$2,$3,$4,$5,'ready',$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    [
      inspection.inspectionId,
      snapshot.snapshotId,
      targetSelector.valuationScopeKey,
      targetSelector.tradeId,
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
    snapshot,
    inspection,
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
          generatedAt: input.generationCreatedAt ?? fixtureGenerationCreatedAt,
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
    automatedPrincipalId: 'system:weekly-valuation-coordinator',
  });
  lifecycle = createPostgresGovernedPrivateEvaluationLifecycleRepository({
    client,
    artifactRepository,
    maximumArtifactBytes: 4 * 1024 * 1024,
    automatedPrincipalId: 'system:weekly-valuation-coordinator',
  });
  const automatedArtifactRepository = createLocalAflTradePrivateDerivedArtifactRepository({
    rootDirectory: artifactRoot,
    repositoryId: 'governed-automated-lifecycle-postgres-proof',
    maximumObjectBytes: 4 * 1024 * 1024,
  });
  automatedStaging = createPostgresGovernedPrivateEvaluationStagingRepository({
    client,
    artifactRepository: automatedArtifactRepository,
    maximumArtifactBytes: 4 * 1024 * 1024,
    automatedPrincipalId: 'system:weekly-valuation-coordinator',
  });
  automatedLifecycle = createPostgresGovernedPrivateEvaluationLifecycleRepository({
    client,
    artifactRepository: automatedArtifactRepository,
    maximumArtifactBytes: 4 * 1024 * 1024,
    automatedPrincipalId: 'system:weekly-valuation-coordinator',
  });
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
  if (artifactRoot !== '') await rm(artifactRoot, { recursive: true, force: true });
});

describe('governed private evaluation PostgreSQL lifecycle', () => {
  it('stages and exactly resumes one automated non-production generation', async () => {
    const trustedAt = await trustedNow();
    const expiredRequestedAt = new Date(
      Date.parse(trustedAt) - 10 * 60 * 1_000
    ).toISOString();
    const automatedSelector = {
      ...selector,
      valuationScopeKey: 'afl-trade-history:automated-non-production',
    };
    const manifestId =
      `private-evaluation-materialization-manifest:${'3'.repeat(64)}`;
    const automatedAuthorityEvidence = {
      materializationManifestId: manifestId,
      materializationManifestArtifact: createAflTradeCanonicalJsonArtifactRef(
        { manifestId, kind: 'authenticated-materialization' },
        expiredRequestedAt
      ),
      valuationInputBundleArtifact: createAflTradeCanonicalJsonArtifactRef(
        { kind: 'valuation-input-bundle' },
        expiredRequestedAt
      ),
    };
    const expiredInspection = await seedInspection(
      { status: 'absent', revision: 0, generationId: null },
      expiredRequestedAt,
      automatedAuthorityEvidence,
      automatedSelector
    );
    const constructionAuthority = {
      kind: 'automated_private_calculation_agent' as const,
      principalId: 'system:weekly-valuation-coordinator',
    };
    const expiredIntent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
      selector: automatedSelector,
      inspectionId: expiredInspection.inspectionId,
      authoritySnapshotId: expiredInspection.snapshotId,
      operationId: createAflTradeContentAddress('private-evaluation-operation', {
        marker: 'expired-automated-stage',
      }),
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      constructionAuthority,
      requestedAt: expiredRequestedAt,
      expiresAt: expiredInspection.validThrough,
    });
    const expiredMaterialization = createAutomatedGovernedPrivateEvaluationGeneration({
      selector: automatedSelector,
      transitionIntentId: expiredIntent.transitionIntentId,
      generatedAt: fixtureGenerationCreatedAt,
      constructionAuthority,
      narrative: createAutomatedNarrativeFixture(),
    });
    await automatedStaging.stage({
      intent: expiredIntent,
      intentArtifact: createAflTradeCanonicalJsonArtifactRef(
        expiredIntent,
        expiredRequestedAt
      ),
      materialization: expiredMaterialization,
    });
    const expiredTransitionedAt = new Date(
      Date.parse(expiredRequestedAt) + 1_000
    ).toISOString();
    const expiredReceipt = createAutomatedGovernedPrivateEvaluationTransitionReceipt({
      intent: expiredIntent,
      previousTransitionId: null,
      toGenerationId: expiredMaterialization.generation.generationId,
      transitionedAt: expiredTransitionedAt,
    });
    const expiredReceiptArtifact = createAflTradeCanonicalJsonArtifactRef(
      expiredReceipt,
      expiredTransitionedAt
    );
    await automatedStaging.retainArtifact({
      reference: expiredReceiptArtifact,
      bytes: canonicalBytes(expiredReceipt),
    });
    await expect(pool.query(
      `INSERT INTO outcome_private_evaluation_transition_receipt
        (transition_id,transition_intent_id,operation_id,valuation_scope_key,trade_id,
         artifact_id,action,from_revision,from_status,from_generation_id,to_revision,
         to_status,to_generation_id,transitioned_at,content_sha256,content_canonical_json,
         receipt_json)
       VALUES ($1,$2,$3,$4,$5,$6,'construct_and_activate',0,'absent',NULL,1,
               'active',$7,$8,$9,$10,$11::jsonb)`,
      [
        expiredReceipt.transitionId,
        expiredIntent.transitionIntentId,
        expiredIntent.content.operationId,
        automatedSelector.valuationScopeKey,
        automatedSelector.tradeId,
        expiredReceiptArtifact.artifactId,
        expiredMaterialization.generation.generationId,
        expiredTransitionedAt,
        expiredReceipt.transitionId.slice('private-evaluation-transition:'.length),
        canonicalizeAflTradeJson(expiredReceipt.content),
        canonicalizeAflTradeJson(expiredReceipt),
      ]
    )).rejects.toThrow(/PostgreSQL authority authentication/i);
    const requestedAt = await trustedNow();
    const inspection = await seedInspection(
      { status: 'absent', revision: 0, generationId: null },
      requestedAt,
      automatedAuthorityEvidence,
      automatedSelector
    );
    const intent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
      selector: automatedSelector,
      inspectionId: inspection.inspectionId,
      authoritySnapshotId: inspection.snapshotId,
      operationId: createAflTradeContentAddress('private-evaluation-operation', {
        marker: 'automated-stage',
      }),
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      constructionAuthority,
      requestedAt,
      expiresAt: inspection.validThrough,
    });
    const materialization = createAutomatedGovernedPrivateEvaluationGeneration({
      selector: automatedSelector,
      transitionIntentId: intent.transitionIntentId,
      generatedAt: fixtureGenerationCreatedAt,
      constructionAuthority,
      narrative: createAutomatedNarrativeFixture(),
    });
    await expect(pool.query<{ authenticated: boolean }>(
      `SELECT validate_outcome_automated_ready_calculation_authority(
        $1::jsonb,$2,$3
      ) AS authenticated`,
      [
        canonicalizeAflTradeJson(inspection.snapshot.content.calculationAuthority),
        automatedSelector.valuationScopeKey,
        automatedSelector.tradeId,
      ]
    )).resolves.toMatchObject({ rows: [{ authenticated: true }] });
    const fabricatedCalculationAuthority = {
      ...inspection.snapshot.content.calculationAuthority,
      components: inspection.snapshot.content.calculationAuthority.components.map(
        (component) => ({
          ...component,
          qualificationPolicyVersion: `model-qualification-policy:${'f'.repeat(64)}`,
          gate3DecisionVersion: component.gate3DecisionVersion + 1,
        })
      ),
    };
    const fabricatedSnapshotContent = {
      ...inspection.snapshot.content,
      calculationAuthority: fabricatedCalculationAuthority,
    };
    const fabricatedSnapshot = {
      snapshotId: createAflTradeContentAddress(
        'private-evaluation-authority-snapshot',
        fabricatedSnapshotContent
      ),
      content: fabricatedSnapshotContent,
    };
    const fabricatedSnapshotArtifact = createAflTradeCanonicalJsonArtifactRef(
      fabricatedSnapshot,
      requestedAt
    );
    await automatedStaging.retainArtifact({
      reference: fabricatedSnapshotArtifact,
      bytes: canonicalBytes(fabricatedSnapshot),
    });
    await pool.query(
      `INSERT INTO outcome_private_evaluation_authority_snapshot
        (snapshot_id,valuation_scope_key,trade_id,artifact_id,captured_at,valid_through,
         expected_head_status,expected_head_revision,expected_head_generation_id,
         content_sha256,content_canonical_json,snapshot_json)
       VALUES ($1,$2,$3,$4,$5,$6,'absent',0,NULL,$7,$8,$9::jsonb)`,
      [
        fabricatedSnapshot.snapshotId,
        automatedSelector.valuationScopeKey,
        automatedSelector.tradeId,
        fabricatedSnapshotArtifact.artifactId,
        requestedAt,
        inspection.validThrough,
        fabricatedSnapshot.snapshotId.slice(
          'private-evaluation-authority-snapshot:'.length
        ),
        canonicalizeAflTradeJson(fabricatedSnapshotContent),
        canonicalizeAflTradeJson(fabricatedSnapshot),
      ]
    );
    const fabricatedInspectionContent = {
      ...inspection.inspection.content,
      snapshotId: fabricatedSnapshot.snapshotId,
      calculationAuthority: fabricatedCalculationAuthority,
    };
    const fabricatedInspection = {
      inspectionId: createAflTradeContentAddress(
        'private-evaluation-inspection',
        fabricatedInspectionContent
      ),
      content: fabricatedInspectionContent,
    };
    const fabricatedInspectionArtifact = createAflTradeCanonicalJsonArtifactRef(
      fabricatedInspection,
      requestedAt
    );
    await automatedStaging.retainArtifact({
      reference: fabricatedInspectionArtifact,
      bytes: canonicalBytes(fabricatedInspection),
    });
    await pool.query(
      `INSERT INTO outcome_private_evaluation_inspection_receipt
        (inspection_id,snapshot_id,valuation_scope_key,trade_id,artifact_id,state,
         inspected_at,valid_through,expected_head_status,expected_head_revision,
         expected_head_generation_id,content_sha256,content_canonical_json,receipt_json)
       VALUES ($1,$2,$3,$4,$5,'ready',$6,$7,'absent',0,NULL,$8,$9,$10::jsonb)`,
      [
        fabricatedInspection.inspectionId,
        fabricatedSnapshot.snapshotId,
        automatedSelector.valuationScopeKey,
        automatedSelector.tradeId,
        fabricatedInspectionArtifact.artifactId,
        requestedAt,
        inspection.validThrough,
        fabricatedInspection.inspectionId.slice('private-evaluation-inspection:'.length),
        canonicalizeAflTradeJson(fabricatedInspectionContent),
        canonicalizeAflTradeJson(fabricatedInspection),
      ]
    );
    const fabricatedIntent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
      ...intent.content,
      inspectionId: fabricatedInspection.inspectionId,
      authoritySnapshotId: fabricatedSnapshot.snapshotId,
    });
    const fabricatedIntentArtifact = createAflTradeCanonicalJsonArtifactRef(
      fabricatedIntent,
      requestedAt
    );
    await automatedStaging.retainArtifact({
      reference: fabricatedIntentArtifact,
      bytes: canonicalBytes(fabricatedIntent),
    });
    await expect(pool.query(
      `INSERT INTO outcome_private_evaluation_transition_intent
        (transition_intent_id,inspection_id,authority_snapshot_id,operation_id,
         valuation_scope_key,trade_id,artifact_id,action,expected_head_status,
         expected_head_revision,expected_head_generation_id,target_generation_id,
         requested_at,expires_at,content_sha256,content_canonical_json,intent_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'construct_and_activate','absent',0,NULL,NULL,
               $8,$9,$10,$11,$12::jsonb)`,
      [
        fabricatedIntent.transitionIntentId,
        fabricatedInspection.inspectionId,
        fabricatedSnapshot.snapshotId,
        fabricatedIntent.content.operationId,
        automatedSelector.valuationScopeKey,
        automatedSelector.tradeId,
        fabricatedIntentArtifact.artifactId,
        requestedAt,
        inspection.validThrough,
        fabricatedIntent.transitionIntentId.slice(
          'private-evaluation-transition-intent:'.length
        ),
        canonicalizeAflTradeJson(fabricatedIntent.content),
        canonicalizeAflTradeJson(fabricatedIntent),
      ]
    )).rejects.toThrow(/invalid inspection authority/i);
    const intentArtifact = createAflTradeCanonicalJsonArtifactRef(intent, requestedAt);
    const forgedIntent = createAutomatedGovernedPrivateEvaluationTransitionIntent({
      ...intent.content,
      constructionAuthority: {
        kind: 'automated_private_calculation_agent',
        principalId: 'system:unconfigured-agent',
      },
    });
    const forgedArtifact = createAflTradeCanonicalJsonArtifactRef(forgedIntent, requestedAt);
    await automatedStaging.retainArtifact({
      reference: forgedArtifact,
      bytes: canonicalBytes(forgedIntent),
    });
    await expect(
      pool.query(
        `INSERT INTO outcome_private_evaluation_transition_intent
          (transition_intent_id,inspection_id,authority_snapshot_id,operation_id,
           valuation_scope_key,trade_id,artifact_id,action,expected_head_status,
           expected_head_revision,expected_head_generation_id,target_generation_id,
           requested_at,expires_at,content_sha256,content_canonical_json,intent_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'construct_and_activate','absent',0,NULL,NULL,
                 $8,$9,$10,$11,$12::jsonb)`,
        [
          forgedIntent.transitionIntentId,
          forgedIntent.content.inspectionId,
          forgedIntent.content.authoritySnapshotId,
          forgedIntent.content.operationId,
          forgedIntent.content.selector.valuationScopeKey,
          forgedIntent.content.selector.tradeId,
          forgedArtifact.artifactId,
          forgedIntent.content.requestedAt,
          forgedIntent.content.expiresAt,
          forgedIntent.transitionIntentId.slice('private-evaluation-transition-intent:'.length),
          canonicalizeAflTradeJson(forgedIntent.content),
          canonicalizeAflTradeJson(forgedIntent),
        ]
      )
    ).rejects.toThrow(/invalid shape or column binding/i);

    const staged = await automatedStaging.stage({ intent, intentArtifact, materialization });
    expect(staged).toMatchObject({
      transitionIntentId: intent.transitionIntentId,
      generationId: materialization.generation.generationId,
    });
    const receipt = createAutomatedGovernedPrivateEvaluationTransitionReceipt({
      intent,
      previousTransitionId: null,
      toGenerationId: materialization.generation.generationId,
      transitionedAt: requestedAt,
    });
    const receiptArtifact = createAflTradeCanonicalJsonArtifactRef(receipt, requestedAt);
    await automatedStaging.retainArtifact({
      reference: receiptArtifact,
      bytes: canonicalBytes(receipt),
    });
    await expect(
      automatedLifecycle.commitAutomated({ receipt, receiptArtifact })
    ).resolves.toMatchObject({
      state: 'committed',
      head: {
        status: 'active',
        revision: 1,
        generationId: materialization.generation.generationId,
      },
    });
    await expect(
      automatedLifecycle.commitAutomated({ receipt, receiptArtifact })
    ).resolves.toMatchObject({ state: 'replayed' });
    const batchAuthoritySeed = await pool.connect();
    try {
      await batchAuthoritySeed.query('BEGIN');
      await batchAuthoritySeed.query(`SET LOCAL session_replication_role='replica'`);
      await batchAuthoritySeed.query(
        `INSERT INTO outcome_release_manifest
          (release_id,scope_key,environment,created_at,effective_through,manifest_json)
         VALUES ($1,'fixture-release-scope','non_production',$2,$2,'{}'::jsonb)
         ON CONFLICT DO NOTHING`,
        [`outcome-release:${'4'.repeat(64)}`, requestedAt]
      );
      await batchAuthoritySeed.query(
        `INSERT INTO outcome_active_release(scope_key,release_id,activated_at,revision)
         VALUES ('fixture-release-scope',$1,$2,1) ON CONFLICT DO NOTHING`,
        [`outcome-release:${'4'.repeat(64)}`, requestedAt]
      );
      await batchAuthoritySeed.query(
        `INSERT INTO outcome_governed_model_qualification_work
          (work_id,scope_key,qualification_id,player_gate3_decision_id,
           pick_gate3_decision_id,available_at,status,work_json)
         VALUES ($1,$2,$3,$4,$5,$6,'pending','{}'::jsonb) ON CONFLICT DO NOTHING`,
        [
          `model-qualification-work:${'4'.repeat(64)}`,
          automatedSelector.valuationScopeKey,
          `model-qualification:${'c'.repeat(64)}`,
          `gate-decision:${'b'.repeat(64)}`,
          `gate-decision:${'2'.repeat(64)}`,
          requestedAt,
        ]
      );
      await batchAuthoritySeed.query('COMMIT');
    } finally {
      batchAuthoritySeed.release();
    }
    const readyBatch = createGovernedPrivateEvaluationBatch({
      scopeKey: automatedSelector.valuationScopeKey,
      preparedInputSetId: `prepared-valuation-input-set:${'3'.repeat(64)}`,
      preparedInputSetRevision: 1,
      factualReleaseId: `outcome-release:${'4'.repeat(64)}`,
      modelQualificationId: `model-qualification:${'c'.repeat(64)}`,
      modelQualificationWorkId: `model-qualification-work:${'4'.repeat(64)}`,
      entries: [{
        tradeId: automatedSelector.tradeId,
        state: 'ready',
        generationId: materialization.generation.generationId,
      }],
      createdAt: requestedAt,
    });
    const batchRepository = new PostgresGovernedPrivateEvaluationBatchRepository(
      client,
      async () => true
    );
    await expect(batchRepository.register(readyBatch)).resolves.toEqual(readyBatch);
    await expect(batchRepository.advance({
      scopeKey: readyBatch.content.scopeKey,
      batchId: readyBatch.batchId,
      expectedRevision: 0,
      operationId: createGovernedPrivateEvaluationBatchOperationId({
        scopeKey: readyBatch.content.scopeKey,
        batchId: readyBatch.batchId,
        expectedRevision: 0,
        action: 'activate',
      }),
      action: 'activate',
    })).resolves.toMatchObject({ batchId: readyBatch.batchId, revision: 1 });
    const wrongPredecessorContent = {
      ...receipt.content,
      previousTransitionId: `private-evaluation-transition:${'f'.repeat(64)}`,
    };
    const wrongPredecessorReceipt = {
      transitionId: createAflTradeContentAddress(
        'private-evaluation-transition',
        wrongPredecessorContent
      ),
      content: wrongPredecessorContent,
    };
    const wrongPredecessorArtifact = createAflTradeCanonicalJsonArtifactRef(
      wrongPredecessorReceipt,
      requestedAt
    );
    await automatedStaging.retainArtifact({
      reference: wrongPredecessorArtifact,
      bytes: canonicalBytes(wrongPredecessorReceipt),
    });
    await expect(pool.query(
      `INSERT INTO outcome_private_evaluation_transition_receipt
        (transition_id,transition_intent_id,operation_id,valuation_scope_key,trade_id,
         artifact_id,action,from_revision,from_status,from_generation_id,to_revision,
         to_status,to_generation_id,transitioned_at,content_sha256,content_canonical_json,
         receipt_json)
       VALUES ($1,$2,$3,$4,$5,$6,'construct_and_activate',0,'absent',NULL,1,
               'active',$7,$8,$9,$10,$11::jsonb)`,
      [
        wrongPredecessorReceipt.transitionId,
        intent.transitionIntentId,
        intent.content.operationId,
        automatedSelector.valuationScopeKey,
        automatedSelector.tradeId,
        wrongPredecessorArtifact.artifactId,
        materialization.generation.generationId,
        requestedAt,
        wrongPredecessorReceipt.transitionId.slice(
          'private-evaluation-transition:'.length
        ),
        canonicalizeAflTradeJson(wrongPredecessorContent),
        canonicalizeAflTradeJson(wrongPredecessorReceipt),
      ]
    )).rejects.toThrow(/PostgreSQL authority authentication/i);
    await expect(
      automatedStaging.stage({ intent, intentArtifact, materialization })
    ).resolves.toMatchObject({
      generationId: materialization.generation.generationId,
    });
    const retained = await pool.query<{ intent_version: string; generation_version: string }>(
      `SELECT intent.intent_json->'content'->>'schemaVersion' AS intent_version,
              generation.generation_json->'content'->>'schemaVersion' AS generation_version
         FROM outcome_private_evaluation_transition_intent intent
         JOIN outcome_local_private_trade_evaluation_generation generation
           ON generation.transition_intent_id=intent.transition_intent_id
        WHERE intent.operation_id=$1`,
      [intent.content.operationId]
    );
    expect(retained.rows).toEqual([{
      intent_version: 'private-evaluation-transition-intent/v2',
      generation_version: 'local-private-trade-evaluation-generation/v2',
    }]);
    await expect(
      pool.query(
        `SELECT revision,status,generation_id
           FROM outcome_local_private_trade_evaluation_head
          WHERE valuation_scope_key=$1 AND trade_id=$2`,
        [automatedSelector.valuationScopeKey, automatedSelector.tradeId]
      )
    ).resolves.toMatchObject({
      rows: [{
        revision: 1,
        status: 'active',
        generation_id: materialization.generation.generationId,
      }],
    });
    await expect(
      pool.query(
        `UPDATE outcome_local_private_trade_evaluation_head
            SET revision=revision+1
          WHERE valuation_scope_key=$1 AND trade_id=$2`,
        [automatedSelector.valuationScopeKey, automatedSelector.tradeId]
      )
    ).rejects.toThrow(/exact retained receipt/i);
  });

  it('stages, activates, exactly replays, withdraws, verifies, and blocks unavailable reactivation', async () => {
    const currentTrustedAt = await trustedNow();
    const expiredOperatorRequestedAt = new Date(
      Date.parse(currentTrustedAt) - 2 * 60 * 1_000
    ).toISOString();
    const expiredOperatorValidFrom = new Date(
      Date.parse(currentTrustedAt) - 5 * 60 * 1_000
    ).toISOString();
    const expiredOperatorValidThrough = new Date(
      Date.parse(currentTrustedAt) - 60 * 1_000
    ).toISOString();
    await seedPrivateEvaluationOperator(expiredOperatorValidFrom, {
      principalId: 'firebase:expired-operator',
      validThrough: expiredOperatorValidThrough,
    });
    const expiredOperatorInspection = await seedInspection(
      { status: 'absent', revision: 0, generationId: null },
      expiredOperatorRequestedAt
    );
    const expiredOperatorIntent = createGovernedPrivateEvaluationTransitionIntent({
      selector,
      inspectionId: expiredOperatorInspection.inspectionId,
      authoritySnapshotId: expiredOperatorInspection.snapshotId,
      operationId: createAflTradeContentAddress('private-evaluation-operation', {
        marker: 'expired-operator-receipt',
      }),
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      review: {
        principalId: 'firebase:expired-operator',
        rationale: 'A backdated receipt must not revive expired operator authority.',
      },
      requestedAt: expiredOperatorRequestedAt,
      expiresAt: expiredOperatorInspection.validThrough,
    });
    const expiredOperatorMaterialization = createGovernedPrivateEvaluationGeneration({
      selector,
      transitionIntentId: expiredOperatorIntent.transitionIntentId,
      generatedAt: fixtureGenerationCreatedAt,
      narrative: createGovernedPrivateEvaluationNarrativeFixture(),
    });
    await staging.stage({
      intent: expiredOperatorIntent,
      intentArtifact: createAflTradeCanonicalJsonArtifactRef(
        expiredOperatorIntent,
        expiredOperatorRequestedAt
      ),
      materialization: expiredOperatorMaterialization,
    });
    const expiredOperatorTransitionedAt = new Date(
      Date.parse(expiredOperatorRequestedAt) + 30_000
    ).toISOString();
    const expiredOperatorReceipt = createGovernedPrivateEvaluationTransitionReceipt({
      intent: expiredOperatorIntent,
      previousTransitionId: null,
      toGenerationId: expiredOperatorMaterialization.generation.generationId,
      transitionedAt: expiredOperatorTransitionedAt,
    });
    const expiredOperatorReceiptArtifact = await retainJson(
      expiredOperatorReceipt,
      expiredOperatorTransitionedAt
    );
    await expect(pool.query(
      `INSERT INTO outcome_private_evaluation_transition_receipt
        (transition_id,transition_intent_id,operation_id,valuation_scope_key,trade_id,
         artifact_id,action,from_revision,from_status,from_generation_id,to_revision,
         to_status,to_generation_id,transitioned_at,content_sha256,content_canonical_json,
         receipt_json)
       VALUES ($1,$2,$3,$4,$5,$6,'construct_and_activate',0,'absent',NULL,1,
               'active',$7,$8,$9,$10,$11::jsonb)`,
      [
        expiredOperatorReceipt.transitionId,
        expiredOperatorIntent.transitionIntentId,
        expiredOperatorIntent.content.operationId,
        selector.valuationScopeKey,
        selector.tradeId,
        expiredOperatorReceiptArtifact.artifactId,
        expiredOperatorMaterialization.generation.generationId,
        expiredOperatorTransitionedAt,
        expiredOperatorReceipt.transitionId.slice(
          'private-evaluation-transition:'.length
        ),
        canonicalizeAflTradeJson(expiredOperatorReceipt.content),
        canonicalizeAflTradeJson(expiredOperatorReceipt),
      ]
    )).rejects.toThrow(/Legacy private receipt failed exact test-fixture authentication/i);
    const operatorAuthorizedAt = new Date(Date.parse(currentTrustedAt) - 1_000).toISOString();
    await seedPrivateEvaluationOperator(operatorAuthorizedAt);
    const forgedAt = await trustedNow();
    const forgedInspection = await seedInspection(
      { status: 'absent', revision: 0, generationId: null },
      forgedAt
    );
    const validLegacyIntent = createGovernedPrivateEvaluationTransitionIntent({
      selector,
      inspectionId: forgedInspection.inspectionId,
      authoritySnapshotId: forgedInspection.snapshotId,
      operationId: createAflTradeContentAddress('private-evaluation-operation', {
        marker: 'forged-legacy-intent',
      }),
      action: { kind: 'construct_and_activate' },
      expectedHead: { status: 'absent', revision: 0, generationId: null },
      review: {
        principalId: 'firebase:test-operator',
        rationale: 'This direct SQL fixture must fail closed.',
      },
      requestedAt: forgedAt,
      expiresAt: forgedInspection.validThrough,
    });
    const forgedLegacyContent = {
      ...validLegacyIntent.content,
      publicationProhibited: 'true',
    };
    const forgedLegacyIntent = {
      transitionIntentId: createAflTradeContentAddress(
        'private-evaluation-transition-intent',
        forgedLegacyContent
      ),
      content: forgedLegacyContent,
    };
    const forgedLegacyArtifact = createAflTradeCanonicalJsonArtifactRef(
      forgedLegacyIntent,
      forgedAt
    );
    await staging.retainArtifact({
      reference: forgedLegacyArtifact,
      bytes: canonicalBytes(forgedLegacyIntent),
    });
    await expect(pool.query(
      `INSERT INTO outcome_private_evaluation_transition_intent
        (transition_intent_id,inspection_id,authority_snapshot_id,operation_id,
         valuation_scope_key,trade_id,artifact_id,action,expected_head_status,
         expected_head_revision,expected_head_generation_id,target_generation_id,
         requested_at,expires_at,content_sha256,content_canonical_json,intent_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'construct_and_activate','absent',0,NULL,NULL,
               $8,$9,$10,$11,$12::jsonb)`,
      [
        forgedLegacyIntent.transitionIntentId,
        forgedInspection.inspectionId,
        forgedInspection.snapshotId,
        validLegacyIntent.content.operationId,
        selector.valuationScopeKey,
        selector.tradeId,
        forgedLegacyArtifact.artifactId,
        forgedAt,
        forgedInspection.validThrough,
        forgedLegacyIntent.transitionIntentId.slice(
          'private-evaluation-transition-intent:'.length
        ),
        canonicalizeAflTradeJson(forgedLegacyContent),
        canonicalizeAflTradeJson(forgedLegacyIntent),
      ]
    )).rejects.toThrow(/Legacy private intent failed exact test-fixture authentication/i);
    const unauthorizedLegacyContent = {
      ...validLegacyIntent.content,
      operationId: createAflTradeContentAddress('private-evaluation-operation', {
        marker: 'unauthorized-legacy-intent',
      }),
      review: {
        principalId: 'firebase:unauthorized-operator',
        rationale: 'This direct SQL authority forgery must fail closed.',
      },
    };
    const unauthorizedLegacyIntent = {
      transitionIntentId: createAflTradeContentAddress(
        'private-evaluation-transition-intent',
        unauthorizedLegacyContent
      ),
      content: unauthorizedLegacyContent,
    };
    const unauthorizedLegacyArtifact = createAflTradeCanonicalJsonArtifactRef(
      unauthorizedLegacyIntent,
      forgedAt
    );
    await staging.retainArtifact({
      reference: unauthorizedLegacyArtifact,
      bytes: canonicalBytes(unauthorizedLegacyIntent),
    });
    await expect(pool.query(
      `INSERT INTO outcome_private_evaluation_transition_intent
        (transition_intent_id,inspection_id,authority_snapshot_id,operation_id,
         valuation_scope_key,trade_id,artifact_id,action,expected_head_status,
         expected_head_revision,expected_head_generation_id,target_generation_id,
         requested_at,expires_at,content_sha256,content_canonical_json,intent_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'construct_and_activate','absent',0,NULL,NULL,
               $8,$9,$10,$11,$12::jsonb)`,
      [
        unauthorizedLegacyIntent.transitionIntentId,
        forgedInspection.inspectionId,
        forgedInspection.snapshotId,
        unauthorizedLegacyContent.operationId,
        selector.valuationScopeKey,
        selector.tradeId,
        unauthorizedLegacyArtifact.artifactId,
        forgedAt,
        forgedInspection.validThrough,
        unauthorizedLegacyIntent.transitionIntentId.slice(
          'private-evaluation-transition-intent:'.length
        ),
        canonicalizeAflTradeJson(unauthorizedLegacyContent),
        canonicalizeAflTradeJson(unauthorizedLegacyIntent),
      ]
    )).rejects.toThrow(/Legacy private intent failed exact test-fixture authentication/i);
    const activation = await transition({
      marker: 'activate',
      action: { kind: 'construct_and_activate' },
      fromHead: { status: 'absent', revision: 0, generationId: null },
      previousTransitionId: null,
    });
    expect(activation.result).toMatchObject({ state: 'committed' });
    const activeHead = {
      status: 'active' as const,
      revision: 1,
      generationId: activation.generationId,
    };
    const crossIntentAt = await trustedNow();
    const crossIntentInspection = await seedInspection(activeHead, crossIntentAt);
    const createCrossIntent = (marker: string) =>
      createGovernedPrivateEvaluationTransitionIntent({
        selector,
        inspectionId: crossIntentInspection.inspectionId,
        authoritySnapshotId: crossIntentInspection.snapshotId,
        operationId: createAflTradeContentAddress('private-evaluation-operation', { marker }),
        action: { kind: 'construct_and_activate' },
        expectedHead: activeHead,
        review: {
          principalId: 'firebase:test-operator',
          rationale: 'Prove generation ancestry remains bound to its exact intent.',
        },
        requestedAt: crossIntentAt,
        expiresAt: crossIntentInspection.validThrough,
      });
    const crossIntentA = createCrossIntent('cross-intent-a');
    const crossMaterializationA = createGovernedPrivateEvaluationGeneration({
      selector,
      transitionIntentId: crossIntentA.transitionIntentId,
      generatedAt: fixtureGenerationCreatedAt,
      narrative: createGovernedPrivateEvaluationNarrativeFixture(),
    });
    await staging.stage({
      intent: crossIntentA,
      intentArtifact: createAflTradeCanonicalJsonArtifactRef(crossIntentA, crossIntentAt),
      materialization: crossMaterializationA,
    });
    const crossIntentReceipt = createGovernedPrivateEvaluationTransitionReceipt({
      intent: crossIntentA,
      previousTransitionId: activation.receipt.transitionId,
      toGenerationId: activation.generationId,
      transitionedAt: crossIntentAt,
    });
    const crossIntentReceiptArtifact = await retainJson(
      crossIntentReceipt,
      crossIntentAt
    );
    await expect(pool.query(
      `INSERT INTO outcome_private_evaluation_transition_receipt
        (transition_id,transition_intent_id,operation_id,valuation_scope_key,trade_id,
         artifact_id,action,from_revision,from_status,from_generation_id,to_revision,
         to_status,to_generation_id,transitioned_at,content_sha256,content_canonical_json,
         receipt_json)
       VALUES ($1,$2,$3,$4,$5,$6,'construct_and_activate',1,'active',$7,2,
               'active',$8,$9,$10,$11,$12::jsonb)`,
      [
        crossIntentReceipt.transitionId,
        crossIntentA.transitionIntentId,
        crossIntentA.content.operationId,
        selector.valuationScopeKey,
        selector.tradeId,
        crossIntentReceiptArtifact.artifactId,
        activation.generationId,
        activation.generationId,
        crossIntentAt,
        crossIntentReceipt.transitionId.slice('private-evaluation-transition:'.length),
        canonicalizeAflTradeJson(crossIntentReceipt.content),
        canonicalizeAflTradeJson(crossIntentReceipt),
      ]
    )).rejects.toThrow(/Legacy private receipt failed exact test-fixture authentication/i);
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
         FROM outcome_local_private_trade_evaluation_head
        WHERE valuation_scope_key=$1 AND trade_id=$2`,
      [selector.valuationScopeKey, selector.tradeId]
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
