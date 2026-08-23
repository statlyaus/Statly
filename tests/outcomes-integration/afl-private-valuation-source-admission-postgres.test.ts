import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareLocalAflTradeFitzRoyFactualReleaseCandidate } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsal';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationSourceAdmission } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationSourceAdmission';
import { stageAcceptedPrivateValuationCaptureFixture } from '../testUtils/privateValuationFactualPreparationFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_fitzroy_factual_rehearsal_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const outcomesPool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
  max: 4,
});

function scopedDatabaseUrl(): string {
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  return scoped.toString();
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
});

afterAll(async () => {
  const failures: unknown[] = [];
  try {
    await outcomesPool.end();
  } catch (error) {
    failures.push(error);
  }
  try {
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch (error) {
    failures.push(error);
  }
  try {
    await adminPool.end();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Private source-admission PostgreSQL cleanup failed.');
  }
});

describe.sequential('private valuation source admission in PostgreSQL', () => {
  it('admits and exactly replays one clean accepted capture without changing public authority', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const staged = await stageAcceptedPrivateValuationCaptureFixture(
      client,
      'private-source-admission-tracer'
    );
    await prepareLocalAflTradeFitzRoyFactualReleaseCandidate(client);
    const before = await outcomesPool.query<{
      revision: number;
      events: string;
      active_releases: string;
      projections: string;
    }>(
      `SELECT
        (SELECT revision FROM outcome_registry_head WHERE singleton_id=1) AS revision,
        (SELECT count(*)::text FROM outcome_registry_event) AS events,
        (SELECT count(*)::text FROM outcome_active_release) AS active_releases,
        (SELECT count(*)::text FROM outcome_projection_manifest) AS projections`
    );

    const admissionInput = {
      requestId: staged.requestId,
      claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
    };
    const concurrent = await Promise.all([
      new PostgresAflTradePrivateValuationSourceAdmission(client).admit(admissionInput),
      new PostgresAflTradePrivateValuationSourceAdmission(client).admit(admissionInput),
    ]);
    expect(concurrent.map(({ state }) => state).sort()).toEqual([
      'admitted',
      'already_admitted',
    ]);
    const result = concurrent.find(({ state }) => state === 'admitted');
    if (!result) throw new TypeError('Concurrent admission did not retain one created result.');

    expect(result).toMatchObject({
      state: 'admitted',
      admission: {
        content: {
          requestId: staged.requestId,
          captureBindingId: staged.binding.bindingId,
          sourceCaptureId: staged.binding.content.sourceCaptureId,
          normalizationRunId: staged.binding.content.normalizationRunId,
          factBatchId: expect.stringMatching(/^source-fact-batch:/),
          factualRunId: expect.stringMatching(/^factual-reconciliation-run:/),
          principalId: 'system:weekly-valuation-coordinator',
          environment: 'non_production',
          publicationEligible: false,
          publicationProhibited: true,
        },
      },
    });
    await expect(
      outcomesPool.query<{ status: string }>(
        `SELECT status::text FROM outcome_source_capture WHERE capture_id=$1`,
        [staged.binding.content.sourceCaptureId]
      )
    ).resolves.toMatchObject({ rows: [{ status: 'approved' }] });

    const restarted = await new PostgresAflTradePrivateValuationSourceAdmission(client).admit({
      requestId: staged.requestId,
      claim: { claimId: staged.claim.claimId, leaseToken: staged.claim.leaseToken },
    });
    expect(restarted).toEqual({ state: 'already_admitted', admission: result.admission });
    await expect(
      outcomesPool.query(
        `SELECT
          (SELECT revision FROM outcome_registry_head WHERE singleton_id=1) AS revision,
          (SELECT count(*)::text FROM outcome_registry_event) AS events,
          (SELECT count(*)::text FROM outcome_active_release) AS active_releases,
          (SELECT count(*)::text FROM outcome_projection_manifest) AS projections`
      )
    ).resolves.toMatchObject({ rows: before.rows });
    await expect(
      outcomesPool.query<{ admissions: string }>(
        `SELECT count(*)::text AS admissions
           FROM outcome_private_valuation_source_admission
          WHERE request_id=$1`,
        [staged.requestId]
      )
    ).resolves.toMatchObject({ rows: [{ admissions: '1' }] });
    await expect(
      outcomesPool.query(
        `UPDATE outcome_source_capture SET status='staged' WHERE capture_id=$1`,
        [staged.binding.content.sourceCaptureId]
      )
    ).rejects.toThrow(/requires exact automated non-production admission/);
    await expect(
      client.transaction(async (transaction) => {
        await transaction.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
        await transaction.query(
          `UPDATE outcome_source_capture SET status='staged' WHERE capture_id=$1`,
          [staged.binding.content.sourceCaptureId]
        );
      })
    ).rejects.toThrow(/permission denied/);
  });
});
