import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import { PostgresAflTradeExternalDiscoveryRepository } from '@/server/aflTradeIntelligence/source/postgresExternalDraftTradeDiscoveryRepository';
import { PostgresAflTradeExternalHistoricalCaptureCompletionRepository } from '@/server/aflTradeIntelligence/source/postgresExternalHistoricalCaptureCompletionRepository';
import { createRetainedExternalCaptureFixture } from '../testUtils/retainedExternalCaptureFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';
const url = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!url) throw new Error('Disposable PostgreSQL required.');
const schema = `retained_nullable_terms_${process.pid}_${Date.now()}`;
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
it('completes retained captures with unspecified terms dates under current Gate authority', async () => {
  const fixture = await createRetainedExternalCaptureFixture(sql, false, 'test_fixture', 1, true);
  const plannedAt = (
    await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
  ).rows[0]!.at.toISOString();
  const plan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt,
    scopeEvidence: fixture.scopeEvidence,
    targets: [fixture.target],
  });
  const reader = {
    read: async (reference: typeof fixture.target.sourceArtifact) => {
      const retained =
        (await fixture.raw.loadExact(reference, 2097152)) ??
        (await fixture.metadata.loadExact(reference, 2097152));
      if (!retained) throw new Error('Synthetic retained bytes absent.');
      return retained.bytes;
    },
  };
  await expect(
    new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(plan, reader)
  ).resolves.toMatchObject({ idempotentReplay: false });
  const result = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(plan.planId);
  expect(result).toMatchObject({ targetCount: 1, sourceBatchCount: 1, publicationEligible: false });
  const original = (
    await pool.query(
      'SELECT to_jsonb(c) AS row FROM outcome_external_historical_capture_completion c WHERE completion_id=$1',
      [result.completionId]
    )
  ).rows;
  const nextPlan = createAflTradeRetainedExternalCapturePlan({
    environment: 'test_fixture',
    competition: 'AFLM',
    plannedAt: (
      await pool.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")
    ).rows[0]!.at.toISOString(),
    scopeEvidence: fixture.scopeEvidence,
    targets: [fixture.target],
  });
  expect(nextPlan.planId).not.toBe(plan.planId);
  await new PostgresAflTradeExternalDiscoveryRepository(sql).persistRetainedPlan(nextPlan, reader);
  const reused = await new PostgresAflTradeExternalHistoricalCaptureCompletionRepository(
    sql
  ).completeRetainedPlan(nextPlan.planId);
  expect(reused).toMatchObject({ targetCount: 1, sourceBatchCount: 1, publicationEligible: false });
  expect(reused.completionId).not.toBe(result.completionId);
  expect(
    (
      await pool.query(
        'SELECT to_jsonb(c) AS row FROM outcome_external_historical_capture_completion c WHERE completion_id=$1',
        [result.completionId]
      )
    ).rows
  ).toEqual(original);
  expect(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM outcome_external_historical_capture_completion_result WHERE evidence_batch_id=$1',
        [fixture.target.evidenceBatchId]
      )
    ).rows[0].count
  ).toBe(2);
  expect(
    (
      await pool.query<{ current: boolean }>(
        "SELECT outcome_external_retained_target_is_current($1::jsonb,'test_fixture','AFLM',clock_timestamp()+interval '2 hours') AS current",
        [JSON.stringify(plan.content.targets[0])]
      )
    ).rows[0]!.current
  ).toBe(false);
});
