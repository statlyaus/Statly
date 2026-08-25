import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradePrivateValuationCaptureBindingRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationCaptureBindingRepository';
import { PostgresAflTradePrivateValuationScheduleRepository } from '@/server/aflTradeIntelligence/valuation/postgresPrivateValuationScheduling';
import { createAflTradePrivateValuationRawDataCoordinator } from '@/server/aflTradeIntelligence/valuation/privateValuationRawDataCoordinator';
import { createAflTradePrivateValuationDispatchRequestId } from '@/server/aflTradeIntelligence/valuation/privateValuationScheduling';
import { stageLocalAflTradeFitzRoyFixture } from '../testUtils/localFitzRoyStagingFixture';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('A disposable AFL_OUTCOMES_TEST_DATABASE_URL is required.');
  })();
const schemaName = `afl_private_capture_binding_${process.pid}_${Date.now()}`;
const dispatchScheduledFor = '2026-08-12T00:00:05.000Z';
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

async function enqueueDispatch(
  operationKey: string,
  scheduledFor = dispatchScheduledFor
): Promise<string> {
  const connection = await outcomesPool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    const result = await connection.query<{ request_id: string }>(
      `SELECT enqueue_outcome_private_valuation_dispatch(
         'afl-men:2026-trades','ad_hoc',
         $2::timestamptz,$1
       ) AS request_id`,
      [operationKey, scheduledFor]
    );
    await connection.query('COMMIT');
    return result.rows[0]!.request_id;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function currentNormalizationRunId(): Promise<string> {
  const result = await outcomesPool.query<{ normalization_run_id: string }>(
    `SELECT normalization_run_id
       FROM outcome_provider_normalization_run
      WHERE finalized_at IS NOT NULL
      ORDER BY completed_at DESC,normalization_run_id DESC
      LIMIT 1`
  );
  return result.rows[0]!.normalization_run_id;
}

async function makeDispatchDue(requestId: string): Promise<void> {
  const connection = await outcomesPool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    await connection.query(
      `UPDATE outcome_private_valuation_dispatch_request
          SET available_at=statement_timestamp()-interval '1 second'
        WHERE request_id=$1 AND status='pending'`,
      [requestId]
    );
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scopedDatabaseUrl() });
  await stageLocalAflTradeFitzRoyFixture(createPgAflOutcomeSqlClient(outcomesPool));
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
    throw new AggregateError(failures, 'Capture-binding PostgreSQL cleanup failed.');
  }
});

afterEach(async () => {
  const connection = await outcomesPool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SET LOCAL ROLE afl_trade_private_valuation_scheduler_owner');
    await connection.query(
      `UPDATE outcome_private_valuation_dispatch_attempt attempt
          SET finished_at=date_trunc('milliseconds',statement_timestamp()),
              outcome='completed',
              result_json=jsonb_build_object('state','unexpected_failure')
         FROM outcome_private_valuation_dispatch_request request
        WHERE request.status='claimed'
          AND attempt.claim_id=request.claim_id
          AND attempt.finished_at IS NULL`
    );
    await connection.query(
      `UPDATE outcome_private_valuation_dispatch_request
          SET status='completed',
              completed_at=date_trunc('milliseconds',statement_timestamp()),
              result_json=jsonb_build_object('state','unexpected_failure'),
              claim_id=NULL,
              lease_token_sha256=NULL,
              lease_expires_at=NULL,
              claimed_at=NULL
        WHERE status='claimed'`
    );
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
});

describe.sequential('private valuation capture binding in PostgreSQL', () => {
  it('accepts database-derived source custody and exactly replays it after restart', async () => {
    const sql = createPgAflOutcomeSqlClient(outcomesPool);
    const schedule = new PostgresAflTradePrivateValuationScheduleRepository(sql);
    const requestId = await enqueueDispatch('capture-binding-restart');
    const claim = await schedule.claim('system:weekly-valuation-coordinator', requestId);
    const normalizationRunId = await currentNormalizationRunId();
    expect(claim).not.toBeNull();

    const binding = await new PostgresAflTradePrivateValuationCaptureBindingRepository(sql).accept({
      request: claim!.request,
      claim: { claimId: claim!.claimId, leaseToken: claim!.leaseToken },
      normalizationRunId,
    });

    expect(binding.content).toMatchObject({
      request: claim!.request,
      dispatchClaimId: claim!.claimId,
      attemptSequence: 1,
      attemptNumber: 1,
      normalizationRunId,
      sourcePlan: {
        provider: 'footywire',
        dataset: 'Footywire historical player match statistics',
        capabilityId: 'footywire-player-stats',
        competition: 'AFLM',
        seasonYear: 2026,
        fieldMapId: 'footywire-player-stats-local-rehearsal-v1',
        gate0AReceiptId: expect.stringMatching(/^gate0a-evaluation:[a-f0-9]{64}$/),
      },
      environment: 'non_production',
      publicationEligible: false,
    });

    await schedule.reschedule({
      claimId: claim!.claimId,
      leaseToken: claim!.leaseToken,
      state: 'transient_failure',
    });
    await makeDispatchDue(requestId);
    const restartedSchedule = new PostgresAflTradePrivateValuationScheduleRepository(sql);
    const restartedClaim = await restartedSchedule.claim(
      'system:weekly-valuation-coordinator',
      requestId
    );
    expect(restartedClaim).not.toBeNull();
    expect(restartedClaim!.claimId).not.toBe(claim!.claimId);
    const restarted = new PostgresAflTradePrivateValuationCaptureBindingRepository(sql);
    await expect(restarted.load(restartedClaim!.request)).resolves.toEqual(binding);
    const capture = vi.fn();
    const coordinator = createAflTradePrivateValuationRawDataCoordinator({
      captureBindings: restarted,
      capture,
    });
    await expect(
      coordinator.run({
        request: restartedClaim!.request,
        claim: {
          claimId: restartedClaim!.claimId,
          leaseToken: restartedClaim!.leaseToken,
        },
      })
    ).resolves.toMatchObject({
      state: 'capture_accepted',
      binding,
      idempotentReplay: true,
    });
    expect(capture).not.toHaveBeenCalled();

    const stored = await outcomesPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM outcome_private_valuation_capture_binding
        WHERE request_id=$1`,
      [requestId]
    );
    expect(stored.rows[0]?.count).toBe('1');
  });

  it('rejects a lost claim or a normalization outside retained source custody', async () => {
    const sql = createPgAflOutcomeSqlClient(outcomesPool);
    const schedule = new PostgresAflTradePrivateValuationScheduleRepository(sql);
    const repository = new PostgresAflTradePrivateValuationCaptureBindingRepository(sql);
    const requestId = await enqueueDispatch('capture-binding-fence');
    const claim = await schedule.claim('system:weekly-valuation-coordinator', requestId);
    const normalizationRunId = await currentNormalizationRunId();
    expect(claim).not.toBeNull();

    await expect(
      repository.accept({
        request: claim!.request,
        claim: { claimId: claim!.claimId, leaseToken: '0'.repeat(64) },
        normalizationRunId,
      })
    ).rejects.toThrow(/claim|fence|lease/i);
    await expect(
      repository.accept({
        request: claim!.request,
        claim: { claimId: claim!.claimId, leaseToken: claim!.leaseToken },
        normalizationRunId: `provider-normalization-run:${'f'.repeat(64)}`,
      })
    ).rejects.toThrow(/normalization|source custody/i);
  });

  it('rejects a caller-request mismatch before retaining a binding', async () => {
    const sql = createPgAflOutcomeSqlClient(outcomesPool);
    const schedule = new PostgresAflTradePrivateValuationScheduleRepository(sql);
    const repository = new PostgresAflTradePrivateValuationCaptureBindingRepository(sql);
    const requestId = await enqueueDispatch('capture-binding-request-mismatch');
    const claim = await schedule.claim('system:weekly-valuation-coordinator', requestId);
    const normalizationRunId = await currentNormalizationRunId();
    expect(claim).not.toBeNull();
    const authorityKey = 'another-dispatch';
    const conflictingRequest = {
      ...claim!.request,
      requestId: createAflTradePrivateValuationDispatchRequestId({
        scopeKey: claim!.request.scopeKey,
        trigger: claim!.request.trigger,
        scheduledFor: claim!.request.scheduledFor,
        authorityKey,
      }),
      authorityKey,
    };

    await expect(
      repository.accept({
        request: conflictingRequest,
        claim: { claimId: claim!.claimId, leaseToken: claim!.leaseToken },
        normalizationRunId,
      })
    ).rejects.toThrow(/requested dispatch|request/i);
    const stored = await outcomesPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM outcome_private_valuation_capture_binding
        WHERE request_id=$1`,
      [requestId]
    );
    expect(stored.rows[0]?.count).toBe('0');
  });

  it('rejects source custody created before the dispatch was scheduled', async () => {
    const sql = createPgAflOutcomeSqlClient(outcomesPool);
    const schedule = new PostgresAflTradePrivateValuationScheduleRepository(sql);
    const repository = new PostgresAflTradePrivateValuationCaptureBindingRepository(sql);
    const requestId = await enqueueDispatch(
      'capture-binding-old-source',
      new Date(Date.now() - 1_000).toISOString()
    );
    const claim = await schedule.claim('system:weekly-valuation-coordinator', requestId);
    expect(claim).not.toBeNull();

    await expect(
      repository.accept({
        request: claim!.request,
        claim: { claimId: claim!.claimId, leaseToken: claim!.leaseToken },
        normalizationRunId: await currentNormalizationRunId(),
      })
    ).rejects.toThrow(/source custody/i);
    const stored = await outcomesPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM outcome_private_valuation_capture_binding
        WHERE request_id=$1`,
      [requestId]
    );
    expect(stored.rows[0]?.count).toBe('0');
  });

  it('judges capture acceptance expiry after acquiring its dispatch locks', async () => {
    const requestId = await enqueueDispatch('capture-binding-blocked-expiry');
    const leaseTokenSha256 = '4'.repeat(64);
    const claimed = await outcomesPool.query<{ claim_id: string }>(
      `SELECT claim_id
         FROM claim_outcome_private_valuation_dispatch($1,$2,5,$3)`,
      ['blocked-capture-worker', leaseTokenSha256, requestId]
    );
    const normalizationRunId = await currentNormalizationRunId();
    const blocker = await outcomesPool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT request_id
           FROM outcome_private_valuation_dispatch_request
          WHERE request_id=$1
          FOR UPDATE`,
        [requestId]
      );
      const guardedAcceptance = outcomesPool
        .query(`SELECT accept_outcome_private_valuation_dispatch_capture($1,$2,$3,$4)`, [
          requestId,
          claimed.rows[0]!.claim_id,
          leaseTokenSha256,
          normalizationRunId,
        ])
        .then(
          () => ({ state: 'fulfilled' as const, error: null }),
          (error: unknown) => ({ state: 'rejected' as const, error })
        );

      await new Promise((resolve) => setTimeout(resolve, 5_300));
      await blocker.query('COMMIT');
      const outcome = await guardedAcceptance;
      expect(outcome.state).toBe('rejected');
      expect(String(outcome.error)).toMatch(/lost its live dispatch claim fence/i);
    } catch (error) {
      await blocker.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      blocker.release();
    }

    await expect(
      outcomesPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM outcome_private_valuation_capture_binding
          WHERE request_id=$1`,
        [requestId]
      )
    ).resolves.toMatchObject({ rows: [{ count: '0' }] });
  }, 15_000);

  it('serializes field-map supersession while preserving exact accepted replay', async () => {
    const normalizationRunId = await currentNormalizationRunId();
    const sql = createPgAflOutcomeSqlClient(outcomesPool);
    const schedule = new PostgresAflTradePrivateValuationScheduleRepository(sql);
    const repository = new PostgresAflTradePrivateValuationCaptureBindingRepository(sql);
    const acceptedRequestId = await enqueueDispatch('capture-binding-before-field-map-change');
    const acceptedClaim = await schedule.claim(
      'system:weekly-valuation-coordinator',
      acceptedRequestId
    );
    expect(acceptedClaim).not.toBeNull();
    const acceptedBinding = await repository.accept({
      request: acceptedClaim!.request,
      claim: { claimId: acceptedClaim!.claimId, leaseToken: acceptedClaim!.leaseToken },
      normalizationRunId,
    });
    await schedule.reschedule({
      claimId: acceptedClaim!.claimId,
      leaseToken: acceptedClaim!.leaseToken,
      state: 'transient_failure',
    });

    const rejectedRequestId = await enqueueDispatch('capture-binding-during-field-map-change');
    const rejectedClaim = await schedule.claim(
      'system:weekly-valuation-coordinator',
      rejectedRequestId
    );
    expect(rejectedClaim).not.toBeNull();

    const reviewer = await outcomesPool.connect();
    try {
      await reviewer.query('BEGIN');
      await reviewer.query(
        `INSERT INTO outcome_review_decision
          (decision_id,subject_type,subject_id,decision,supersedes_decision_id,
           rationale,evidence_json,decided_by,decided_at)
         SELECT $1,'provider_field_map',field_map_id,'rejected',approval_decision_id,
                'Superseded for capture-binding current-authority regression.',
                jsonb_build_object('fieldMapSha256',field_map_sha256),
                'capture-binding-regression-reviewer',statement_timestamp()
           FROM outcome_provider_field_map
          WHERE field_map_id='footywire-player-stats-local-rehearsal-v1'`,
        [`review-decision:${'8'.repeat(64)}`]
      );

      const guardedAcceptance = repository
        .accept({
          request: rejectedClaim!.request,
          claim: { claimId: rejectedClaim!.claimId, leaseToken: rejectedClaim!.leaseToken },
          normalizationRunId,
        })
        .then(
          (binding) => ({ state: 'fulfilled' as const, binding, error: null }),
          (error: unknown) => ({ state: 'rejected' as const, binding: null, error })
        );

      await expect(repository.load(acceptedClaim!.request)).resolves.toEqual(acceptedBinding);
      await expect(
        Promise.race([
          guardedAcceptance.then(() => 'settled' as const),
          new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
        ])
      ).resolves.toBe('pending');

      await reviewer.query('COMMIT');
      const rejected = await guardedAcceptance;
      expect(rejected.state).toBe('rejected');
      expect(String(rejected.error)).toMatch(/field map is no longer currently approved/i);
    } catch (error) {
      await reviewer.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      reviewer.release();
    }

    await expect(
      outcomesPool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM outcome_private_valuation_capture_binding
          WHERE request_id=ANY($1::text[])`,
        [[acceptedRequestId, rejectedRequestId]]
      )
    ).resolves.toMatchObject({ rows: [{ count: '1' }] });
  }, 10_000);

  it('denies direct capture-binding writes to the coordinator runtime role', async () => {
    const connection = await outcomesPool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SET LOCAL ROLE afl_trade_private_evaluation_coordinator');
      await expect(
        connection.query(
          `INSERT INTO outcome_private_valuation_capture_binding (binding_id)
           VALUES ('private-valuation-capture-binding:${'0'.repeat(64)}')`
        )
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await connection.query('ROLLBACK').catch(() => undefined);
      connection.release();
    }
  });
});
