import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prepareLocalAflTradeFitzRoyAppearanceEvidence } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('An explicitly disposable PostgreSQL URL is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 4 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${schemaName}`,
});

it('retains missing source completion and exactly replays quarantined appearance-only games', async () => {
  const client = createPgAflOutcomeSqlClient(pool);
  const options = { missingCompletionStatus: true };
  const result = await prepareLocalAflTradeFitzRoyAppearanceEvidence(client, options);
  const match = result.factBatch.content.facts.find(
    (fact) => fact.content.factKind === 'match_universe'
  );
  expect(match?.content).toMatchObject({
    completion: { state: 'quarantined', providerStatus: null, reasonCode: 'status_missing' },
  });
  expect(result.factBatch.content.facts).toHaveLength(2);
  expect(result.factualRun.content.results[0]!.content.availability).toEqual({
    state: 'quarantined',
    numericValue: null,
    reasonCode: 'match_completion_quarantined',
  });
  const replay = await prepareLocalAflTradeFitzRoyAppearanceEvidence(client, options);
  expect(replay.idempotentReplay).toBe(true);
  expect(replay.factBatch).toEqual(result.factBatch);
  expect(replay.factualRun).toEqual(result.factualRun);
});
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
});
afterAll(async () => {
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await admin.end();
  }
});

// Explicit synthetic upstream bytes and review records; every database owner remains enabled.
it('retains and replays one complete appearance-only source batch and games run without a numeric fact or release candidate', async () => {
  const client = createPgAflOutcomeSqlClient(pool);
  const result = await prepareLocalAflTradeFitzRoyAppearanceEvidence(client);
  expect(result.kind).toBe('appearance_evidence');
  expect(result.factBatch.content.counts).toMatchObject({
    matchUniverse: 1,
    playerAppearances: 1,
    playerMatchMetrics: 0,
    playerSeasonMetrics: 0,
  });
  expect(result.factBatch.content.facts).toHaveLength(2);
  expect(result.factualRun.content.policy.content.sourceMetricRules).toEqual([]);
  expect(result.factualRun.content.results).toHaveLength(1);
  expect(result.factualRun.content.results[0]!.content).toMatchObject({
    resultKind: 'derived_games',
    metricCode: 'games',
    availability: { state: 'measured', numericValue: '1', reasonCode: null },
  });
  expect(result.idempotentReplay).toBe(false);
  expect(result).not.toHaveProperty('candidate');
  const replay = await prepareLocalAflTradeFitzRoyAppearanceEvidence(client);
  expect(replay.idempotentReplay).toBe(true);
  expect(replay.factBatch).toEqual(result.factBatch);
  expect(replay.factualRun).toEqual(result.factualRun);
});
