import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateValuationDispatchRequestSchema,
  createAflTradePrivateValuationDispatchRequestId,
  planAflTradePrivateValuationStartupCatchUp,
} from './privateValuationScheduling';

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const idSchema = z.string().trim().min(1).max(400);
const instantSchema = z.string().datetime({ offset: true });
const terminalResultSchema = z
  .object({
    state: z.enum(['activated', 'already_current', 'exhausted', 'unexpected_failure']),
  })
  .strict();

interface ClaimRow {
  readonly request_id: string;
  readonly request_json: unknown;
  readonly claim_id: string;
  readonly lease_expires_at: Date | string;
}

export interface AflTradePrivateValuationDispatchRunner {
  run(input: {
    readonly request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>;
    readonly claim: {
      readonly claimId: string;
      readonly leaseToken: string;
    };
  }): Promise<unknown>;
  repairCurrent(scopeKey: string, reason: string, repairOperationId: string): Promise<unknown>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class PostgresAflTradePrivateValuationScheduleRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async enqueueStartupCatchUp(now: string): Promise<readonly string[]> {
    const observedAt = instantSchema.parse(now);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const scopes = await transaction.query<{
        readonly scope_key: string;
        readonly last_scheduled_for: Date | string | null;
      }>(
        `SELECT current.scope_key,max(request.scheduled_for) FILTER (
                  WHERE request.trigger_kind='weekly') AS last_scheduled_for
           FROM outcome_current_prepared_valuation_input_set current
           LEFT JOIN outcome_private_valuation_dispatch_request request
             ON request.scope_key=current.scope_key
          GROUP BY current.scope_key ORDER BY current.scope_key`
      );
      const requestIds: string[] = [];
      for (const row of scopes.rows) {
        const latest = planAflTradePrivateValuationStartupCatchUp({
          now: observedAt,
          lastScheduledFor:
            row.last_scheduled_for === null
              ? null
              : new Date(row.last_scheduled_for).toISOString(),
        });
        if (latest === null) continue;
        const result = await transaction.query<{ readonly request_id: string }>(
          `SELECT coalesce_outcome_private_valuation_weekly_dispatch($1,$2) AS request_id`,
          [row.scope_key, latest]
        );
        requestIds.push(result.rows[0]!.request_id);
      }
      return requestIds;
    });
  }

  async enqueueAdHoc(input: {
    readonly scopeKey: string;
    readonly operationKey: string;
  }): Promise<string> {
    const scopeKey = idSchema.parse(input.scopeKey);
    const operationKey = idSchema.parse(input.operationKey);
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ readonly request_id: string; readonly request_json: unknown }>(
        `SELECT * FROM enqueue_outcome_private_valuation_ad_hoc_dispatch($1,$2)`,
        [scopeKey, operationKey]
      );
    });
    const retained = aflTradePrivateValuationDispatchRequestSchema.parse(
      result.rows[0]?.request_json
    );
    const expected = createAflTradePrivateValuationDispatchRequestId({
      scopeKey,
      trigger: 'ad_hoc',
      scheduledFor: retained.scheduledFor,
      authorityKey: operationKey,
    });
    if (result.rows.length !== 1 || result.rows[0]!.request_id !== expected) {
      throw new TypeError('Ad-hoc valuation dispatch did not retain its exact request.');
    }
    return expected;
  }

  async claim(workerId: string, requestId?: string): Promise<
    | {
        readonly request: z.infer<typeof aflTradePrivateValuationDispatchRequestSchema>;
        readonly claimId: string;
        readonly leaseToken: string;
      }
    | null
  > {
    const worker = idSchema.parse(workerId);
    const leaseToken = randomBytes(32).toString('hex');
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<ClaimRow>(
        `SELECT * FROM claim_outcome_private_valuation_dispatch($1,$2,120,$3)`,
        [worker, sha256(leaseToken), requestId === undefined ? null : idSchema.parse(requestId)]
      );
    });
    const row = result.rows[0];
    if (row === undefined) return null;
    const request = aflTradePrivateValuationDispatchRequestSchema.parse(row.request_json);
    if (request.requestId !== row.request_id) {
      throw new TypeError('Claimed valuation dispatch disagrees with retained custody.');
    }
    return { request, claimId: row.claim_id, leaseToken };
  }

  async load(requestId: string): Promise<
    | { readonly status: 'pending' | 'claimed'; readonly result: null }
    | { readonly status: 'completed'; readonly result: unknown }
    | null
  > {
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{
        readonly status: 'pending' | 'claimed' | 'completed';
        readonly result_json: unknown | null;
      }>(
        `SELECT status,result_json FROM outcome_private_valuation_dispatch_request
          WHERE request_id=$1`,
        [idSchema.parse(requestId)]
      );
    });
    const row = result.rows[0];
    if (row === undefined) return null;
    return row.status === 'completed'
      ? { status: 'completed', result: row.result_json }
      : { status: row.status, result: null };
  }

  async complete(input: {
    readonly claimId: string;
    readonly leaseToken: string;
    readonly result: z.infer<typeof terminalResultSchema>;
  }): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT complete_outcome_private_valuation_dispatch($1,$2,$3::jsonb)`, [
        idSchema.parse(input.claimId),
        sha256(input.leaseToken),
        JSON.stringify(terminalResultSchema.parse(input.result)),
      ]);
    });
  }

  async heartbeat(input: { readonly claimId: string; readonly leaseToken: string }): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT heartbeat_outcome_private_valuation_dispatch($1,$2)`, [
        idSchema.parse(input.claimId),
        sha256(input.leaseToken),
      ]);
    });
  }

  async reschedule(input: {
    readonly claimId: string;
    readonly leaseToken: string;
    readonly state: 'retry_pending' | 'stale_authority' | 'transient_failure';
  }): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT reschedule_outcome_private_valuation_dispatch($1,$2,$3)`, [
        idSchema.parse(input.claimId),
        sha256(input.leaseToken),
        input.state,
      ]);
    });
  }
}

export function createPostgresAflTradePrivateValuationDispatcher(dependencies: {
  readonly repository: PostgresAflTradePrivateValuationScheduleRepository;
  readonly runner: AflTradePrivateValuationDispatchRunner;
  readonly workerId?: string;
  readonly heartbeatMilliseconds?: number;
}) {
  const workerId = dependencies.workerId ?? 'system:weekly-valuation-coordinator';
  const heartbeatMilliseconds = dependencies.heartbeatMilliseconds ?? 30_000;
  const processClaim = async (
    claim: NonNullable<Awaited<ReturnType<typeof dependencies.repository.claim>>>
  ) => {
    let heartbeatFailure: unknown = null;
    let heartbeatInFlight: Promise<void> = Promise.resolve();
    const heartbeatTimer = setInterval(() => {
      heartbeatInFlight = heartbeatInFlight
        .then(async () => {
          if (heartbeatFailure === null) await dependencies.repository.heartbeat(claim);
        })
        .catch((error: unknown) => {
          heartbeatFailure = error;
        });
    }, heartbeatMilliseconds);
    heartbeatTimer.unref?.();
    const stopHeartbeat = async () => {
      clearInterval(heartbeatTimer);
      await heartbeatInFlight;
      if (heartbeatFailure !== null) throw heartbeatFailure;
    };
    try {
      const result = await dependencies.runner.run({
        request: claim.request,
        claim: {
          claimId: claim.claimId,
          leaseToken: claim.leaseToken,
        },
      });
      await stopHeartbeat();
      if (
        typeof result === 'object' &&
        result !== null &&
        'state' in result &&
        (result.state === 'retry_pending' ||
          result.state === 'stale_authority' ||
          result.state === 'transient_failure')
      ) {
        await dependencies.repository.reschedule({
          claimId: claim.claimId,
          leaseToken: claim.leaseToken,
          state: result.state,
        });
        const retained = await dependencies.repository.load(claim.request.requestId);
        if (retained?.status === 'completed') {
          return {
            state: 'completed' as const,
            requestId: claim.request.requestId,
            result: retained.result,
          };
        }
        return { state: 'rescheduled' as const, requestId: claim.request.requestId, result };
      }
      const terminal = terminalResultSchema.parse({
        state:
          typeof result === 'object' && result !== null && 'state' in result
            ? result.state
            : undefined,
      });
      await dependencies.repository.complete({
        claimId: claim.claimId,
        leaseToken: claim.leaseToken,
        result: terminal,
      });
      return { state: 'completed' as const, requestId: claim.request.requestId, result };
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeatInFlight;
    }
  };
  return {
    enqueueStartupCatchUp: (now: string) => dependencies.repository.enqueueStartupCatchUp(now),
    enqueueAdHoc: (input: {
      readonly scopeKey: string;
      readonly operationKey: string;
    }) => dependencies.repository.enqueueAdHoc(input),
    repairCurrent: (scopeKey: string, reason: string, repairOperationId: string) =>
      dependencies.runner.repairCurrent(scopeKey, reason, repairOperationId),
    async dispatchOne(): Promise<
      | { readonly state: 'idle' }
      | { readonly state: 'rescheduled'; readonly requestId: string; readonly result: unknown }
      | { readonly state: 'completed'; readonly requestId: string; readonly result: unknown }
    > {
      const claim = await dependencies.repository.claim(workerId);
      if (claim === null) return { state: 'idle' };
      return processClaim(claim);
    },
    async dispatchRequest(requestId: string) {
      const exactRequestId = idSchema.parse(requestId);
      const claim = await dependencies.repository.claim(workerId, exactRequestId);
      if (claim !== null) return processClaim(claim);
      const retained = await dependencies.repository.load(exactRequestId);
      if (retained === null) throw new TypeError('Requested valuation dispatch was not retained.');
      return retained.status === 'completed'
        ? { state: 'completed' as const, requestId: exactRequestId, result: retained.result }
        : { state: 'waiting' as const, requestId: exactRequestId };
    },
  };
}
