import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import type { AflOutcomeSqlTransaction } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createLocalAflTradeCurrentValuationReconciliationAuthority } from '@/server/aflTradeIntelligence/development/localCurrentValuationReconciliationAuthority';
import { LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 } from '@/server/aflTradeIntelligence/development/localFiveSeasonAflTablesReview';
import { LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 } from '@/server/aflTradeIntelligence/development/localOfficialAfl2026Review';
import {
  AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES,
  createAflTradeCurrentValuationEvidenceCoordinator,
  createAflTradeCurrentValuationEvidenceFactualHandoffKey,
} from '@/server/aflTradeIntelligence/valuation/currentValuationEvidenceOrchestration';
import { createAflTradeCurrentValuationRefresh } from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';
import { PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository } from '@/server/aflTradeIntelligence/valuation/postgresCurrentValuationEvidenceOrchestration';
import { PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority } from '@/server/aflTradeIntelligence/valuation/postgresPrivateReviewedEvidenceEvaluationAuthority';
import { createAflTradePrivateReviewedEvidenceBundle } from '@/server/aflTradeIntelligence/valuation/privateReviewedEvidenceEvaluation';
import { createGovernedCurrentValuationEvidenceSourceFixture } from '../helpers/aflCurrentValuationEvidenceProviderFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_current_valuation_evidence_${process.pid}_${Date.now()}`;
const governedSchemaName = `afl_current_valuation_evidence_e2e_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${schemaName}`,
});
const governedPool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${governedSchemaName}`,
});
let governedArtifactRoot = '';

function expectedFieldMapId(
  source: (typeof AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES)[number]
): string {
  if (source.capabilityId === 'official-afl-player-stats') {
    return 'official-afl-player-stats-local-2026-v1';
  }
  if (source.capabilityId === 'afl-tables-results') {
    return 'afl-tables-results-local-2026-v2';
  }
  return `afl-tables-player-stats-local-${source.seasonYear}-v1`;
}

async function seedCurrentReviewSetAuthority(): Promise<void> {
  for (const reviewSet of [
    {
      decisionId: `local-afl-tables-review:set:${LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256}`,
      evidenceSetSha256: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
      reviewerId: 'local-five-season-evidence-reviewer',
    },
    {
      decisionId: `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}`,
      evidenceSetSha256: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
      reviewerId: 'local-workbook-evidence-reviewer',
    },
  ]) {
    await governedPool.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,canonical_record_type,
         canonical_record_id,supersedes_decision_id,rationale,evidence_json,
         decided_by,decided_at)
       VALUES ($1,'local_review_set',$2,'approved','local_review_set',$2,NULL,$3,
               jsonb_build_object('evidenceSetSha256',$2::text,'appearanceCount',1),$4,$5)`,
      [
        reviewSet.decisionId,
        reviewSet.evidenceSetSha256,
        'Explicit test-owned human reconciliation authority transition.',
        reviewSet.reviewerId,
        '2026-08-29T12:00:00.000Z',
      ]
    );
  }
}

async function loadGovernedFixtureReviewedBundle(
  transaction: AflOutcomeSqlTransaction,
  createdAt: string
) {
  const captures = await transaction.query<{
    capture_id: string;
    provider: string;
    capability_id: string;
    anchor_season_year: number;
    source_artifact_id: string;
    content_sha256: string;
    storage_uri: string;
    media_type: string;
    byte_length: number;
    artifact_created_at: Date;
  }>(
    `SELECT capture.capture_id,capture.provider,capture.capability_id,
            capture.anchor_season_year,capture.source_artifact_id,
            custody.content_sha256,custody.storage_uri,custody.media_type,
            custody.byte_length,custody.created_at AS artifact_created_at
       FROM outcome_source_capture capture
       JOIN outcome_artifact_custody custody
         ON custody.artifact_id=capture.source_artifact_id
      WHERE capture.environment='non_production' AND capture.status='staged'
      ORDER BY capture.capture_id`
  );
  const rights = await transaction.query<{ content_json: unknown; proposed_at: Date }>(
    `SELECT DISTINCT rights.content_json,rights.proposed_at
       FROM outcome_source_capture capture
       JOIN outcome_source_rights_proposal rights
         ON rights.rights_artifact_id=
              capture.manifest_json->'sourceRightsProposal'->>'rightsArtifactId'
      WHERE capture.environment='non_production' AND capture.status='staged'
      ORDER BY rights.proposed_at`
  );
  return createAflTradePrivateReviewedEvidenceBundle({
    evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
    reviewSets: [
      {
        reviewSetId: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256,
        reviewSetDecisionId: `local-afl-tables-review:set:${LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256}`,
        reviewerId: 'local-five-season-evidence-reviewer',
        candidateCount: 1,
        decisionCount: 1,
        reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef(
          { reviewSetId: LOCAL_FIVE_SEASON_AFL_TABLES_EVIDENCE_SET_SHA256 },
          createdAt
        ),
      },
      {
        reviewSetId: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256,
        reviewSetDecisionId: `local-official-afl-review:set:${LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256}`,
        reviewerId: 'local-workbook-evidence-reviewer',
        candidateCount: 1,
        decisionCount: 1,
        reviewSetArtifact: createAflTradeCanonicalJsonArtifactRef(
          { reviewSetId: LOCAL_OFFICIAL_AFL_2026_SAM_FLANDERS_EVIDENCE_SET_SHA256 },
          createdAt
        ),
      },
    ],
    sourceCaptures: captures.rows.map((capture) => ({
      captureId: capture.capture_id,
      provider: capture.provider,
      capabilityId: capture.capability_id,
      seasonYear: Number(capture.anchor_season_year),
      sourceArtifact: {
        artifactId: capture.source_artifact_id,
        contentSha256: capture.content_sha256,
        storageUri: capture.storage_uri,
        mediaType: capture.media_type,
        byteLength: Number(capture.byte_length),
        createdAt: capture.artifact_created_at.toISOString(),
      },
    })),
    sourceRightsEvidenceRefs: rights.rows.map((right) =>
      createAflTradeCanonicalJsonArtifactRef(right.content_json, right.proposed_at.toISOString())
    ),
    createdAt,
  });
}

beforeAll(async () => {
  await pool.query(`DO $roles$ BEGIN
    BEGIN CREATE ROLE afl_trade_private_evaluation_coordinator NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN CREATE ROLE afl_trade_current_valuation_refresh_owner NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    GRANT afl_trade_private_evaluation_coordinator TO CURRENT_USER;
    GRANT afl_trade_current_valuation_refresh_owner TO CURRENT_USER;
  END $roles$`);
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  await pool.query(
    `GRANT USAGE,CREATE ON SCHEMA "${schemaName}"
       TO afl_trade_current_valuation_refresh_owner`
  );
  const canonicalFunction = readFileSync(
    join(
      process.cwd(),
      'prisma/afl-trade-outcomes/migrations/0037_valuation_publication_custody_index/migration.sql'
    ),
    'utf8'
  ).match(
    /CREATE FUNCTION "outcome_afl_trade_canonical_json"[\s\S]*?\$\$ LANGUAGE plpgsql IMMUTABLE STRICT;/
  )?.[0];
  if (canonicalFunction === undefined) {
    throw new Error('Canonical JSON SQL function was not found.');
  }
  await pool.query(canonicalFunction);
  await pool.query(`
    CREATE TABLE outcome_current_valuation_refresh_operation (
      operation_id text NOT NULL,scope_key text NOT NULL,trigger_kind text NOT NULL,
      stable_operation_key text PRIMARY KEY,result_json jsonb NOT NULL
    );
    CREATE TABLE outcome_current_valuation_factual_refresh_operation (
      operation_id text NOT NULL,scope_key text NOT NULL,trigger_kind text NOT NULL,
      stable_operation_key text PRIMARY KEY,result_json jsonb NOT NULL
    );
    CREATE TABLE outcome_private_reviewed_evaluation_head (
      valuation_scope_key text NOT NULL,evidence_scope_key text NOT NULL,
      status text NOT NULL,PRIMARY KEY (valuation_scope_key,evidence_scope_key)
    );
    CREATE TABLE outcome_source_capture (
      capture_id text PRIMARY KEY,provider text NOT NULL,capability_id text NOT NULL,
      anchor_season_year smallint NOT NULL,status text NOT NULL
    );
    CREATE TABLE outcome_provider_normalization_run (
      normalization_run_id text PRIMARY KEY,capture_id text NOT NULL,
      field_map_id text NOT NULL,status text NOT NULL,finalized_at timestamptz
    );
  `);
  await pool.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0084_current_valuation_evidence_orchestration/migration.sql'
      ),
      'utf8'
    )
  );
  await adminPool.query(`CREATE SCHEMA "${governedSchemaName}"`);
  const governedDatabaseUrl = new URL(databaseUrl);
  governedDatabaseUrl.searchParams.set('schema', governedSchemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], {
    databaseUrl: governedDatabaseUrl.toString(),
  });
  governedArtifactRoot = await mkdtemp(join(tmpdir(), 'statly-current-valuation-evidence-e2e-'));
});

afterAll(async () => {
  await governedPool.end();
  await pool.query(`SET search_path TO public`);
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${governedSchemaName}" CASCADE`);
  await adminPool.end();
  await rm(governedArtifactRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await pool.query(`TRUNCATE outcome_current_valuation_evidence_orchestration_operation,
    outcome_current_valuation_evidence_orchestration_stage_receipt,
    outcome_current_valuation_refresh_operation,
    outcome_current_valuation_factual_refresh_operation,
    outcome_private_reviewed_evaluation_head,
    outcome_provider_normalization_run,
    outcome_source_capture`);
  for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
    await pool.query(
      `INSERT INTO outcome_source_capture
        (capture_id,provider,capability_id,anchor_season_year,status)
       VALUES ($1,$2,$3,$4,'staged')`,
      [
        `source-capture:${String(index).padStart(64, '0')}`,
        source.provider,
        source.capabilityId,
        source.seasonYear,
      ]
    );
    await pool.query(
      `INSERT INTO outcome_provider_normalization_run
        (normalization_run_id,capture_id,field_map_id,status,finalized_at)
       VALUES ($1,$2,$3,'needs_review',statement_timestamp())`,
      [
        `provider-normalization-run:${String(index).padStart(64, '0')}`,
        `source-capture:${String(index).padStart(64, '0')}`,
        expectedFieldMapId(source),
      ]
    );
  }
});

describe('current valuation evidence orchestration PostgreSQL authority', () => {
  it('retains and exactly replays review-required under one stable operation identity', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'evidence-review-required',
    };
    for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
      await repository.retainNormalizedSource({
        request,
        state: 'ready',
        sourceKey: source.sourceKey,
        captureId: `source-capture:${String(index).padStart(64, '0')}`,
        normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
      });
    }

    const first = await repository.retainUnavailable(request, {
      stage: 'reviewed_authority',
      cause: 'review_required',
    });
    await expect(
      repository.retainUnavailable(request, {
        stage: 'reviewed_authority',
        cause: 'review_required',
      })
    ).resolves.toEqual(first);
    expect(first).toMatchObject({
      state: 'unavailable',
      stage: 'reviewed_authority',
      cause: 'review_required',
    });
    await expect(
      pool.query(
        `SELECT count(*)::integer AS count
           FROM outcome_current_valuation_evidence_orchestration_operation`
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });

    await expect(
      repository.retainUnavailable(
        { ...request, scopeKey: 'afl-men:2025-trades' },
        { stage: 'reviewed_authority', cause: 'review_required' }
      )
    ).rejects.toThrow('conflicts with retained custody');
  });

  it('retains a non-review-required failure at the reviewed-authority boundary', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'reviewed-authority-stale',
    };
    for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
      await repository.retainNormalizedSource({
        request,
        state: 'ready',
        sourceKey: source.sourceKey,
        captureId: `source-capture:${String(index).padStart(64, '0')}`,
        normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
      });
    }

    await expect(
      repository.retainUnavailable(request, {
        stage: 'reviewed_authority',
        cause: 'stale',
      })
    ).resolves.toMatchObject({
      state: 'unavailable',
      stage: 'reviewed_authority',
      cause: 'stale',
    });
  });

  it('cannot retain a reviewed-authority result before all seven source receipts', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(
      repository.retainUnavailable(
        {
          scopeKey: 'afl-men:2026-trades',
          trigger: 'ad_hoc',
          stableOperationKey: 'review-boundary-without-sources',
        },
        { stage: 'reviewed_authority', cause: 'review_required' }
      )
    ).rejects.toThrow(/requires all seven source receipts/i);
  });

  it('retains each normalized source stage and resumes without invoking captured work twice', async () => {
    const client = createPgAflOutcomeSqlClient(pool);
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(client);
    const calls: string[] = [];
    const coordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository,
      source: {
        ensureCurrent: async (source) => {
          calls.push(source.sourceKey);
          const index = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.indexOf(source);
          return {
            state: 'ready',
            sourceKey: source.sourceKey,
            captureId: `source-capture:${String(index).padStart(64, '0')}`,
            normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
          };
        },
      },
      reconciliationAuthority: { assessCurrent: async () => ({ state: 'ready' }) },
      reviewedAuthority: {
        assessCurrent: async () => ({
          state: 'unavailable',
          stage: 'reviewed_authority',
          cause: 'review_required',
        }),
      },
      factualRefresh: {
        refreshCurrent: async () => {
          throw new Error('Factual refresh must not run before human review.');
        },
      },
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'retained-normalized-sources',
    };

    const first = await coordinator.refreshCurrent(request);
    await expect(coordinator.refreshCurrent(request)).resolves.toEqual(first);

    expect(calls).toEqual(
      AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.map(({ sourceKey }) => sourceKey)
    );
    await expect(
      pool.query(
        `SELECT source_key,capture_id,normalization_run_id
           FROM outcome_current_valuation_evidence_orchestration_stage_receipt
          WHERE stable_operation_key=$1 ORDER BY source_key`,
        [request.stableOperationKey]
      )
    ).resolves.toMatchObject({ rows: expect.arrayContaining(Array(7).fill(expect.anything())) });
  });

  it('rejects a finalized normalization retained under another field-map authority', async () => {
    const source = AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES[0]!;
    await pool.query(
      `UPDATE outcome_provider_normalization_run SET field_map_id='unreviewed-field-map'
        WHERE normalization_run_id=$1`,
      [`provider-normalization-run:${'0'.repeat(64)}`]
    );
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(
      repository.retainNormalizedSource({
        request: {
          scopeKey: 'afl-men:2026-trades',
          trigger: 'ad_hoc',
          stableOperationKey: 'reject-wrong-field-map',
        },
        state: 'ready',
        sourceKey: source.sourceKey,
        captureId: `source-capture:${'0'.repeat(64)}`,
        normalizationRunId: `provider-normalization-run:${'0'.repeat(64)}`,
      })
    ).rejects.toThrow(/normalized source custody is missing or mismatched/i);
  });

  it('retains an authenticated private factual handoff after every source stage', async () => {
    const repository = new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'complete-private-factual-handoff',
    };
    for (const [index, source] of AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.entries()) {
      await repository.retainNormalizedSource({
        request,
        state: 'ready',
        sourceKey: source.sourceKey,
        captureId: `source-capture:${String(index).padStart(64, '0')}`,
        normalizationRunId: `provider-normalization-run:${String(index).padStart(64, '0')}`,
      });
    }
    const factualRefresh = {
      schemaVersion: 'afl-current-valuation-refresh-result-v2' as const,
      operationId: `current-valuation-factual-refresh-operation:${'d'.repeat(64)}`,
      scopeKey: request.scopeKey,
      trigger: request.trigger,
      stableOperationKey: createAflTradeCurrentValuationEvidenceFactualHandoffKey(request),
      state: 'factual_refresh_complete' as const,
      factualStage: 'advanced' as const,
      privateFactualAuthority: {
        valuationScopeKey: request.scopeKey,
        candidateId: `private-factual-candidate:${'e'.repeat(64)}`,
        evidenceScopeKey: 'afl-player-match-reviewed-2021-2026',
        evidenceBundleId: `private-reviewed-evidence-bundle:${'f'.repeat(64)}`,
        reviewDecisionId: `private-reviewed-evidence-evaluation-decision:${'1'.repeat(64)}`,
        normalizedReconciledCustodySha256: '2'.repeat(64),
        revision: 1,
      },
      capturedAt: '2026-08-29T12:00:00.000Z',
      completedAt: '2026-08-29T12:00:01.000Z',
      executionLocation: 'local' as const,
      visibility: 'private' as const,
      environment: 'non_production' as const,
      publicationEligible: false as const,
      publicationProhibited: true as const,
      limitation:
        'Private local non-production factual refresh authority only; no public release, registry, production, activation, or publication authority is granted.' as const,
    };
    await pool.query(
      `INSERT INTO outcome_current_valuation_factual_refresh_operation
        (operation_id,scope_key,trigger_kind,stable_operation_key,result_json)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        factualRefresh.operationId,
        factualRefresh.scopeKey,
        factualRefresh.trigger,
        factualRefresh.stableOperationKey,
        factualRefresh,
      ]
    );

    const first = await repository.retainComplete(request, factualRefresh);
    await expect(repository.retainComplete(request, factualRefresh)).resolves.toEqual(first);
    expect(first).toMatchObject({
      state: 'complete',
      stage: 'private_factual_authority',
      currentValuationRefresh: factualRefresh,
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('crosses all seven governed lanes with an explicit bounded reviewed-authority seam', async () => {
    const client = createPgAflOutcomeSqlClient(governedPool);
    const capturedSourceKeys: string[] = [];
    const source = await createGovernedCurrentValuationEvidenceSourceFixture({
      client,
      artifactRoot: governedArtifactRoot,
      capturedSourceKeys,
    });
    const publicAuthorityBefore = await governedPool.query<{
      active_releases: number;
      registry_events: number;
    }>(
      `SELECT
          (SELECT count(*)::integer FROM outcome_active_release) AS active_releases,
          (SELECT count(*)::integer FROM outcome_registry_event) AS registry_events`
    );
    const coordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(client),
      source,
      reconciliationAuthority: createLocalAflTradeCurrentValuationReconciliationAuthority(client),
      reviewedAuthority: {
        assessCurrent: async () => {
          throw new Error('Reviewed authority must not run before reconciliation review.');
        },
      },
      factualRefresh: {
        refreshCurrent: async () => {
          throw new Error('Factual refresh must not run before reconciliation review.');
        },
      },
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'governed-provider-evidence-e2e',
    };

    const first = await coordinator.refreshCurrent(request);
    await expect(coordinator.refreshCurrent(request)).resolves.toEqual(first);

    expect(first).toMatchObject({
      state: 'unavailable',
      stage: 'reconciliation_authority',
      cause: 'missing',
      publicationEligible: false,
      publicationProhibited: true,
    });

    await seedCurrentReviewSetAuthority();
    const reviewedAuthority = new PostgresAflTradePrivateReviewedEvidenceEvaluationAuthority(
      client,
      { loadCurrentEvidence: loadGovernedFixtureReviewedBundle }
    );
    const reconciliationAuthority = createLocalAflTradeCurrentValuationReconciliationAuthority(
      client,
      { loadReviewedBundle: loadGovernedFixtureReviewedBundle }
    );
    const resumedCoordinator = createAflTradeCurrentValuationEvidenceCoordinator({
      repository: new PostgresAflTradeCurrentValuationEvidenceOrchestrationRepository(client),
      source,
      reconciliationAuthority,
      reviewedAuthority: {
        assessCurrent: async ({ valuationScopeKey }) => {
          const assessment = await reviewedAuthority.assessCurrent({ valuationScopeKey });
          return assessment.state === 'authorized'
            ? { state: 'ready' as const }
            : {
                state: 'unavailable' as const,
                stage: 'reviewed_authority' as const,
                cause: 'review_required' as const,
              };
        },
      },
      factualRefresh: createAflTradeCurrentValuationRefresh({ client }),
    });
    const awaitingReviewedAuthority = await resumedCoordinator.refreshCurrent({
      ...request,
      stableOperationKey: 'governed-provider-evidence-e2e-awaiting-reviewed-authority',
    });
    expect(awaitingReviewedAuthority).toMatchObject({
      state: 'unavailable',
      stage: 'reviewed_authority',
      cause: 'review_required',
    });

    const decisionInput = {
      status: 'authorized' as const,
      valuationScopeKey: request.scopeKey,
      expectedCurrentDecisionId: null,
      reviewerId: 'current-valuation-e2e-human-reviewer',
      rationale:
        'Explicitly authorize the exact newly captured fixture bundle for private factual evaluation.',
    };
    await expect(reviewedAuthority.recordDecision(decisionInput)).rejects.toThrow(
      'exact current-set authentication'
    );
    await expect(
      governedPool.query(
        `SELECT
           (SELECT count(*)::integer FROM outcome_private_reviewed_evidence_bundle) AS bundles,
           (SELECT count(*)::integer FROM outcome_private_reviewed_evaluation_decision) AS decisions,
           (SELECT count(*)::integer FROM outcome_private_reviewed_evaluation_head) AS heads`
      )
    ).resolves.toMatchObject({ rows: [{ bundles: 0, decisions: 0, heads: 0 }] });

    // The production exact-set guard correctly rejects this small no-network fixture above. The
    // remaining seam is deliberately bounded to exercising recordDecision persistence/CAS and the
    // real factual refresh without materializing 146,343 fixture review decisions.
    await governedPool.query(
      `CREATE OR REPLACE FUNCTION outcome_private_reviewed_evidence_bundle_is_current(
         target_evidence_bundle_id TEXT
       ) RETURNS BOOLEAN LANGUAGE sql STABLE STRICT AS $function$
         SELECT EXISTS (
           SELECT 1 FROM outcome_private_reviewed_evidence_bundle
            WHERE evidence_bundle_id=target_evidence_bundle_id
              AND source_capture_count=7 AND source_rights_count=3
         )
       $function$`
    );
    await governedPool.query(
      `ALTER TABLE outcome_private_reviewed_evidence_bundle
         DISABLE TRIGGER outcome_private_reviewed_evidence_bundle_insert_guard`
    );
    const reviewedDecision = await (async () => {
      try {
        return await reviewedAuthority.recordDecision(decisionInput);
      } finally {
        await governedPool.query(
          `ALTER TABLE outcome_private_reviewed_evidence_bundle
             ENABLE TRIGGER outcome_private_reviewed_evidence_bundle_insert_guard`
        );
      }
    })();
    const completed = await resumedCoordinator.refreshCurrent({
      ...request,
      stableOperationKey: 'governed-provider-evidence-e2e-reviewed',
    });
    await expect(
      resumedCoordinator.refreshCurrent({
        ...request,
        stableOperationKey: 'governed-provider-evidence-e2e-reviewed',
      })
    ).resolves.toEqual(completed);
    expect(completed).toMatchObject({
      state: 'complete',
      stage: 'private_factual_authority',
      currentValuationRefresh: { state: 'factual_refresh_complete', factualStage: 'advanced' },
      publicationEligible: false,
      publicationProhibited: true,
    });
    expect(completed).toMatchObject({
      currentValuationRefresh: {
        privateFactualAuthority: {
          evidenceBundleId: reviewedDecision.content.evidenceBundleId,
          reviewDecisionId: reviewedDecision.decisionId,
        },
      },
    });
    expect(capturedSourceKeys).toEqual(
      AFL_TRADE_CURRENT_VALUATION_EVIDENCE_SOURCES.map(({ sourceKey }) => sourceKey)
    );
    await expect(
      governedPool.query(
        `SELECT
            (SELECT count(*)::integer FROM outcome_source_capture) AS captures,
            (SELECT count(*)::integer FROM outcome_provider_normalization_run
              WHERE finalized_at IS NOT NULL) AS normalizations,
            (SELECT count(*)::integer
               FROM outcome_current_valuation_evidence_orchestration_stage_receipt) AS receipts`
      )
    ).resolves.toMatchObject({
      rows: [{ captures: 7, normalizations: 7, receipts: 21 }],
    });
    await expect(
      governedPool.query(
        `SELECT reviewed.decision_id,reviewed.evidence_bundle_id,
                factual.revision AS factual_revision
           FROM outcome_private_reviewed_evaluation_head reviewed
           JOIN outcome_current_private_factual_authority factual
             ON factual.valuation_scope_key=reviewed.valuation_scope_key
          WHERE reviewed.valuation_scope_key=$1`,
        [request.scopeKey]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          decision_id: reviewedDecision.decisionId,
          evidence_bundle_id: reviewedDecision.content.evidenceBundleId,
          factual_revision: 1,
        },
      ],
    });
    await expect(
      governedPool.query(
        `SELECT
            (SELECT count(*)::integer FROM outcome_active_release) AS active_releases,
            (SELECT count(*)::integer FROM outcome_registry_event) AS registry_events`
      )
    ).resolves.toEqual(publicAuthorityBefore);
  }, 60_000);
});
