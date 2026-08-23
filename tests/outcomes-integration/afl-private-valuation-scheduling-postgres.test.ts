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

async function makeDispatchDue(requestId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    await client.query(
      `UPDATE outcome_private_valuation_dispatch_request
          SET available_at=transaction_timestamp()-interval '1 second'
        WHERE request_id=$1 AND status='pending'`,
      [requestId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

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
  await pool.query(
    readFileSync(
      join(
        process.cwd(),
        'prisma/afl-trade-outcomes/migrations/0070_private_valuation_dispatch_custody/migration.sql'
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
  await pool.query(`TRUNCATE outcome_private_valuation_dispatch_attempt,
    outcome_private_valuation_dispatch_request,
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
    const run = vi.fn(async () => {
      if (current) return { state: 'already_current' as const };
      current = true;
      return { state: 'activated' as const, batchId: 'batch:test' };
    });
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { run, repairCurrent: vi.fn() },
    });
    const dispatched = await Promise.all([
      dispatcher.dispatchOne(),
      dispatcher.dispatchOne(),
      dispatcher.dispatchOne(),
    ]);
    expect(dispatched.every(({ state }) => state === 'completed')).toBe(true);
    expect(run).toHaveBeenCalledTimes(3);
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

  it('passes the exact retained request and live claim fence to the coordinator', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'exact-claimed-request',
    });
    const run = vi.fn(async () => ({ state: 'already_current' as const }));
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { run, repairCurrent: vi.fn() },
      workerId: 'system:weekly-valuation-coordinator',
    });

    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'completed',
      requestId,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({
      request: {
        requestId,
        scopeKey: 'afl-men:2026-trades',
        trigger: 'ad_hoc',
        scheduledFor: expect.any(String),
        authorityKey: 'exact-claimed-request',
      },
      claim: {
        claimId: expect.stringMatching(/^private-valuation-dispatch-claim:/),
        leaseToken: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
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
    const run = vi.fn(async () => {
      await blocked;
      return { state: 'already_current' as const };
    });
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { run, repairCurrent: vi.fn() },
      heartbeatMilliseconds: 5,
    });
    const running = dispatcher.dispatchOne();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const originalLease = await pool.query<{ lease_expires_at: Date }>(
      `SELECT lease_expires_at
         FROM outcome_private_valuation_dispatch_request
        WHERE status='claimed'`
    );
    const originalLeaseExpiresAt = originalLease.rows[0]?.lease_expires_at;
    expect(originalLeaseExpiresAt).toBeInstanceOf(Date);
    await vi.waitFor(async () => {
      const renewal = await pool.query<{ request_renewed: boolean; attempt_renewed: boolean }>(
        `SELECT request.lease_expires_at>$1::timestamptz AS request_renewed,
                attempt.lease_expires_at>$1::timestamptz AS attempt_renewed
           FROM outcome_private_valuation_dispatch_request request
           JOIN outcome_private_valuation_dispatch_attempt attempt
             ON attempt.claim_id=request.claim_id
          WHERE request.status='claimed'`,
        [originalLeaseExpiresAt]
      );
      expect(renewal.rows[0]).toEqual({ request_renewed: true, attempt_renewed: true });
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
    expect(run).toHaveBeenCalledOnce();
  });

  it('never shortens a caller-selected long lease when heartbeating', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'long-lease-heartbeat',
    });
    const tokenSha256 = 'a'.repeat(64);
    const claimed = await pool.query<{ claim_id: string; lease_expires_at: Date }>(
      `SELECT claim_id,lease_expires_at
         FROM claim_outcome_private_valuation_dispatch($1,$2,3600,$3)`,
      ['long-lease-worker', tokenSha256, requestId]
    );
    const originalExpiry = claimed.rows[0]!.lease_expires_at;
    const renewed = await pool.query<{ renewed_until: Date }>(
      `SELECT heartbeat_outcome_private_valuation_dispatch($1,$2) AS renewed_until`,
      [claimed.rows[0]!.claim_id, tokenSha256]
    );

    expect(renewed.rows[0]!.renewed_until.getTime()).toBeGreaterThanOrEqual(
      originalExpiry.getTime()
    );
    await expect(
      pool.query<{ request_lease: Date; attempt_lease: Date }>(
        `SELECT request.lease_expires_at AS request_lease,
                attempt.lease_expires_at AS attempt_lease
           FROM outcome_private_valuation_dispatch_request request
           JOIN outcome_private_valuation_dispatch_attempt attempt
             ON attempt.claim_id=request.claim_id
          WHERE request.request_id=$1`,
        [requestId]
      )
    ).resolves.toMatchObject({
      rows: [{ request_lease: originalExpiry, attempt_lease: originalExpiry }],
    });
  });

  it('keeps one durable dispatch pending until trade retries reach a terminal result', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'retry-to-success',
    });
    const run = vi
      .fn()
      .mockResolvedValueOnce({ state: 'retry_pending', pendingTradeIds: ['trade-a'] })
      .mockResolvedValueOnce({ state: 'already_current' });
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { run, repairCurrent: vi.fn() },
    });
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'rescheduled',
      requestId,
    });
    await makeDispatchDue(requestId);
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'completed',
      result: { state: 'already_current' },
    });
    expect(run).toHaveBeenCalledTimes(2);
    await expect(
      pool.query(`SELECT count(*)::int AS count FROM outcome_private_valuation_dispatch_request`)
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('exhausts three durable transient failures without charging stale or cohort polling', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'bounded-dispatch-retries',
    });
    const reschedule = async (
      state: 'retry_pending' | 'stale_authority' | 'transient_failure',
      scheduleRepository = repository
    ) => {
      const claim = await scheduleRepository.claim('bounded-retry-worker', requestId);
      expect(claim).not.toBeNull();
      await scheduleRepository.reschedule({
        claimId: claim!.claimId,
        leaseToken: claim!.leaseToken,
        state,
      });
      await makeDispatchDue(requestId);
    };

    await reschedule('stale_authority');
    await reschedule('retry_pending');
    await reschedule('transient_failure');
    const restartedRepository = new PostgresAflTradePrivateValuationScheduleRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    await reschedule('transient_failure', restartedRepository);
    await reschedule('transient_failure', restartedRepository);

    await expect(repository.claim('restart-worker', requestId)).resolves.toBeNull();
    await expect(
      pool.query<{
        status: string;
        claim_sequence: number;
        transient_failure_count: number;
        result_json: unknown;
      }>(
        `SELECT status,claim_sequence,transient_failure_count,result_json
           FROM outcome_private_valuation_dispatch_request WHERE request_id=$1`,
        [requestId]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          status: 'completed',
          claim_sequence: 5,
          transient_failure_count: 3,
          result_json: { state: 'exhausted' },
        },
      ],
    });
    await expect(
      pool.query<{ attempt_sequence: number; attempt_number: number; outcome: string }>(
        `SELECT attempt_sequence,attempt_number,outcome
           FROM outcome_private_valuation_dispatch_attempt
          WHERE request_id=$1 ORDER BY attempt_sequence`,
        [requestId]
      )
    ).resolves.toMatchObject({
      rows: [
        { attempt_sequence: 1, attempt_number: 1, outcome: 'stale_authority' },
        { attempt_sequence: 2, attempt_number: 1, outcome: 'retry_pending' },
        { attempt_sequence: 3, attempt_number: 1, outcome: 'transient_failure' },
        { attempt_sequence: 4, attempt_number: 2, outcome: 'transient_failure' },
        { attempt_sequence: 5, attempt_number: 3, outcome: 'transient_failure' },
      ],
    });
  });

  it('charges expired leases to the same durable three-attempt budget', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'expired-lease-budget',
    });
    const tokenSha256 = 'b'.repeat(64);
    const claim = async () =>
      pool.query<{ claim_id: string }>(
        `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,5,$3)`,
        ['expiry-worker', tokenSha256, requestId]
      );

    expect((await claim()).rows).toHaveLength(1);
    await pool.query(`SELECT pg_sleep(5.05)`);
    expect((await claim()).rows).toHaveLength(1);
    await pool.query(`SELECT pg_sleep(5.05)`);
    expect((await claim()).rows).toHaveLength(1);
    await pool.query(`SELECT pg_sleep(5.05)`);
    expect((await claim()).rows).toHaveLength(0);

    await expect(
      pool.query(
        `SELECT status,transient_failure_count,result_json
           FROM outcome_private_valuation_dispatch_request WHERE request_id=$1`,
        [requestId]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          status: 'completed',
          transient_failure_count: 3,
          result_json: { state: 'exhausted' },
        },
      ],
    });
    await expect(
      pool.query(
        `SELECT attempt_sequence,attempt_number,outcome
           FROM outcome_private_valuation_dispatch_attempt
          WHERE request_id=$1 ORDER BY attempt_sequence`,
        [requestId]
      )
    ).resolves.toMatchObject({
      rows: [
        { attempt_sequence: 1, attempt_number: 1, outcome: 'lease_expired' },
        { attempt_sequence: 2, attempt_number: 2, outcome: 'lease_expired' },
        { attempt_sequence: 3, attempt_number: 3, outcome: 'lease_expired' },
      ],
    });
  }, 25_000);

  it('continues to the next due dispatch after an expired request exhausts', async () => {
    const exhaustedRequestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'expired-head-does-not-mask-next',
    });
    for (let attempt = 1; attempt < 3; attempt += 1) {
      const claim = await repository.claim('expiry-budget-worker', exhaustedRequestId);
      expect(claim).not.toBeNull();
      await repository.reschedule({
        claimId: claim!.claimId,
        leaseToken: claim!.leaseToken,
        state: 'transient_failure',
      });
      await makeDispatchDue(exhaustedRequestId);
    }

    const expiringClaim = await pool.query<{ claim_id: string }>(
      `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,5,$3)`,
      ['expiry-budget-worker', 'c'.repeat(64), exhaustedRequestId]
    );
    expect(expiringClaim.rows).toHaveLength(1);
    const nextRequestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'due-after-expired-head',
    });

    await pool.query(`SELECT pg_sleep(5.05)`);
    const nextClaim = await repository.claim('next-due-worker');

    expect(nextClaim?.request.requestId).toBe(nextRequestId);
    await expect(
      pool.query(
        `SELECT status,transient_failure_count,result_json
           FROM outcome_private_valuation_dispatch_request WHERE request_id=$1`,
        [exhaustedRequestId]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          status: 'completed',
          transient_failure_count: 3,
          result_json: { state: 'exhausted' },
        },
      ],
    });
  }, 10_000);

  it('keeps another coordinator from reading or using a live worker fence', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'worker-fence-is-private',
    });
    const claim = await repository.claim('owning-worker', requestId);
    expect(claim).not.toBeNull();

    const restricted = await pool.connect();
    try {
      await restricted.query('BEGIN');
      await restricted.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        restricted.query(
          `SELECT lease_token_sha256 FROM outcome_private_valuation_dispatch_request
            WHERE request_id=$1`,
          [requestId]
        )
      ).rejects.toThrow('permission denied');
      await restricted.query('ROLLBACK');

      await restricted.query('BEGIN');
      await restricted.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        restricted.query(`SELECT * FROM outcome_private_valuation_dispatch_attempt`)
      ).rejects.toThrow('permission denied');
      await restricted.query('ROLLBACK');

      await restricted.query('BEGIN');
      await restricted.query(`SET LOCAL ROLE afl_trade_private_evaluation_coordinator`);
      await expect(
        restricted.query(
          `SELECT complete_outcome_private_valuation_dispatch($1,$2,$3::jsonb)`,
          [claim!.claimId, 'd'.repeat(64), JSON.stringify({ state: 'already_current' })]
        )
      ).rejects.toThrow('claim was lost');
      await restricted.query('ROLLBACK');
    } finally {
      restricted.release();
    }

    await expect(repository.load(requestId)).resolves.toEqual({ status: 'claimed', result: null });
    await repository.complete({
      claimId: claim!.claimId,
      leaseToken: claim!.leaseToken,
      result: { state: 'already_current' },
    });
  });

  it('fences an expired claimant after another worker reclaims the request', async () => {
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey: 'expired-worker-is-fenced',
    });
    const firstTokenSha256 = 'e'.repeat(64);
    const first = await pool.query<{ claim_id: string }>(
      `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,5,$3)`,
      ['first-worker', firstTokenSha256, requestId]
    );
    await pool.query(`SELECT pg_sleep(5.05)`);
    const secondTokenSha256 = 'f'.repeat(64);
    const second = await pool.query<{ claim_id: string }>(
      `SELECT claim_id FROM claim_outcome_private_valuation_dispatch($1,$2,120,$3)`,
      ['second-worker', secondTokenSha256, requestId]
    );

    await expect(
      pool.query(`SELECT heartbeat_outcome_private_valuation_dispatch($1,$2)`, [
        first.rows[0]!.claim_id,
        firstTokenSha256,
      ])
    ).rejects.toThrow('claim was lost');
    await expect(
      pool.query(`SELECT reschedule_outcome_private_valuation_dispatch($1,$2,$3)`, [
        first.rows[0]!.claim_id,
        firstTokenSha256,
        'retry_pending',
      ])
    ).rejects.toThrow('claim was lost');
    await expect(
      pool.query(`SELECT complete_outcome_private_valuation_dispatch($1,$2,$3::jsonb)`, [
        first.rows[0]!.claim_id,
        firstTokenSha256,
        JSON.stringify({ state: 'already_current' }),
      ])
    ).rejects.toThrow('claim was lost');
    await expect(
      pool.query(
        `SELECT status,claim_id,transient_failure_count
           FROM outcome_private_valuation_dispatch_request WHERE request_id=$1`,
        [requestId]
      )
    ).resolves.toMatchObject({
      rows: [
        {
          status: 'claimed',
          claim_id: second.rows[0]!.claim_id,
          transient_failure_count: 1,
        },
      ],
    });
  }, 10_000);

  it('judges completion, reschedule, and heartbeat expiry after their row locks are acquired', async () => {
    const requestIds = await Promise.all(
      ['blocked-completion', 'blocked-reschedule', 'blocked-heartbeat'].map((operationKey) =>
        repository.enqueueAdHoc({ scopeKey: 'afl-men:2026-trades', operationKey })
      )
    );
    const tokenSha256s = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)];
    const claims = await Promise.all(
      requestIds.map((requestId, index) =>
        pool.query<{ claim_id: string }>(
          `SELECT claim_id
             FROM claim_outcome_private_valuation_dispatch($1,$2,5,$3)`,
          [`blocked-worker-${index}`, tokenSha256s[index], requestId]
        )
      )
    );

    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT request_id
           FROM outcome_private_valuation_dispatch_request
          WHERE request_id=ANY($1::text[])
          ORDER BY request_id
          FOR UPDATE`,
        [requestIds]
      );

      const guardedCalls = [
        pool.query(`SELECT complete_outcome_private_valuation_dispatch($1,$2,$3::jsonb)`, [
          claims[0]!.rows[0]!.claim_id,
          tokenSha256s[0],
          JSON.stringify({ state: 'already_current' }),
        ]),
        pool.query(`SELECT reschedule_outcome_private_valuation_dispatch($1,$2,$3)`, [
          claims[1]!.rows[0]!.claim_id,
          tokenSha256s[1],
          'retry_pending',
        ]),
        pool.query(`SELECT heartbeat_outcome_private_valuation_dispatch($1,$2)`, [
          claims[2]!.rows[0]!.claim_id,
          tokenSha256s[2],
        ]),
      ].map((operation) =>
        operation.then(
          () => ({ state: 'fulfilled' as const, error: null }),
          (error: unknown) => ({ state: 'rejected' as const, error })
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 5_300));
      await blocker.query('COMMIT');
      const outcomes = await Promise.all(guardedCalls);
      for (const outcome of outcomes) {
        expect(outcome.state).toBe('rejected');
        expect(String(outcome.error)).toMatch(/claim was lost/i);
      }
    } catch (error) {
      await blocker.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      blocker.release();
    }

    await expect(
      pool.query(
        `SELECT status,result_json
           FROM outcome_private_valuation_dispatch_request
          WHERE request_id=ANY($1::text[])
          ORDER BY request_id`,
        [requestIds]
      )
    ).resolves.toMatchObject({
      rows: [
        { status: 'claimed', result_json: null },
        { status: 'claimed', result_json: null },
        { status: 'claimed', result_json: null },
      ],
    });
  }, 15_000);

  it('replays exhausted dispatch custody after restart without rerunning work', async () => {
    const operationKey = 'restart-safe-exhaustion';
    const requestId = await repository.enqueueAdHoc({
      scopeKey: 'afl-men:2026-trades',
      operationKey,
    });
    const run = vi.fn(async () => ({ state: 'transient_failure' as const }));
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { run, repairCurrent: vi.fn() },
    });

    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'rescheduled',
    });
    await makeDispatchDue(requestId);
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toMatchObject({
      state: 'rescheduled',
    });
    await makeDispatchDue(requestId);
    await expect(dispatcher.dispatchRequest(requestId)).resolves.toEqual({
      state: 'completed',
      requestId,
      result: { state: 'exhausted' },
    });
    expect(run).toHaveBeenCalledTimes(3);

    const restartedRepository = new PostgresAflTradePrivateValuationScheduleRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const restartedRun = vi.fn();
    const restarted = createPostgresAflTradePrivateValuationDispatcher({
      repository: restartedRepository,
      runner: { run: restartedRun, repairCurrent: vi.fn() },
    });
    await expect(
      restartedRepository.enqueueAdHoc({
        scopeKey: 'afl-men:2026-trades',
        operationKey,
      })
    ).resolves.toBe(requestId);
    await expect(restarted.dispatchRequest(requestId)).resolves.toEqual({
      state: 'completed',
      requestId,
      result: { state: 'exhausted' },
    });
    expect(restartedRun).not.toHaveBeenCalled();
  });

  it('uses the same backend dispatcher for auditable repair', async () => {
    const repairCurrent = vi.fn(async () => ({ cycleId: 'repair-cycle' }));
    const dispatcher = createPostgresAflTradePrivateValuationDispatcher({
      repository,
      runner: { run: vi.fn(), repairCurrent },
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
