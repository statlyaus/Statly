import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  aflTradeCurrentValuationRefreshResultSchema,
  createAflTradeCurrentValuationRefresh,
} from '@/server/aflTradeIntelligence/valuation/currentValuationRefresh';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_current_valuation_refresh_${process.pid}_${Date.now()}`;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${schemaName}`,
});

const ids = {
  release: `outcome-release:${'1'.repeat(64)}`,
  qualification: `model-qualification:${'2'.repeat(64)}`,
  work: `model-qualification-work:${'3'.repeat(64)}`,
  prepared: `prepared-valuation-input-set:${'4'.repeat(64)}`,
  batch: `private-evaluation-batch:${'5'.repeat(64)}`,
  transition: `private-evaluation-batch-transition:${'6'.repeat(64)}`,
  cohortOperation: `private-evaluation-cohort-run:${'7'.repeat(64)}`,
  oldBundle: `private-reviewed-evidence-bundle:${'8'.repeat(64)}`,
  newBundle: `private-reviewed-evidence-bundle:${'9'.repeat(64)}`,
  oldDecision: `private-reviewed-evidence-evaluation-decision:${'a'.repeat(64)}`,
  newDecision: `private-reviewed-evidence-evaluation-decision:${'b'.repeat(64)}`,
};

beforeAll(async () => {
  await pool.query(`DO $roles$ BEGIN
    BEGIN CREATE ROLE afl_trade_private_evaluation_coordinator NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    GRANT afl_trade_private_evaluation_coordinator TO CURRENT_USER;
  END $roles$`);
  await pool.query(`CREATE SCHEMA "${schemaName}"`);
  const canonicalFunction = readFileSync(
    join(
      process.cwd(),
      'prisma/afl-trade-outcomes/migrations/0037_valuation_publication_custody_index/migration.sql'
    ),
    'utf8'
  ).match(
    /CREATE FUNCTION "outcome_afl_trade_canonical_json"[\s\S]*?\$\$ LANGUAGE plpgsql IMMUTABLE STRICT;/
  )?.[0];
  if (canonicalFunction === undefined)
    throw new Error('Canonical JSON SQL function was not found.');
  await pool.query(canonicalFunction);
  await pool.query(`
    CREATE TABLE outcome_release_manifest (release_id text PRIMARY KEY);
    CREATE TABLE outcome_governed_valuation_model_qualification (
      qualification_id text PRIMARY KEY
    );
    CREATE TABLE outcome_governed_model_qualification_work (work_id text PRIMARY KEY);
    CREATE TABLE outcome_active_release (
      scope_key text PRIMARY KEY,release_id text NOT NULL,revision integer NOT NULL
    );
    CREATE TABLE outcome_prepared_valuation_input_set (
      prepared_input_set_id text PRIMARY KEY,scope_key text NOT NULL,
      factual_release_scope_key text NOT NULL,factual_release_id text NOT NULL,
      schema_version text NOT NULL,environment text NOT NULL
    );
    CREATE TABLE outcome_current_prepared_valuation_input_set (
      scope_key text PRIMARY KEY,prepared_input_set_id text NOT NULL,revision integer NOT NULL
    );
    CREATE TABLE outcome_current_governed_valuation_model_pair (
      scope_key text PRIMARY KEY,qualification_id text NOT NULL,work_id text NOT NULL,
      revision integer NOT NULL
    );
    CREATE TABLE outcome_private_evaluation_batch (
      batch_id text PRIMARY KEY,scope_key text NOT NULL,prepared_input_set_id text NOT NULL,
      prepared_input_set_revision integer NOT NULL,factual_release_id text NOT NULL,
      model_qualification_id text NOT NULL,model_qualification_work_id text NOT NULL
    );
    CREATE TABLE outcome_current_private_evaluation_batch (
      scope_key text PRIMARY KEY,batch_id text NOT NULL,revision integer NOT NULL,
      last_transition_id text NOT NULL
    );
    CREATE TABLE outcome_private_evaluation_cohort_capture (
      operation_id text PRIMARY KEY,factual_release_revision integer NOT NULL,
      model_pair_revision integer NOT NULL
    );
    CREATE TABLE outcome_private_evaluation_cohort_batch (
      operation_id text NOT NULL,batch_id text PRIMARY KEY
    );
    CREATE TABLE outcome_private_valuation_dispatch_request (request_id text PRIMARY KEY);
    CREATE TABLE outcome_local_private_trade_evaluation_generation (generation_id text PRIMARY KEY);
    CREATE TABLE outcome_private_evaluation_batch_transition (transition_id text PRIMARY KEY);
    CREATE TABLE outcome_private_evaluation_authority_snapshot (snapshot_id text PRIMARY KEY);
    CREATE TABLE outcome_private_evaluation_inspection_receipt (inspection_id text PRIMARY KEY);
    CREATE TABLE outcome_private_evaluation_transition_intent (transition_intent_id text PRIMARY KEY);
    CREATE TABLE outcome_private_evaluation_transition_receipt (transition_id text PRIMARY KEY);
    CREATE TABLE outcome_local_private_trade_evaluation_head (
      valuation_scope_key text NOT NULL,trade_id text NOT NULL,
      PRIMARY KEY (valuation_scope_key,trade_id)
    );
    CREATE TABLE outcome_review_decision (placeholder integer);
    CREATE TABLE outcome_source_capture (capture_id text PRIMARY KEY);
    CREATE TABLE outcome_artifact_custody (placeholder integer);
    CREATE TABLE outcome_source_rights_proposal (placeholder integer);
    CREATE TABLE outcome_provider_normalization_run (
      normalization_run_id text PRIMARY KEY,capture_id text NOT NULL,field_map_id text NOT NULL,
      decoder_version text NOT NULL,normalizer_version text NOT NULL,
      source_rds_sha256 text NOT NULL,decoded_sha256 text NOT NULL,receipt_sha256 text NOT NULL,
      staging_sha256 text NOT NULL,status text NOT NULL,source_row_count integer NOT NULL,
      accepted_row_count integer NOT NULL,quarantined_row_count integer NOT NULL,
      issue_count integer NOT NULL,identity_candidate_count integer NOT NULL,
      match_candidate_count integer NOT NULL,metric_candidate_count integer NOT NULL,
      achievement_candidate_count integer NOT NULL,completed_at timestamptz NOT NULL,
      finalized_at timestamptz
    );
    CREATE TABLE outcome_private_reviewed_evidence_bundle (
      evidence_bundle_id text PRIMARY KEY,evidence_scope_key text NOT NULL,
      is_current boolean NOT NULL,bundle_sha256 text NOT NULL,
      bundle_json jsonb NOT NULL
    );
    CREATE TABLE outcome_private_reviewed_evaluation_decision (
      decision_id text PRIMARY KEY,valuation_scope_key text NOT NULL,
      evidence_bundle_id text NOT NULL,status text NOT NULL
    );
    CREATE TABLE outcome_private_reviewed_evaluation_head (
      valuation_scope_key text NOT NULL,evidence_scope_key text NOT NULL,
      evidence_bundle_id text NOT NULL,decision_id text NOT NULL,status text NOT NULL,
      PRIMARY KEY (valuation_scope_key,evidence_scope_key)
    );
    CREATE FUNCTION outcome_private_reviewed_evidence_bundle_is_current(target_id text)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce((SELECT is_current FROM outcome_private_reviewed_evidence_bundle
        WHERE evidence_bundle_id=target_id),false)
    $$;
  `);
  await pool.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0080_current_valuation_refresh_tracer/migration.sql'
      ),
      'utf8'
    )
  );
  await pool.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0083_current_valuation_factual_refresh/migration.sql'
      ),
      'utf8'
    )
  );
});

afterAll(async () => {
  await pool.query(`SET search_path TO public`);
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE outcome_current_valuation_factual_refresh_operation,
    outcome_current_valuation_factual_refresh_stage_receipt,
    outcome_current_private_factual_authority,outcome_private_factual_candidate,
    outcome_current_valuation_refresh_operation,
    outcome_release_manifest,outcome_governed_valuation_model_qualification,
    outcome_governed_model_qualification_work,
    outcome_active_release,outcome_prepared_valuation_input_set,
    outcome_current_prepared_valuation_input_set,outcome_current_governed_valuation_model_pair,
    outcome_private_evaluation_batch,outcome_current_private_evaluation_batch,
    outcome_private_evaluation_cohort_capture,outcome_private_evaluation_cohort_batch,
    outcome_private_valuation_dispatch_request,outcome_local_private_trade_evaluation_generation,
    outcome_private_evaluation_batch_transition,outcome_private_evaluation_authority_snapshot,
    outcome_private_evaluation_inspection_receipt,outcome_private_evaluation_transition_intent,
    outcome_private_evaluation_transition_receipt,outcome_local_private_trade_evaluation_head,
    outcome_private_reviewed_evaluation_head,outcome_private_reviewed_evaluation_decision,
    outcome_private_reviewed_evidence_bundle,outcome_provider_normalization_run,
    outcome_source_capture`);
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(`INSERT INTO outcome_release_manifest VALUES ($1)`, [ids.release]);
    await connection.query(
      `INSERT INTO outcome_governed_valuation_model_qualification VALUES ($1)`,
      [ids.qualification]
    );
    await connection.query(`INSERT INTO outcome_governed_model_qualification_work VALUES ($1)`, [
      ids.work,
    ]);
    await connection.query(`INSERT INTO outcome_active_release VALUES ('afl-men:2026',$1,9)`, [
      ids.release,
    ]);
    await connection.query(
      `INSERT INTO outcome_prepared_valuation_input_set VALUES
        ($1,'afl-men:2026-trades','afl-men:2026',$2,
         'afl-trade-prepared-valuation-input-set/v3','non_production')`,
      [ids.prepared, ids.release]
    );
    await connection.query(
      `INSERT INTO outcome_current_prepared_valuation_input_set VALUES
        ('afl-men:2026-trades',$1,7)`,
      [ids.prepared]
    );
    await connection.query(
      `INSERT INTO outcome_current_governed_valuation_model_pair VALUES
        ('afl-men:2026-trades',$1,$2,4)`,
      [ids.qualification, ids.work]
    );
    await connection.query(
      `INSERT INTO outcome_private_evaluation_batch VALUES
        ($1,'afl-men:2026-trades',$2,7,$3,$4,$5)`,
      [ids.batch, ids.prepared, ids.release, ids.qualification, ids.work]
    );
    await connection.query(`INSERT INTO outcome_private_evaluation_batch_transition VALUES ($1)`, [
      ids.transition,
    ]);
    await connection.query(
      `INSERT INTO outcome_current_private_evaluation_batch VALUES
        ('afl-men:2026-trades',$1,3,$2)`,
      [ids.batch, ids.transition]
    );
    await connection.query(
      `INSERT INTO outcome_private_evaluation_cohort_capture VALUES ($1,9,4)`,
      [ids.cohortOperation]
    );
    await connection.query(`INSERT INTO outcome_private_evaluation_cohort_batch VALUES ($1,$2)`, [
      ids.cohortOperation,
      ids.batch,
    ]);
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
});

async function seedReviewedAuthority(input: {
  readonly bundleId: string;
  readonly decisionId: string;
  readonly isCurrent: boolean;
  readonly status?: 'authorized' | 'withdrawn';
}) {
  const status = input.status ?? 'authorized';
  const suffix = input.bundleId.slice(-64);
  const captureId = `source-capture:${suffix}`;
  const normalizationRunId = `provider-normalization-run:${suffix}`;
  await pool.query(`INSERT INTO outcome_source_capture VALUES ($1)`, [captureId]);
  await pool.query(
    `INSERT INTO outcome_provider_normalization_run VALUES
      ($1,$2,$3,'decoder-v1','normalizer-v1',$4,$5,$6,$7,'staged',1,1,0,0,1,1,1,0,
       '2026-08-25T00:00:00.000Z','2026-08-25T00:00:00.000Z')`,
    [
      normalizationRunId,
      captureId,
      `provider-field-map:${suffix}`,
      'c'.repeat(64),
      'd'.repeat(64),
      'e'.repeat(64),
      'f'.repeat(64),
    ]
  );
  await pool.query(
    `INSERT INTO outcome_private_reviewed_evidence_bundle VALUES
      ($1,'afl-player-match-reviewed-2021-2026',$2,$3,$4::jsonb)`,
    [
      input.bundleId,
      input.isCurrent,
      suffix,
      JSON.stringify({
        content: {
          sourceCaptures: [{ captureId }],
          reviewSets: [{ reviewSetId: suffix }],
          sourceRightsEvidenceRefs: [{ artifactId: `artifact:${suffix}` }],
        },
      }),
    ]
  );
  await pool.query(
    `INSERT INTO outcome_private_reviewed_evaluation_decision VALUES ($1,$2,$3,$4)`,
    [input.decisionId, 'afl-men:2026-trades', input.bundleId, status]
  );
  await pool.query(
    `INSERT INTO outcome_private_reviewed_evaluation_head VALUES
      ($1,'afl-player-match-reviewed-2021-2026',$2,$3,$4)
      ON CONFLICT (valuation_scope_key,evidence_scope_key) DO UPDATE SET
        evidence_bundle_id=EXCLUDED.evidence_bundle_id,
        decision_id=EXCLUDED.decision_id,
        status=EXCLUDED.status`,
    ['afl-men:2026-trades', input.bundleId, input.decisionId, status]
  );
}

describe('current valuation refresh PostgreSQL tracer', () => {
  it('retains and exactly replays no change without downstream writes', async () => {
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    await pool.query(`SELECT retain_outcome_current_valuation_factual_source(
      'afl-men:2026-trades','weekly','seed-current')`);
    await pool.query(`SELECT compose_outcome_current_valuation_factual_candidate(
      'afl-men:2026-trades','weekly','seed-current')`);
    await pool.query(`INSERT INTO outcome_current_private_factual_authority
      SELECT 'afl-men:2026-trades',receipt_json->'content'->>'candidateId',1,now()
        FROM outcome_current_valuation_factual_refresh_stage_receipt
       WHERE stable_operation_key='seed-current' AND stage='candidate_composed'`);
    await pool.query(`TRUNCATE outcome_current_valuation_factual_refresh_stage_receipt`);
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'weekly-data-check-2026-08-24',
    };

    const first = await refresh.refreshCurrent(request);
    await expect(refresh.refreshCurrent(request)).resolves.toEqual(first);
    expect(first).toMatchObject({
      state: 'no_change',
      executionLocation: 'local',
      visibility: 'private',
      environment: 'non_production',
      publicationEligible: false,
      publicationProhibited: true,
      capturedAuthority: {
        factualReleaseRevision: 9,
        modelPairRevision: 4,
        preparedInputSetRevision: 7,
        privateBatchRevision: 3,
      },
    });
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM outcome_current_valuation_refresh_operation`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      pool.query(`SELECT
        (SELECT count(*)::int FROM outcome_private_valuation_dispatch_request) AS dispatches,
        (SELECT count(*)::int FROM outcome_local_private_trade_evaluation_generation) AS generations,
        (SELECT count(*)::int FROM outcome_private_evaluation_batch) AS batches,
        (SELECT count(*)::int FROM outcome_private_evaluation_batch_transition) AS batch_transitions,
        (SELECT count(*)::int FROM outcome_private_evaluation_authority_snapshot) AS snapshots,
        (SELECT count(*)::int FROM outcome_private_evaluation_inspection_receipt) AS inspections,
        (SELECT count(*)::int FROM outcome_private_evaluation_transition_intent) AS intents,
        (SELECT count(*)::int FROM outcome_private_evaluation_transition_receipt) AS receipts,
        (SELECT count(*)::int FROM outcome_local_private_trade_evaluation_head) AS trade_heads`)
    ).resolves.toMatchObject({
      rows: [
        {
          dispatches: 0,
          generations: 0,
          batches: 1,
          batch_transitions: 1,
          snapshots: 0,
          inspections: 0,
          intents: 0,
          receipts: 0,
          trade_heads: 0,
        },
      ],
    });
  });

  it('rejects conflicting reuse of a stable operation key', async () => {
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    await refresh.refreshCurrent({
      scopeKey: 'afl-men:2026-trades',
      trigger: 'model_qualified',
      stableOperationKey: 'shared-operation',
    });

    await expect(
      refresh.refreshCurrent({
        scopeKey: 'afl-men:2026-trades',
        trigger: 'ad_hoc',
        stableOperationKey: 'shared-operation',
      })
    ).rejects.toThrow('conflicts with retained custody');
    await expect(
      pool.query(
        `SELECT count(*)::int AS count FROM outcome_current_valuation_factual_refresh_operation`
      )
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('serializes concurrent compatibility and factual callers to one retained operation', async () => {
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'cross-generation-concurrency',
    };

    const [factualResult, compatibilityRows] = await Promise.all([
      refresh.refreshCurrent(request),
      pool.query<{ result_json: unknown }>(
        `SELECT result_json FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)`,
        [request.scopeKey, request.trigger, request.stableOperationKey]
      ),
    ]);
    const compatibilityResult = aflTradeCurrentValuationRefreshResultSchema.parse(
      compatibilityRows.rows[0]?.result_json
    );

    expect(compatibilityResult).toEqual(factualResult);
    await expect(
      pool.query(`SELECT
        (SELECT count(*)::int FROM outcome_current_valuation_refresh_operation) +
        (SELECT count(*)::int FROM outcome_current_valuation_factual_refresh_operation) AS count`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('replays a retained pre-factual no-change operation without requiring stage receipts', async () => {
    const legacy = await pool.query<{ result_json: unknown }>(
      `SELECT result_json FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)`,
      ['afl-men:2026-trades', 'weekly', 'pre-factual-retained-operation']
    );
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });

    await expect(
      refresh.refreshCurrent({
        scopeKey: 'afl-men:2026-trades',
        trigger: 'weekly',
        stableOperationKey: 'pre-factual-retained-operation',
      })
    ).resolves.toEqual(
      aflTradeCurrentValuationRefreshResultSchema.parse(legacy.rows[0]?.result_json)
    );
    await expect(
      pool.query(`SELECT count(*)::int AS count
      FROM outcome_current_valuation_factual_refresh_stage_receipt`)
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('advances the private factual head once and replays acknowledged loss', async () => {
    await pool.query(
      `INSERT INTO outcome_private_reviewed_evidence_bundle VALUES
        ($1,'afl-player-match-reviewed-2021-2026',false,$2,'{}'::jsonb)`,
      [ids.oldBundle, ids.oldBundle.slice(-64)]
    );
    await pool.query(
      `INSERT INTO outcome_private_reviewed_evaluation_decision VALUES
        ($1,'afl-men:2026-trades',$2,'authorized')`,
      [ids.oldDecision, ids.oldBundle]
    );
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'new-admitted-evidence',
    };

    await pool.query(`SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)`, [
      request.scopeKey,
      request.trigger,
      request.stableOperationKey,
    ]);
    const committed = await refresh.refreshCurrent(request);
    await expect(refresh.refreshCurrent(request)).resolves.toEqual(committed);
    expect(committed).toMatchObject({
      state: 'factual_refresh_complete',
      factualStage: 'advanced',
      privateFactualAuthority: {
        candidateId: expect.stringMatching(/^private-factual-candidate:/),
        evidenceBundleId: ids.newBundle,
        reviewDecisionId: ids.newDecision,
        normalizedReconciledCustodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        revision: 1,
      },
      publicationEligible: false,
      publicationProhibited: true,
    });
    await expect(
      pool.query(`SELECT candidate.evidence_bundle_id,head.revision
        FROM outcome_current_private_factual_authority head
        JOIN outcome_private_factual_candidate candidate USING (candidate_id)`)
    ).resolves.toMatchObject({ rows: [{ evidence_bundle_id: ids.newBundle, revision: 1 }] });
    await expect(
      pool.query(`SELECT release_id,revision FROM outcome_active_release`)
    ).resolves.toMatchObject({ rows: [{ release_id: ids.release, revision: 9 }] });
    await expect(
      pool.query(`SELECT count(*)::int AS count
        FROM outcome_current_valuation_factual_refresh_operation`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      pool.query(
        `SELECT stage FROM outcome_current_valuation_factual_refresh_stage_receipt ORDER BY stage`
      )
    ).resolves.toMatchObject({
      rows: [{ stage: 'candidate_composed' }, { stage: 'source_authenticated' }],
    });
  });

  it('resumes a committed candidate receipt without duplicating custody', async () => {
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'lost-after-candidate-composition',
    };
    await pool.query(`SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)`, [
      request.scopeKey,
      request.trigger,
      request.stableOperationKey,
    ]);
    await pool.query(`SELECT compose_outcome_current_valuation_factual_candidate($1,$2,$3)`, [
      request.scopeKey,
      request.trigger,
      request.stableOperationKey,
    ]);

    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    await expect(refresh.refreshCurrent(request)).resolves.toMatchObject({
      state: 'factual_refresh_complete',
      factualStage: 'advanced',
    });
    await expect(
      pool.query(`SELECT
      (SELECT count(*)::int FROM outcome_private_factual_candidate) AS candidates,
      (SELECT count(*)::int FROM outcome_current_private_factual_authority) AS heads,
      (SELECT count(*)::int FROM outcome_current_valuation_factual_refresh_stage_receipt) AS stages`)
    ).resolves.toMatchObject({ rows: [{ candidates: 1, heads: 1, stages: 2 }] });
  });

  it('retains stale when reviewed authority changes after source authentication', async () => {
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      stableOperationKey: 'source-stale-after-authentication',
    };
    await pool.query(`SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)`, [
      request.scopeKey,
      request.trigger,
      request.stableOperationKey,
    ]);
    await pool.query(
      `UPDATE outcome_private_reviewed_evidence_bundle
        SET is_current=false WHERE evidence_bundle_id=$1`,
      [ids.newBundle]
    );

    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    const first = await refresh.refreshCurrent(request);
    await expect(refresh.refreshCurrent(request)).resolves.toEqual(first);
    expect(first).toMatchObject({ state: 'unavailable', cause: 'source_authority_stale' });
    await expect(
      pool.query(
        `SELECT stage FROM outcome_current_valuation_factual_refresh_stage_receipt
          WHERE stable_operation_key=$1 ORDER BY stage`,
        [request.stableOperationKey]
      )
    ).resolves.toMatchObject({
      rows: [{ stage: 'candidate_composed' }, { stage: 'source_authenticated' }],
    });
  });

  it('retains stale when normalized custody becomes ambiguous after authentication', async () => {
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: 'normalization-stale-after-authentication',
    };
    await pool.query(`SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)`, [
      request.scopeKey,
      request.trigger,
      request.stableOperationKey,
    ]);
    await pool.query(
      `INSERT INTO outcome_provider_normalization_run
        SELECT $1,capture_id,field_map_id,decoder_version,normalizer_version,
               source_rds_sha256,$2,$3,$4,status,source_row_count,accepted_row_count,
               quarantined_row_count,issue_count,identity_candidate_count,match_candidate_count,
               metric_candidate_count,achievement_candidate_count,completed_at,finalized_at
          FROM outcome_provider_normalization_run`,
      [
        `provider-normalization-run:${'0'.repeat(64)}`,
        '1'.repeat(64),
        '2'.repeat(64),
        '3'.repeat(64),
      ]
    );

    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    const first = await refresh.refreshCurrent(request);
    await expect(refresh.refreshCurrent(request)).resolves.toEqual(first);
    expect(first).toMatchObject({ state: 'unavailable', cause: 'source_authority_stale' });
  });

  it('does not reactivate a superseded candidate when an older operation resumes late', async () => {
    await seedReviewedAuthority({
      bundleId: ids.oldBundle,
      decisionId: ids.oldDecision,
      isCurrent: true,
    });
    const older = ['afl-men:2026-trades', 'weekly', 'older-composed-candidate'] as const;
    await pool.query(`SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)`, older);
    await pool.query(`SELECT compose_outcome_current_valuation_factual_candidate($1,$2,$3)`, older);
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    await expect(
      refresh.refreshCurrent({
        scopeKey: 'afl-men:2026-trades',
        trigger: 'weekly',
        stableOperationKey: 'newer-candidate',
      })
    ).resolves.toMatchObject({ state: 'factual_refresh_complete', factualStage: 'advanced' });

    await expect(
      refresh.refreshCurrent({
        scopeKey: older[0],
        trigger: older[1],
        stableOperationKey: older[2],
      })
    ).resolves.toMatchObject({ state: 'unavailable', cause: 'source_authority_stale' });
    await expect(
      pool.query(`SELECT candidate.evidence_bundle_id,head.revision
      FROM outcome_current_private_factual_authority head
      JOIN outcome_private_factual_candidate candidate USING (candidate_id)`)
    ).resolves.toMatchObject({ rows: [{ evidence_bundle_id: ids.newBundle, revision: 1 }] });
  });

  it('binds exact normalization custody and retains a late same-source candidate as stale', async () => {
    await seedReviewedAuthority({
      bundleId: ids.newBundle,
      decisionId: ids.newDecision,
      isCurrent: true,
    });
    const older = ['afl-men:2026-trades', 'ad_hoc', 'older-normalization-custody'] as const;
    await pool.query(`SELECT retain_outcome_current_valuation_factual_source($1,$2,$3)`, older);
    await pool.query(`SELECT compose_outcome_current_valuation_factual_candidate($1,$2,$3)`, older);
    const firstCandidate = await pool.query<{
      candidate_id: string;
      run_id: string;
      expected_revision: number;
    }>(
      `SELECT candidate.candidate_id,
              candidate.candidate_json#>>'{content,normalizedReconciledCustody,normalizationRuns,0,normalizationRunId}' AS run_id,
              (receipt.receipt_json#>>'{content,expectedPrivateFactualRevision}')::integer AS expected_revision
         FROM outcome_private_factual_candidate candidate
         JOIN outcome_current_valuation_factual_refresh_stage_receipt receipt
           ON receipt.receipt_json#>>'{content,candidateId}'=candidate.candidate_id
        WHERE receipt.stable_operation_key=$1 AND receipt.stage='candidate_composed'`,
      [older[2]]
    );
    expect(firstCandidate.rows[0]).toMatchObject({
      run_id: `provider-normalization-run:${ids.newBundle.slice(-64)}`,
      expected_revision: 0,
    });

    await pool.query(
      `UPDATE outcome_provider_normalization_run
      SET normalization_run_id=$1,decoded_sha256=$2,receipt_sha256=$3,staging_sha256=$4`,
      [
        `provider-normalization-run:${'0'.repeat(64)}`,
        '1'.repeat(64),
        '2'.repeat(64),
        '3'.repeat(64),
      ]
    );
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    const newer = await refresh.refreshCurrent({
      scopeKey: older[0],
      trigger: older[1],
      stableOperationKey: 'newer-normalization-custody',
    });
    expect(newer).toMatchObject({ state: 'factual_refresh_complete', factualStage: 'advanced' });
    if (newer.state !== 'factual_refresh_complete') {
      throw new TypeError(`Expected factual refresh completion, received ${newer.state}.`);
    }
    expect(newer.privateFactualAuthority.candidateId).not.toBe(firstCandidate.rows[0]?.candidate_id);

    await expect(
      refresh.refreshCurrent({
        scopeKey: older[0],
        trigger: older[1],
        stableOperationKey: older[2],
      })
    ).resolves.toMatchObject({ state: 'unavailable', cause: 'source_authority_stale' });
    await expect(
      pool.query(`SELECT candidate_id,revision
      FROM outcome_current_private_factual_authority`)
    ).resolves.toMatchObject({
      rows: [{ candidate_id: newer.privateFactualAuthority.candidateId, revision: 1 }],
    });
  });

  it.each([
    ['source_authority_missing', null, null, null],
    ['source_authority_stale', ids.newBundle, ids.newDecision, 'stale'],
    ['source_authority_unauthenticated', ids.newBundle, ids.newDecision, 'withdrawn'],
  ] as const)('retains exact unavailable cause %s', async (cause, bundleId, decisionId, setup) => {
    await pool.query(`DELETE FROM outcome_private_evaluation_cohort_capture`);
    if (bundleId !== null && decisionId !== null) {
      await seedReviewedAuthority({
        bundleId,
        decisionId,
        isCurrent: setup !== 'stale',
        status: setup === 'withdrawn' ? 'withdrawn' : 'authorized',
      });
    }
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'ad_hoc' as const,
      stableOperationKey: `unavailable-${cause}`,
    };

    const first = await refresh.refreshCurrent(request);
    await expect(refresh.refreshCurrent(request)).resolves.toEqual(first);
    expect(first).toMatchObject({ state: 'unavailable', cause });
    await expect(
      pool.query(
        `SELECT candidate_id,operation_json#>'{content,candidateId}' AS retained_candidate_id
           FROM outcome_current_valuation_factual_refresh_operation
          WHERE operation_id=$1`,
        [first.operationId]
      )
    ).resolves.toMatchObject({
      rows: [{ candidate_id: null, retained_candidate_id: null }],
    });
  });

  it('retains mismatched source authority without advancing either factual pointer', async () => {
    await pool.query(`DELETE FROM outcome_private_evaluation_cohort_capture`);
    await pool.query(
      `INSERT INTO outcome_private_reviewed_evidence_bundle VALUES
        ($1,'afl-player-match-reviewed-2021-2026',true,$2,'{}'::jsonb)`,
      [ids.newBundle, ids.newBundle.slice(-64)]
    );
    await pool.query(
      `INSERT INTO outcome_private_reviewed_evaluation_head VALUES
        ('afl-men:2026-trades','afl-player-match-reviewed-2021-2026',$1,$2,'authorized')`,
      [ids.newBundle, ids.newDecision]
    );
    const refresh = createAflTradeCurrentValuationRefresh({
      client: createPgAflOutcomeSqlClient(pool),
    });

    await expect(
      refresh.refreshCurrent({
        scopeKey: 'afl-men:2026-trades',
        trigger: 'ad_hoc',
        stableOperationKey: 'unavailable-mismatched',
      })
    ).resolves.toMatchObject({
      state: 'unavailable',
      cause: 'source_authority_mismatched',
    });
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM outcome_current_private_factual_authority`)
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      pool.query(`SELECT release_id,revision FROM outcome_active_release`)
    ).resolves.toMatchObject({ rows: [{ release_id: ids.release, revision: 9 }] });
  });

  it('keeps retained history behind the scoped function', async () => {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        connection.query(
          `SELECT * FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)`,
          ['afl-men:2026-trades', 'ad_hoc', 'scoped-function-only']
        )
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        connection.query(`SELECT * FROM outcome_current_valuation_refresh_operation`)
      ).rejects.toThrow('permission denied');
      await connection.query('ROLLBACK');
      await connection.query('BEGIN');
      await connection.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        connection.query(
          `SELECT * FROM retain_outcome_current_valuation_refresh_no_change_v1($1,$2,$3)`,
          ['afl-men:2026-trades', 'ad_hoc', 'scoped-function-v1-denied']
        )
      ).rejects.toThrow('permission denied');
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });

  it('uses statement time for capture and rejects noncanonical direct-SQL keys', async () => {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const transaction = await connection.query<{ started_at: Date }>(
        `SELECT transaction_timestamp() AS started_at`
      );
      await connection.query(`SELECT pg_sleep(0.02)`);
      await connection.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      const retained = await connection.query<{ result_json: unknown }>(
        `SELECT result_json FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)`,
        ['afl-men:2026-trades', 'ad_hoc', 'statement-time-check']
      );
      await connection.query('COMMIT');
      const result = aflTradeCurrentValuationRefreshResultSchema.parse(
        retained.rows[0]?.result_json
      );
      expect(Date.parse(result.capturedAt)).toBeGreaterThan(
        transaction.rows[0]!.started_at.getTime()
      );

      await connection.query('BEGIN');
      await connection.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        connection.query(
          `SELECT * FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)`,
          [' afl-men:2026-trades', 'ad_hoc', 'padded-key ']
        )
      ).rejects.toThrow('request is malformed');
      await connection.query('ROLLBACK');
    } finally {
      connection.release();
    }
  });
});
