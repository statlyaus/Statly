import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY,
  aflTradePrivateEvaluationCohortExecutionCycleSchema,
  aflTradePrivateEvaluationExecutionCauseSchema,
  aflTradePrivateEvaluationExecutionResultSchema,
  createAflTradePrivateEvaluationCohortExecutionCycle,
  createAflTradePrivateEvaluationCohortInputFingerprint,
  type AflTradePrivateEvaluationCohortExecutionCycle,
  type AflTradePrivateEvaluationExecutionCause,
  type AflTradePrivateEvaluationExecutionResult,
} from './privateEvaluationCohortExecution';

const idSchema = z.string().trim().min(1).max(400);
const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';
const tradeIdsSchema = z
  .array(idSchema)
  .max(10_000)
  .superRefine((ids, context) => {
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && ids[index - 1]! > id)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Execution-cycle trade IDs must be unique and ordered.',
      });
    }
  });

type Authority = AflTradePrivateEvaluationCohortExecutionCycle['content']['authority'];
type WorkStatus = 'pending' | 'leased' | 'retry_wait' | 'succeeded' | 'unavailable' | 'exhausted';

interface CycleRow {
  readonly cycle_json: unknown;
}

interface ClaimRow {
  readonly claim_id: string;
  readonly attempt_number: number;
  readonly lease_expires_at: Date | string;
}

interface WorkRow {
  readonly status: WorkStatus;
  readonly attempt_count: number;
  readonly available_at: Date | string;
  readonly lease_expires_at: Date | string | null;
  readonly terminal_stage: string | null;
  readonly terminal_cause_json: unknown | null;
  readonly result_json: unknown | null;
}

function instant(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Private evaluation execution received invalid PostgreSQL time.');
  }
  return parsed.toISOString();
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function loadExactCycle(
  transaction: AflOutcomeSqlTransaction,
  cycleId: string
): Promise<AflTradePrivateEvaluationCohortExecutionCycle> {
  const result = await transaction.query<CycleRow>(
    `SELECT cycle_json FROM outcome_private_evaluation_execution_cycle
      WHERE cycle_id=$1`,
    [cycleId]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Private evaluation execution did not retain one exact cycle.');
  }
  return aflTradePrivateEvaluationCohortExecutionCycleSchema.parse(result.rows[0]!.cycle_json);
}

async function registerCycle(
  transaction: AflOutcomeSqlTransaction,
  cycle: AflTradePrivateEvaluationCohortExecutionCycle,
  tradeIds: readonly string[]
): Promise<AflTradePrivateEvaluationCohortExecutionCycle> {
  const authority = cycle.content.authority;
  if ('factualReleaseRevision' in authority) {
    await transaction.query(
      `INSERT INTO outcome_private_evaluation_execution_cycle
        (cycle_id,input_fingerprint,scope_key,prepared_input_set_id,
         prepared_input_set_revision,factual_release_revision,
         model_qualification_work_id,model_pair_revision,repair_sequence,
         opening_cause,opening_principal_id,repair_operation_id,repair_reason,repairs_cycle_id,
         maximum_attempts,opened_at,cycle_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
       ON CONFLICT (cycle_id) DO NOTHING`,
      [
        cycle.cycleId,
        cycle.content.inputFingerprint,
        authority.scopeKey,
        authority.preparedInputSetId,
        authority.preparedInputSetRevision,
        authority.factualReleaseRevision,
        authority.modelQualificationWorkId,
        authority.modelPairRevision,
        cycle.content.repairSequence,
        cycle.content.openingCause,
        cycle.content.openingPrincipalId,
        cycle.content.repairOperationId,
        cycle.content.repairReason,
        cycle.content.repairsCycleId,
        cycle.content.maximumAttemptsPerTrade,
        cycle.content.openedAt,
        canonicalizeAflTradeJson(cycle),
      ]
    );
  } else {
    await transaction.query(
      `INSERT INTO outcome_private_evaluation_execution_cycle
      (cycle_id,input_fingerprint,scope_key,prepared_input_set_id,
       prepared_input_set_revision,preparation_authority,factual_release_revision,
       dispatch_request_id,factual_output_id,hpn_calculation_id,model_operation_id,
       model_qualification_work_id,model_pair_revision,repair_sequence,
       opening_cause,opening_principal_id,repair_operation_id,repair_reason,repairs_cycle_id,
       maximum_attempts,opened_at,cycle_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb)
     ON CONFLICT (cycle_id) DO NOTHING`,
      [
        cycle.cycleId,
        cycle.content.inputFingerprint,
        authority.scopeKey,
        authority.preparedInputSetId,
        authority.preparedInputSetRevision,
        'dispatch_bound_private_factual_output',
        null,
        authority.privateAuthority.dispatchRequestId,
        authority.privateAuthority.factualOutputId,
        authority.privateAuthority.hpnCalculationId,
        authority.privateAuthority.modelOperationId,
        authority.modelQualificationWorkId,
        authority.modelPairRevision,
        cycle.content.repairSequence,
        cycle.content.openingCause,
        cycle.content.openingPrincipalId,
        cycle.content.repairOperationId,
        cycle.content.repairReason,
        cycle.content.repairsCycleId,
        cycle.content.maximumAttemptsPerTrade,
        cycle.content.openedAt,
        canonicalizeAflTradeJson(cycle),
      ]
    );
  }
  for (const tradeId of tradeIds) {
    await transaction.query(
      `INSERT INTO outcome_private_evaluation_execution_work
        (cycle_id,trade_id,status,attempt_count,available_at)
       VALUES ($1,$2,'pending',0,$3)
       ON CONFLICT (cycle_id,trade_id) DO NOTHING`,
      [cycle.cycleId, tradeId, cycle.content.openedAt]
    );
  }
  const retained = await loadExactCycle(transaction, cycle.cycleId);
  if (canonicalizeAflTradeJson(retained) !== canonicalizeAflTradeJson(cycle)) {
    throw new TypeError('Private evaluation execution cycle replay conflicts with custody.');
  }
  await authenticateCycleWork(transaction, cycle.cycleId, tradeIds);
  return retained;
}

async function authenticateCycleWork(
  transaction: AflOutcomeSqlTransaction,
  cycleId: string,
  tradeIds: readonly string[]
): Promise<void> {
  const retainedWork = await transaction.query<{ readonly trade_id: string }>(
    `SELECT trade_id FROM outcome_private_evaluation_execution_work
      WHERE cycle_id=$1 ORDER BY trade_id`,
    [cycleId]
  );
  if (
    retainedWork.rows.length !== tradeIds.length ||
    retainedWork.rows.some(({ trade_id }, index) => trade_id !== tradeIds[index])
  ) {
    throw new TypeError('Private evaluation execution cycle work replay conflicts with custody.');
  }
}

async function authenticateRetainedCycleWork(
  transaction: AflOutcomeSqlTransaction,
  cycle: AflTradePrivateEvaluationCohortExecutionCycle
): Promise<void> {
  const expectedWork = await transaction.query<{ readonly trade_id: string }>(
    `SELECT entry.trade_id
       FROM outcome_prepared_valuation_input_entry entry
      WHERE entry.prepared_input_set_id=$1 AND entry.state='ready'
      ORDER BY entry.trade_id`,
    [cycle.content.authority.preparedInputSetId]
  );
  await authenticateCycleWork(
    transaction,
    cycle.cycleId,
    expectedWork.rows.map(({ trade_id }) => trade_id)
  );
}

export interface AflTradePrivateEvaluationExecutionClaim {
  readonly claimId: string;
  readonly cycleId: string;
  readonly tradeId: string;
  readonly attemptNumber: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
}

export interface AflTradePrivateEvaluationExecutionWork {
  readonly status: WorkStatus;
  readonly attemptCount: number;
  readonly availableAt: string;
  readonly leaseExpiresAt: string | null;
  readonly terminalStage: string | null;
  readonly terminalCause: AflTradePrivateEvaluationExecutionCause | null;
  readonly result: AflTradePrivateEvaluationExecutionResult | null;
}

export class PostgresAflTradePrivateEvaluationCohortExecutionRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async openAutomatic(input: {
    readonly authority: Authority;
    readonly readyTradeIds: readonly string[];
    readonly openedAt: string;
  }): Promise<AflTradePrivateEvaluationCohortExecutionCycle> {
    const tradeIds = tradeIdsSchema.parse(input.readyTradeIds);
    const fingerprint = createAflTradePrivateEvaluationCohortInputFingerprint(input.authority);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        fingerprint,
      ]);
      const existing = await transaction.query<CycleRow>(
        `SELECT cycle_json FROM outcome_private_evaluation_execution_cycle
          WHERE input_fingerprint=$1 ORDER BY repair_sequence DESC LIMIT 1`,
        [fingerprint]
      );
      const cycle =
        existing.rows[0] === undefined
          ? createAflTradePrivateEvaluationCohortExecutionCycle({
              authority: input.authority,
              repairSequence: 0,
              openedAt: input.openedAt,
            })
          : aflTradePrivateEvaluationCohortExecutionCycleSchema.parse(existing.rows[0].cycle_json);
      return registerCycle(transaction, cycle, tradeIds);
    });
  }

  async openRepair(input: {
    readonly authority: Authority;
    readonly readyTradeIds: readonly string[];
    readonly repairOperationId: string;
    readonly reason: string;
  }): Promise<AflTradePrivateEvaluationCohortExecutionCycle> {
    const tradeIds = tradeIdsSchema.parse(input.readyTradeIds);
    const fingerprint = createAflTradePrivateEvaluationCohortInputFingerprint(input.authority);
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        fingerprint,
      ]);
      const existing = await transaction.query<CycleRow>(
        `SELECT cycle_json FROM outcome_private_evaluation_execution_cycle
          WHERE repair_operation_id=$1`,
        [input.repairOperationId]
      );
      if (existing.rows[0] !== undefined) {
        const retained = aflTradePrivateEvaluationCohortExecutionCycleSchema.parse(
          existing.rows[0].cycle_json
        );
        if (
          retained.content.inputFingerprint !== fingerprint ||
          retained.content.repairReason !== input.reason
        ) {
          throw new TypeError('Explicit repair replay conflicts with retained custody.');
        }
        await authenticateCycleWork(transaction, retained.cycleId, tradeIds);
        return retained;
      }
      const prior = await transaction.query<{ readonly repair_sequence: number }>(
        `SELECT repair_sequence FROM outcome_private_evaluation_execution_cycle
          WHERE input_fingerprint=$1 ORDER BY repair_sequence DESC LIMIT 1`,
        [fingerprint]
      );
      if (prior.rows.length !== 1) {
        throw new TypeError('Explicit repair requires one prior execution cycle.');
      }
      const nonterminal = await transaction.query<{ readonly count: number }>(
        `SELECT count(*)::int AS count
           FROM outcome_private_evaluation_execution_work
          WHERE cycle_id=(SELECT cycle_id FROM outcome_private_evaluation_execution_cycle
                           WHERE input_fingerprint=$1 AND repair_sequence=$2)
            AND status NOT IN ('succeeded','unavailable','exhausted')`,
        [fingerprint, prior.rows[0]!.repair_sequence]
      );
      if (nonterminal.rows[0]?.count !== 0) {
        throw new TypeError('Explicit repair requires a terminal predecessor cycle.');
      }
      const trustedTime = await transaction.query<{ readonly opened_at: Date | string }>(
        `SELECT date_trunc('milliseconds',transaction_timestamp()) AS opened_at`
      );
      const cycle = createAflTradePrivateEvaluationCohortExecutionCycle({
        authority: input.authority,
        repairSequence: prior.rows[0]!.repair_sequence + 1,
        openedAt: instant(trustedTime.rows[0]!.opened_at),
        repairOperationId: input.repairOperationId,
        repairReason: input.reason,
      });
      return registerCycle(transaction, cycle, tradeIds);
    });
  }

  async claim(input: {
    readonly cycleId: string;
    readonly tradeId: string;
    readonly workerId: string;
  }): Promise<AflTradePrivateEvaluationExecutionClaim | null> {
    const cycleId = idSchema.parse(input.cycleId);
    const tradeId = idSchema.parse(input.tradeId);
    const workerId = idSchema.parse(input.workerId);
    const leaseToken = randomBytes(32).toString('hex');
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<ClaimRow>(
        `SELECT * FROM claim_outcome_private_evaluation_work($1,$2,$3,$4)`,
        [cycleId, tradeId, workerId, tokenDigest(leaseToken)]
      );
    });
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          claimId: row.claim_id,
          cycleId,
          tradeId,
          attemptNumber: row.attempt_number,
          leaseToken,
          leaseExpiresAt: instant(row.lease_expires_at),
        };
  }

  async loadRepair(
    repairOperationId: string
  ): Promise<AflTradePrivateEvaluationCohortExecutionCycle | null> {
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      const result = await transaction.query<CycleRow>(
        `SELECT cycle_json FROM outcome_private_evaluation_execution_cycle
          WHERE repair_operation_id=$1`,
        [idSchema.parse(repairOperationId)]
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) {
        throw new TypeError('Explicit repair operation resolved ambiguous retained custody.');
      }
      const retained = aflTradePrivateEvaluationCohortExecutionCycleSchema.parse(
        result.rows[0]!.cycle_json
      );
      await authenticateRetainedCycleWork(transaction, retained);
      return retained;
    });
  }

  async heartbeat(claim: AflTradePrivateEvaluationExecutionClaim): Promise<string> {
    const result = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ readonly renewed_at: Date | string }>(
        `SELECT heartbeat_outcome_private_evaluation_work($1,$2) AS renewed_at`,
        [claim.claimId, tokenDigest(claim.leaseToken)]
      );
    });
    if (result.rows.length !== 1) {
      throw new Error('Private evaluation execution heartbeat returned no lease.');
    }
    return instant(result.rows[0]!.renewed_at);
  }

  async complete(input: {
    readonly claim: AflTradePrivateEvaluationExecutionClaim;
    readonly outcome: 'succeeded' | 'unavailable' | 'transient_failure' | 'permanent_failure';
    readonly stage: string | null;
    readonly cause: AflTradePrivateEvaluationExecutionCause | null;
    readonly result: AflTradePrivateEvaluationExecutionResult | null;
  }): Promise<WorkStatus> {
    const cause =
      input.cause === null
        ? null
        : aflTradePrivateEvaluationExecutionCauseSchema.parse(input.cause);
    const result =
      input.result === null
        ? null
        : aflTradePrivateEvaluationExecutionResultSchema.parse(input.result);
    if (
      (input.outcome === 'succeeded' && result?.state !== 'activated') ||
      (input.outcome === 'unavailable' && result?.state !== 'unavailable') ||
      (input.outcome.endsWith('_failure') && cause === null)
    ) {
      throw new TypeError('Private evaluation execution completion shape is invalid.');
    }
    const completed = await this.client.transaction(async (transaction) => {
      await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
      return transaction.query<{ readonly status: WorkStatus }>(
        `SELECT complete_outcome_private_evaluation_work($1,$2,$3,$4,$5::jsonb,$6::jsonb) AS status`,
        [
          input.claim.claimId,
          tokenDigest(input.claim.leaseToken),
          input.outcome,
          input.stage,
          cause === null ? null : canonicalizeAflTradeJson(cause),
          result === null ? null : canonicalizeAflTradeJson(result),
        ]
      );
    });
    const status = completed.rows[0]?.status;
    if (status === undefined) {
      throw new Error('Private evaluation execution completion returned no status.');
    }
    return status;
  }

  async loadWork(
    cycleId: string,
    tradeId: string
  ): Promise<AflTradePrivateEvaluationExecutionWork> {
    const result = await this.client.query<WorkRow>(
      `SELECT status,attempt_count,available_at,lease_expires_at,
              terminal_stage,terminal_cause_json,result_json
         FROM outcome_private_evaluation_execution_work
        WHERE cycle_id=$1 AND trade_id=$2`,
      [idSchema.parse(cycleId), idSchema.parse(tradeId)]
    );
    if (result.rows.length !== 1) {
      throw new TypeError('Private evaluation execution work was not found.');
    }
    const row = result.rows[0]!;
    return {
      status: row.status,
      attemptCount: row.attempt_count,
      availableAt: instant(row.available_at),
      leaseExpiresAt: row.lease_expires_at === null ? null : instant(row.lease_expires_at),
      terminalStage: row.terminal_stage,
      terminalCause:
        row.terminal_cause_json === null
          ? null
          : aflTradePrivateEvaluationExecutionCauseSchema.parse(row.terminal_cause_json),
      result:
        row.result_json === null
          ? null
          : aflTradePrivateEvaluationExecutionResultSchema.parse(row.result_json),
    };
  }

  async explainTargetedPreparedTradeLookup(
    preparedInputSetId: string,
    tradeId: string
  ): Promise<readonly string[]> {
    const result = await this.client.query<{ readonly 'QUERY PLAN': string }>(
      `EXPLAIN (COSTS TRUE, FORMAT TEXT)
       SELECT entry_json FROM outcome_prepared_valuation_input_entry
        WHERE prepared_input_set_id=$1 AND trade_id=$2`,
      [idSchema.parse(preparedInputSetId), idSchema.parse(tradeId)]
    );
    return result.rows.map((row) => row['QUERY PLAN']);
  }
}

export const AFL_TRADE_PRIVATE_EVALUATION_MAXIMUM_CONCURRENCY =
  AFL_TRADE_PRIVATE_EVALUATION_COHORT_EXECUTION_POLICY.maximumConcurrency;

export function createAflTradePrivateEvaluationExecutionOperationId(input: {
  readonly cycleId: string;
  readonly tradeId: string;
}): string {
  return createAflTradeContentAddress('private-evaluation-operation', input);
}
