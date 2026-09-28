import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { loadLocalHpnPavSeasonRows } from '@/server/aflTradeIntelligence/development/localHpnPavSeasonRows';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
// The local fitzRoy rehearsal owners only run inside a schema with this disposable naming pattern.
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const admin = new Pool({ connectionString: databaseUrl, max: 2 });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});
const client = createPgAflOutcomeSqlClient(pool);
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

// Runs the PAV report loader against the real migrated schema, so a query naming a column the
// decoded-row table does not have fails here rather than against a local capture.
it('loads each decoded row with the AFL Tables identity from its identity candidate', async () => {
  const options = { provider: 'afl_tables', profile: 'hpn_player_stats' } as const;
  const source = createLocalAflTradeFitzRoyFactualRehearsalFixture(options).command.capture;
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(client);
  await ledger.appendBatch({
    expectedRevision: (await ledger.load()).revision,
    records: [
      {
        sourceRights: source.sourceRights,
        proposal: source.ledger.proposals[0]!,
        decision: source.ledger.decisions[0]!,
      },
    ],
  });
  const staged = await stageLocalAflTradeFitzRoyFixture(client, options);
  const { normalizationRunId } = staged.staging.normalization;
  const run = await pool.query<{ capture_id: string; season_year: number }>(
    `SELECT capture_id, season_year FROM outcome_provider_decoded_row
      WHERE normalization_run_id = $1 LIMIT 1`,
    [normalizationRunId]
  );
  const { capture_id: captureId, season_year: season } = run.rows[0]!;
  const identities = await pool.query<{ native_entity_id: string | null }>(
    `SELECT identity.native_entity_id
       FROM outcome_provider_decoded_row decoded
       LEFT JOIN outcome_provider_identity_candidate identity USING (provider_decoded_row_id)
      WHERE decoded.normalization_run_id = $1`,
    [normalizationRunId]
  );
  expect(identities.rows.some(({ native_entity_id }) => native_entity_id !== null)).toBe(true);

  const loaded = await loadLocalHpnPavSeasonRows(pool, { season, captureId });

  expect(loaded.normalizationRunId).toBe(normalizationRunId);
  expect(loaded.rows.map(({ nativeEntityId }) => nativeEntityId).sort()).toEqual(
    identities.rows.map(({ native_entity_id }) => native_entity_id).sort()
  );
  await expect(
    loadLocalHpnPavSeasonRows(pool, { season, captureId, normalizationRunId: 'missing-run' })
  ).rejects.toThrow(`No finalized normalization run for capture ${captureId}.`);
});
