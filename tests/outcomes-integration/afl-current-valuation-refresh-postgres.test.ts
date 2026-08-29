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
});

afterAll(async () => {
  await pool.query(`SET search_path TO public`);
  await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE outcome_current_valuation_refresh_operation,
    outcome_release_manifest,outcome_governed_valuation_model_qualification,
    outcome_governed_model_qualification_work,
    outcome_active_release,outcome_prepared_valuation_input_set,
    outcome_current_prepared_valuation_input_set,outcome_current_governed_valuation_model_pair,
    outcome_private_evaluation_batch,outcome_current_private_evaluation_batch,
    outcome_private_evaluation_cohort_capture,outcome_private_evaluation_cohort_batch,
    outcome_private_valuation_dispatch_request,outcome_local_private_trade_evaluation_generation,
    outcome_private_evaluation_batch_transition,outcome_private_evaluation_authority_snapshot,
    outcome_private_evaluation_inspection_receipt,outcome_private_evaluation_transition_intent,
    outcome_private_evaluation_transition_receipt,outcome_local_private_trade_evaluation_head`);
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

describe('current valuation refresh PostgreSQL tracer', () => {
  it('retains and exactly replays no change without downstream writes', async () => {
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
      pool.query(`SELECT count(*)::int AS count FROM outcome_current_valuation_refresh_operation`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
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
