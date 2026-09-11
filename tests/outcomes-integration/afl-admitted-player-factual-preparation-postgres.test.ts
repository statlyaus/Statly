import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { canonicalizeAflTradeJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';

import { admittedPlayerFactualPreparationFixture } from '../testUtils/admittedPlayerFactualPreparationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl = process.env.AFL_OUTCOMES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const readerRole = `afl_admitted_factual_reader_${process.pid}`;
const admin = new Pool({ connectionString: databaseUrl });
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
const restrictedPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName} -c role=afl_trade_private_evaluation_coordinator`,
});
const client = createPgAflOutcomeSqlClient(pool);
const restricted = createPgAflOutcomeSqlClient(restrictedPool);
const hash = (character: string) => character.repeat(64);

beforeAll(async () => {
  await admin.query(`DO $role$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='afl_trade_nonproduction_spell_metric_policy_reviewer') THEN
      CREATE ROLE afl_trade_nonproduction_spell_metric_policy_reviewer NOLOGIN;
    END IF;
  END $role$`);
  await admin.query('GRANT afl_trade_nonproduction_spell_metric_policy_reviewer TO statly_test');
  await admin.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await admin.query(`CREATE ROLE "${readerRole}" NOLOGIN`);
  await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${readerRole}"`);
  await admin.query(
    `GRANT USAGE ON SCHEMA "${schemaName}" TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
  await admin.query(
    `GRANT SELECT,INSERT ON "${schemaName}".outcome_review_decision TO afl_trade_nonproduction_spell_metric_policy_reviewer`
  );
});

afterAll(async () => {
  await restrictedPool.end();
  await pool.end();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS "${readerRole}"`);
  } finally {
    await admin.end();
  }
});

describe.sequential('admitted-player factual preparation in PostgreSQL', () => {
  it('retains both admitted captures, exactly replays, and rejects mismatched or stale custody', async () => {
    const fixture = await admittedPlayerFactualPreparationFixture(client);
    const { PostgresAflTradeAdmittedPlayerFactualPreparation } =
      await import('@/server/aflTradeIntelligence/valuation/postgresAdmittedPlayerFactualPreparation');
    const adapter = new PostgresAflTradeAdmittedPlayerFactualPreparation(restricted);
    const input = {
      requestId: fixture.staged.requestId,
      claim: { claimId: fixture.staged.claim.claimId, leaseToken: fixture.staged.claim.leaseToken },
      datasetId: fixture.dataset.datasetId,
      admissionId: fixture.admission.admissionId,
    };
    await expect(
      client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL ROLE "${readerRole}"`);
        await transaction.query(
          'SELECT load_outcome_admitted_player_factual_parent($1,$2,$3,$4,$5)',
          [input.requestId, input.claim.claimId, hash('0'), input.datasetId, input.admissionId]
        );
      })
    ).rejects.toThrow('permission denied for function load_outcome_admitted_player_factual_parent');
    await expect(
      adapter.prepare({ ...input, admissionId: `dataset-admission:${hash('f')}` })
    ).rejects.toThrow('Exact admitted-player factual parent is unavailable');
    const first = await adapter.prepare(input);
    expect(first.state).toBe('prepared');
    expect(first.output.content).toMatchObject({
      schemaVersion: 'afl-trade-private-valuation-factual-output/v2',
      admittedPlayerDataset: { datasetId: input.datasetId, admissionId: input.admissionId },
      sourceCaptures: ['a', 'b'].map((marker) => ({
        captureId: `source-capture:${hash(marker)}`,
        sourceSnapshotId: `source-snapshot:${hash(marker)}`,
        consumedFieldSetId: `consumed-field-set:${hash(marker)}`,
        consumedFieldSetSha256: hash(marker),
      })),
      publicationEligible: false,
      publicationProhibited: true,
    });
    await expect(adapter.prepare(input)).resolves.toEqual({
      state: 'already_prepared',
      output: first.output,
    });
    await expect(
      adapter.prepare({ ...input, admissionId: `dataset-admission:${hash('f')}` })
    ).rejects.toThrow('Retained admitted-player factual output binds another dataset or admission');
    await expect(
      adapter.prepare({ ...input, claim: { ...input.claim, leaseToken: hash('0') } })
    ).rejects.toThrow();
    const stored = await pool.query(
      `SELECT count(*)::integer AS count,
       bool_and(capture_binding_id IS NULL AND source_admission_id IS NULL
         AND normalization_run_id IS NULL AND fact_batch_id IS NULL AND factual_run_id IS NULL) AS no_legacy_parent
       FROM outcome_private_valuation_factual_output WHERE request_id=$1`,
      [input.requestId]
    );
    expect(stored.rows).toEqual([{ count: 1, no_legacy_parent: true }]);
    await client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL session_replication_role='replica'`);
      await transaction.query(
        `INSERT INTO outcome_record_state_commitment
         (event_revision,release_id,record_state_id,record_state_json) VALUES (2,$1,$2,$3::jsonb)`,
        [
          fixture.candidate.content.targetRelease.id,
          `outcome-release-record-state:${hash('f')}`,
          canonicalizeAflTradeJson({ state: 'withdrawn' }),
        ]
      );
    });
    await expect(adapter.prepare(input)).rejects.toThrow(
      'Exact admitted-player factual parent is unavailable'
    );
    await new PostgresAflTradePrivateValuationScheduleRepository(restricted).complete({
      ...input.claim,
      result: { state: 'exhausted' },
    });
    await expect(adapter.prepare(input)).rejects.toThrow(/claim|dispatch/i);
  });
});
