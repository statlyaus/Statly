import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import {
  PostgresAflTradePrivateValuationScheduleRepository,
  createPostgresAflTradePrivateValuationDispatcher,
} from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_valuation_schedule_${process.pid}_${Date.now()}`;
const pool = new Pool({
  connectionString: databaseUrl,
  max: 4,
  options: `-c search_path=${schemaName}`,
});
const repository = new PostgresAflTradePrivateValuationScheduleRepository(
  createPgAflOutcomeSqlClient(pool)
);

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
  if (canonicalFunction === undefined) throw new Error('Canonical JSON SQL function was not found.');
  await pool.query(canonicalFunction);
  await pool.query(`CREATE TABLE outcome_current_prepared_valuation_input_set (
    scope_key text PRIMARY KEY,prepared_input_set_id text NOT NULL,revision integer NOT NULL
  )`);
  await pool.query(`CREATE TABLE outcome_current_governed_valuation_model_pair (
    scope_key text PRIMARY KEY,qualification_id text NOT NULL,work_id text NOT NULL,revision integer NOT NULL
  )`);
  await pool.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0069_private_valuation_dispatch/migration.sql'
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
  await pool.query(`TRUNCATE outcome_private_valuation_dispatch_request,
    outcome_current_prepared_valuation_input_set,outcome_current_governed_valuation_model_pair`);
  await pool.query(
    `INSERT INTO outcome_current_prepared_valuation_input_set VALUES
      ('afl-men:2026-trades','prepared:test',1)`
  );
});

describe('private valuation scheduling PostgreSQL boundary', () => {
  it('coalesces startup catch-up and retains newly-qualified immediate work after commit', async () => {
    await expect(repository.enqueueStartupCatchUp('2026-06-03T03:00:00.000Z')).resolves.toHaveLength(
      1
    );
    await expect(repository.enqueueStartupCatchUp('2026-07-22T03:00:00.000Z')).resolves.toHaveLength(
      1
    );

    await pool.query(`BEGIN`);
    await pool.query(
      `INSERT INTO outcome_current_governed_valuation_model_pair VALUES
        ('afl-men:2026-trades','qualification:test','work:test',1)`
    );
    await pool.query(`COMMIT`);

    await expect(
      pool.query(
        `SELECT trigger_kind,status,result_json FROM outcome_private_valuation_dispatch_request
          ORDER BY scheduled_for`
      )
    ).resolves.toMatchObject({
      rows: [
        {
          trigger_kind: 'weekly',
          status: 'completed',
          result_json: { state: 'superseded_by_startup_catch_up' },
        },
        { trigger_kind: 'weekly', status: 'pending' },
        { trigger_kind: 'model_qualified', status: 'pending' },
      ],
    });
  });

  it('converges overlapping weekly, model, and ad-hoc triggers on current authority', async () => {
    const requestedAt = '2026-07-22T03:00:00.000Z';
    await repository.enqueueStartupCatchUp(requestedAt);
    await pool.query(
      `INSERT INTO outcome_current_governed_valuation_model_pair VALUES
        ('afl-men:2026-trades','qualification:test','work:test',1)`
    );
    const first = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'manual-check-1',
    });
    await expect(
      repository.enqueueAdHoc({
        scopeKey: 'afl-men:2026-trades',
        operationKey: 'manual-check-1',
      })
    ).resolves.toBe(first);

    let current = false;
    const runCurrent = vi.fn(async () => {
      if (current) return { state: 'already_current' as const };
      current = true;
      return { state: 'activated' as const, batchId: 'batch:test' };
    });
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { runCurrent, repairCurrent: vi.fn() },
    });
    const dispatched = await Promise.all([
      dispatcher.dispatchOne(),
      dispatcher.dispatchOne(),
      dispatcher.dispatchOne(),
    ]);
    expect(dispatched.every(({ state }) => state === 'completed')).toBe(true);
    expect(runCurrent).toHaveBeenCalledTimes(3);
    await expect(dispatcher.dispatchOne()).resolves.toEqual({ state: 'idle' });
    const retained = await pool.query<{ result_json: { state: string } }>(
      `SELECT result_json FROM outcome_private_valuation_dispatch_request
        WHERE status='completed' ORDER BY request_id`
    );
    expect(retained.rows.map(({ result_json }) => result_json.state).sort()).toEqual([
      'activated',
      'already_current',
      'already_current',
    ]);
    expect(first).toMatch(/^private-valuation-dispatch:/);
  });

  it('renews a slow dispatch lease so another worker cannot reclaim it', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'slow-run',
    });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runCurrent = vi.fn(async () => {
      await blocked;
      return { state: 'already_current' as const };
    });
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { runCurrent, repairCurrent: vi.fn() },
      heartbeatMilliseconds: 5,
    });
    const running = dispatcher.dispatchOne();
    await vi.waitFor(() => expect(runCurrent).toHaveBeenCalledOnce());
    const shortenedLease = await pool.query<{ lease_expires_at: Date }>(
      `UPDATE outcome_private_valuation_dispatch_request
          SET lease_expires_at=transaction_timestamp()+interval '250 milliseconds'
        WHERE status='claimed'
        RETURNING lease_expires_at`
    );
    const shortenedLeaseExpiresAt = shortenedLease.rows[0]?.lease_expires_at;
    expect(shortenedLeaseExpiresAt).toBeInstanceOf(Date);
    await vi.waitFor(async () => {
      const renewal = await pool.query<{ renewed: boolean }>(
        `SELECT lease_expires_at>$1::timestamptz+interval '60 seconds' AS renewed
           FROM outcome_private_valuation_dispatch_request
          WHERE status='claimed'`,
        [shortenedLeaseExpiresAt]
      );
      expect(renewal.rows[0]?.renewed).toBe(true);
    });
    await vi.waitFor(async () => {
      const clock = await pool.query<{ original_lease_expired: boolean }>(
        `SELECT transaction_timestamp()>$1::timestamptz AS original_lease_expired`,
        [shortenedLeaseExpiresAt]
      );
      expect(clock.rows[0]?.original_lease_expired).toBe(true);
    });
    await expect(repository.claim('second-worker')).resolves.toBeNull();
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toEqual({
      state: 'waiting',
      requestId,
    });
    release();
    await expect(running).resolves.toMatchObject({ state: 'completed' });
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'completed',
      requestId,
      result: { state: 'already_current' },
    });
    expect(runCurrent).toHaveBeenCalledOnce();
  });

  it('keeps one durable dispatch pending until trade retries reach a terminal result', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'retry-to-success',
    });
    const runCurrent = vi
      .fn()
      .mockResolvedValueOnce({ state: 'retry_pending', pendingTradeIds: ['trade-a'] })
      .mockResolvedValueOnce({ state: 'already_current' });
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { runCurrent, repairCurrent: vi.fn() },
    });
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'rescheduled',
      requestId,
    });
    await pool.query(
      `UPDATE outcome_private_valuation_dispatch_request
          SET available_at=transaction_timestamp()-interval '1 second'
        WHERE request_id=$1`,
      [requestId]
    );
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'completed',
      result: { state: 'already_current' },
    });
    expect(runCurrent).toHaveBeenCalledTimes(2);
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM outcome_private_valuation_dispatch_request`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('uses the same backend dispatcher for auditable repair', async () => {
    const repairCurrent = vi.fn(async () => ({ cycleId: 'repair-cycle' }));
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { runCurrent: vi.fn(), repairCurrent },
    });
    await expect(
      dispatcher.repairCurrent(
        'afl-men:2026-trades',
        'Corrected retained source outage.',
        `cohort-execution-repair:${'a'.repeat(64)}`
      )
    ).resolves.toEqual({ cycleId: 'repair-cycle' });
    expect(repairCurrent).toHaveBeenCalledOnce();
  });

  it('rejects forged trigger kinds, future weekly work, and fabricated completion JSON', async () => {
    const restricted = await pool.connect();
    try {
      await restricted.query('BEGIN');
      await restricted.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        restricted.query(
          `SELECT enqueue_outcome_private_valuation_dispatch(
            'afl-men:2026-trades','model_qualified',transaction_timestamp(),'forged-work')`
        )
      ).rejects.toThrow('permission denied');
      await restricted.query('ROLLBACK');

      await restricted.query('BEGIN');
      await restricted.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        restricted.query(
          `SELECT coalesce_outcome_private_valuation_weekly_dispatch(
            'afl-men:2026-trades','2026-08-17T09:01:00.000Z'::timestamptz)`
        )
      ).rejects.toThrow('not exact current schedule');
      await restricted.query('ROLLBACK');
    } finally {
      restricted.release();
    }

    await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'forged-result',
    });
    const claim = await repository.claim('test-worker');
    expect(claim).not.toBeNull();
    await expect(
      pool.query(`SELECT complete_outcome_private_valuation_dispatch($1,$2,$3::jsonb)`, [
        claim!.claimId,
        createHash('sha256').update(claim!.leaseToken).digest('hex'),
        JSON.stringify({ state: 'already_current', publicationEligible: true }),
      ])
    ).rejects.toThrow('result is invalid');
  });

  it('serializes concurrent first use of one ad-hoc operation key', async () => {
    const requests = await Promise.all([
      repository.enqueueAdHoc({
        scopeKey: 'afl-men:2026-trades',
        operationKey: 'concurrent-manual-operation',
      }),
      repository.enqueueAdHoc({
        scopeKey: 'afl-men:2026-trades',
        operationKey: 'concurrent-manual-operation',
      }),
    ]);
    expect(requests[0]).toBe(requests[1]);
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM outcome_private_valuation_dispatch_request`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});
