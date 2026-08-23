import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationHpnPreparation } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationHpnPreparation';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';

import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_private_valuation_hpn_preparation_${process.pid}_${Date.now()}`;
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
    throw new AggregateError(failures, 'Private HPN-preparation PostgreSQL cleanup failed.');
  }
});

describe.sequential('private valuation HPN preparation in PostgreSQL', () => {
  it('fails closed at the migrated dispatch boundary before invoking any stage owner', async () => {
    const prepareFactual = vi.fn();
    const captureSource = vi.fn();
    const preparation = new PostgresAflTradePrivateValuationHpnPreparation(
      createPgAflOutcomeSqlClient(outcomesPool),
      {
        factualPreparation: { prepare: prepareFactual },
        methodId: `hpn-pav-method:${'1'.repeat(64)}`,
        methodAuthority: { loadExact: vi.fn() },
        captureSource,
      }
    );

    await expect(
      preparation.prepare({
        requestId: `private-valuation-dispatch:${'2'.repeat(64)}`,
        claim: {
          claimId: `private-valuation-dispatch-claim:${'3'.repeat(64)}`,
          leaseToken: '4'.repeat(64),
        },
      })
    ).rejects.toThrow(/lost its live claim fence/i);
    expect(prepareFactual).not.toHaveBeenCalled();
    expect(captureSource).not.toHaveBeenCalled();
  });

  it('returns the exact request only to its live claim before Stage 2 begins', async () => {
    const client = createPgAflOutcomeSqlClient(outcomesPool);
    const schedule = new PostgresAflTradePrivateValuationScheduleRepository(client);
    const requestId = await client.transaction(async (transaction) => {
      await transaction.query(
        'SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner'
      );
      const retained = await transaction.query<{ readonly request_id: string }>(
        `SELECT enqueue_outcome_private_valuation_dispatch(
           'afl-men:2026-trades','ad_hoc','2026-08-12T00:00:00.000Z'::timestamptz,
           'hpn-preparation-claim-fence') AS request_id`
      );
      return retained.rows[0]!.request_id;
    });
    const retainedClaim = await schedule.claim(
      'system:weekly-valuation-coordinator',
      requestId
    );
    expect(retainedClaim).not.toBeNull();
    const prepareFactual = vi.fn(async () => {
      throw new Error('Stage 2 sentinel.');
    });
    const captureSource = vi.fn();
    const preparation = new PostgresAflTradePrivateValuationHpnPreparation(client, {
      factualPreparation: { prepare: prepareFactual },
      methodId: `hpn-pav-method:${'5'.repeat(64)}`,
      methodAuthority: { loadExact: vi.fn() },
      captureSource,
    });

    await expect(
      preparation.prepare({
        requestId,
        claim: {
          claimId: retainedClaim!.claimId,
          leaseToken: retainedClaim!.leaseToken,
        },
      })
    ).rejects.toThrow(/Stage 2 sentinel/i);
    expect(prepareFactual).toHaveBeenCalledWith({
      requestId,
      claim: {
        claimId: retainedClaim!.claimId,
        leaseToken: retainedClaim!.leaseToken,
      },
    });
    expect(captureSource).not.toHaveBeenCalled();

    await expect(
      preparation.prepare({
        requestId,
        claim: {
          claimId: retainedClaim!.claimId,
          leaseToken: '6'.repeat(64),
        },
      })
    ).rejects.toThrow(/lost its live claim fence/i);
    expect(prepareFactual).toHaveBeenCalledTimes(1);
  });
});
