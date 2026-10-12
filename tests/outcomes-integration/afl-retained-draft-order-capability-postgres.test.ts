import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
// Own file, so its Gate ledger starts empty: the fixture backdates its decision by ten seconds and
// would land behind a head another test advanced to the current clock.
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `retained_order_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: url });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const sql = createPgAflOutcomeSqlClient(pool);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('schema', schema);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
}, 120000);
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});
it('retains an Official AFL pre-draft order capture and still refuses an unknown capability', async () => {
  // Migration 0260: before it, the target insert failed the capability check (issue 853).
  const order = await createRetainedExternalCaptureFixture(
    sql,
    false,
    'test_fixture',
    1,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    { draftOrder: true }
  );
  const plannedAt = (
    await pool.query<{ at: string }>(
      `SELECT to_char(
         date_trunc('milliseconds',GREATEST(clock_timestamp(),finalized_at))+interval '1 millisecond',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
       FROM outcome_external_evidence_batch WHERE batch_id=$1`,
      [order.target.evidenceBatchId]
    )
  ).rows[0]!.at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: order.scopeEvidence,
    targets: [order.target],
  });
  const reader = {
    read: async (reference: typeof order.target.sourceArtifact) => {
      const retained =
        (await order.raw.loadExact(reference, 2097152)) ??
        (await order.metadata.loadExact(reference, 2097152));
      if (!retained) throw new Error('Synthetic retained bytes absent.');
      return retained.bytes;
    },
  };
  const repository = new PostgresAflTradeExternalDiscoveryRepository(sql);
  expect((await repository.persistRetainedPlan(plan, reader)).idempotentReplay).toBe(false);
  const target = (
    await pool.query(
      `SELECT * FROM outcome_external_historical_capture_target WHERE plan_id=$1 ORDER BY ordinal`,
      [plan.planId]
    )
  ).rows;
  expect(target.map((row) => [row.capability_id, row.schedule_id])).toEqual([
    ['official-afl-indicative-draft-order', null],
  ]);
  await expect(
    new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(sql).completeRetainedPlan(
      plan.planId
    )
  ).resolves.toMatchObject({ targetCount: 1, sourceBatchCount: 1, idempotentReplay: false });

  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    // Bypass only the insert guard in this rolled-back transaction; CHECK constraints still apply.
    await connection.query('SET LOCAL session_replication_role=replica');
    await expect(
      connection.query(
        `INSERT INTO outcome_external_historical_capture_target
          (plan_id,ordinal,target_id,schedule_id,discovery_evidence_id,capability_id,
           anchor_season_year,source_url,target_json)
         VALUES($1,2,$2,NULL,NULL,'unreviewed-capability',$3,$4,$5::jsonb)`,
        [
          plan.planId,
          target[0].target_id,
          target[0].anchor_season_year,
          target[0].source_url,
          JSON.stringify(target[0].target_json),
        ]
      )
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'outcome_external_historical_target_capability_check',
    });
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }
});
