import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '../../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../automatedPrivateEvaluationPolicy';
import {
  createGovernedPrivateEvaluationBatchOperationId,
  governedPrivateEvaluationBatchSchema,
  governedPrivateEvaluationBatchRollbackSchema,
  governedPrivateEvaluationBatchWithdrawalSchema,
  type GovernedPrivateEvaluationBatch,
  type GovernedPrivateEvaluationBatchRollback,
  type GovernedPrivateEvaluationBatchWithdrawal,
} from './governedPrivateEvaluationBatch';

interface BatchRow {
  readonly batch_json: unknown;
}

interface TransitionRow {
  readonly batch_id: string;
  readonly revision: number;
  readonly transition_id: string;
  readonly activated_at: Date | string;
}

type HeadRow = TransitionRow;

export interface GovernedPrivateEvaluationBatchTransitionResult {
  readonly scopeKey: string;
  readonly batchId: string;
  readonly revision: number;
  readonly transitionId: string;
  readonly activatedAt: string;
}

export type GovernedPrivateEvaluationBatchHead = GovernedPrivateEvaluationBatchTransitionResult;

export class GovernedPrivateEvaluationBatchConflictError extends Error {}

function isAuthorityConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      'Private evaluation batch heads require fenced compare-and-swap',
      'Private evaluation batch operation replay is stale or conflicting',
      'Private evaluation batch transition is stale, cross-scope, or unauthenticated',
      'Current private evaluation batch head target is not backed by its exact transition',
      'Private evaluation cohort final authority is stale',
    ].some((message) => error.message.includes(message))
  );
}

function isAmbiguousRegistrationAuthorityFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      'Private evaluation batch identity or governed ancestry mismatch',
      'Private evaluation batch generation is not exact current prepared authority',
    ].some((message) => error.message.includes(message))
  );
}

function instant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Private evaluation batch transition has an invalid trusted time.');
  }
  return date.toISOString();
}

function transitionResult(
  scopeKey: string,
  row: TransitionRow
): GovernedPrivateEvaluationBatchTransitionResult {
  return {
    scopeKey,
    batchId: row.batch_id,
    revision: row.revision,
    transitionId: row.transition_id,
    activatedAt: instant(row.activated_at),
  };
}

function head(scopeKey: string, row: HeadRow): GovernedPrivateEvaluationBatchHead {
  return transitionResult(scopeKey, row);
}

async function loadExact(
  transaction: AflOutcomeSqlTransaction,
  batchId: string
): Promise<GovernedPrivateEvaluationBatch> {
  const result = await transaction.query<BatchRow>(
    `SELECT batch_json FROM outcome_private_evaluation_batch WHERE batch_id=$1 FOR KEY SHARE`,
    [batchId]
  );
  if (result.rows.length !== 1) {
    throw new TypeError('Private evaluation batch registration did not retain one exact batch.');
  }
  return governedPrivateEvaluationBatchSchema.parse(result.rows[0]!.batch_json);
}

export class PostgresGovernedPrivateEvaluationBatchRepository {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly authorizeEmergencyOperation: (input: {
      readonly principalId: string;
      readonly scopeKey: string;
      readonly at: string;
    }) => Promise<boolean>
  ) {}

  private async registrationAuthorityIsCurrent(
    batch: GovernedPrivateEvaluationBatch
  ): Promise<boolean> {
    const result = await this.client.query<{ readonly is_current: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM outcome_current_prepared_valuation_input_set prepared_head
         JOIN outcome_prepared_valuation_input_set prepared
           ON prepared.prepared_input_set_id=prepared_head.prepared_input_set_id
         LEFT JOIN outcome_active_release active_release
           ON active_release.scope_key=prepared.factual_release_scope_key
          AND active_release.release_id=prepared.factual_release_id
         JOIN outcome_current_governed_valuation_model_pair model_head
           ON model_head.scope_key=prepared_head.scope_key
        WHERE prepared_head.scope_key=$1
          AND prepared_head.prepared_input_set_id=$2
          AND prepared_head.revision=$3
          AND prepared.factual_release_id=$4
          AND model_head.qualification_id=$5
          AND model_head.work_id=$6
          AND (
            (
              prepared.prepared_set_json->'content'->>'preparationAuthority'=
                'authenticated_calculation_evidence_snapshot'
              AND active_release.release_id IS NOT NULL
            ) OR (
              prepared.prepared_set_json->'content'->>'preparationAuthority'='dispatch_bound_private_factual_output'
              AND prepared.prepared_set_json->'content'->'privateAuthority'->>'modelQualificationId'=$5
              AND prepared.prepared_set_json->'content'->'privateAuthority'->>'modelQualificationWorkId'=$6
              AND (prepared.prepared_set_json->'content'->'privateAuthority'->>'modelQualificationRevision')::INTEGER=
                  model_head.revision
              AND prepared.prepared_set_json->'content'->'privateAuthority'->>'playerRunId'=
                  model_head.player_run_id
              AND prepared.prepared_set_json->'content'->'privateAuthority'->>'pickRunId'=
                  model_head.pick_run_id
              AND EXISTS (
                SELECT 1 FROM outcome_private_valuation_model_request_binding binding
                JOIN outcome_private_valuation_dispatch_request request
                  ON request.request_id=binding.request_id
                 AND request.scope_key=prepared_head.scope_key
                JOIN outcome_private_valuation_factual_output factual
                  ON factual.request_id=binding.request_id
                 AND factual.output_id=binding.factual_output_id
                 AND factual.factual_release_id=prepared.factual_release_id
                JOIN outcome_release_manifest release
                  ON release.release_id=factual.factual_release_id
                 AND release.scope_key=prepared.factual_release_scope_key
                JOIN outcome_private_valuation_model_operation operation
                  ON operation.operation_id=binding.operation_id
                 AND operation.qualification_outcome='qualified'
                 AND operation.qualification_id=model_head.qualification_id
                 AND operation.player_run_id=model_head.player_run_id
                 AND operation.pick_run_id=model_head.pick_run_id
               WHERE binding.request_id=
                       prepared.prepared_set_json->'content'->'privateAuthority'->>'dispatchRequestId'
                 AND binding.factual_output_id=
                       prepared.prepared_set_json->'content'->'privateAuthority'->>'factualOutputId'
                 AND binding.hpn_calculation_id=
                       prepared.prepared_set_json->'content'->'privateAuthority'->>'hpnCalculationId'
                 AND binding.operation_id=
                       prepared.prepared_set_json->'content'->'privateAuthority'->>'modelOperationId'
              )
            )
          )
       ) AS is_current`,
      [
        batch.content.scopeKey,
        batch.content.preparedInputSetId,
        batch.content.preparedInputSetRevision,
        batch.content.factualReleaseId,
        batch.content.modelQualificationId,
        batch.content.modelQualificationWorkId,
      ]
    );
    return result.rows.length === 1 && result.rows[0]?.is_current === true;
  }

  async loadExact(batchId: string): Promise<GovernedPrivateEvaluationBatch | null> {
    const result = await this.client.query<BatchRow>(
      `SELECT batch_json FROM outcome_private_evaluation_batch WHERE batch_id=$1`,
      [batchId]
    );
    if (result.rows.length > 1) {
      throw new TypeError('Private evaluation batch identity is not unique.');
    }
    return result.rows[0] === undefined
      ? null
      : governedPrivateEvaluationBatchSchema.parse(result.rows[0].batch_json);
  }

  async loadCurrent(scopeKey: string): Promise<{
    readonly batch: GovernedPrivateEvaluationBatch;
    readonly head: GovernedPrivateEvaluationBatchHead;
  } | null> {
    const result = await this.client.query<BatchRow & HeadRow>(
      `SELECT batch.batch_json,head.batch_id,head.revision,
              head.last_transition_id AS transition_id,head.activated_at
         FROM outcome_current_private_evaluation_batch head
         JOIN outcome_private_evaluation_batch batch ON batch.batch_id=head.batch_id
        WHERE head.scope_key=$1`,
      [scopeKey]
    );
    if (result.rows.length > 1) {
      throw new TypeError('Current private evaluation batch head is not unique.');
    }
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          batch: governedPrivateEvaluationBatchSchema.parse(row.batch_json),
          head: head(scopeKey, row),
        };
  }

  async register(unparsed: GovernedPrivateEvaluationBatch) {
    const batch = governedPrivateEvaluationBatchSchema.parse(unparsed);
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        const canonicalContent = canonicalizeAflTradeJson(batch.content);
        const canonicalBatch = canonicalizeAflTradeJson(batch);
        await transaction.query(
          `INSERT INTO outcome_private_evaluation_batch
          (batch_id,scope_key,prepared_input_set_id,prepared_input_set_revision,
           factual_release_id,model_qualification_id,model_qualification_work_id,
           trade_count,ready_count,unavailable_count,created_at,content_sha256,
           content_canonical_json,batch_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
         ON CONFLICT (batch_id) DO NOTHING`,
          [
            batch.batchId,
            batch.content.scopeKey,
            batch.content.preparedInputSetId,
            batch.content.preparedInputSetRevision,
            batch.content.factualReleaseId,
            batch.content.modelQualificationId,
            batch.content.modelQualificationWorkId,
            batch.content.tradeCount,
            batch.content.readyCount,
            batch.content.unavailableCount,
            batch.content.createdAt,
            sha256AflTradeCanonicalJson(batch.content),
            canonicalContent,
            canonicalBatch,
          ]
        );
        for (const [ordinal, entry] of batch.content.entries.entries()) {
          await transaction.query(
            `INSERT INTO outcome_private_evaluation_batch_entry
            (batch_id,ordinal,trade_id,state,generation_id,entry_json)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (batch_id,ordinal) DO NOTHING`,
            [
              batch.batchId,
              ordinal,
              entry.tradeId,
              entry.state,
              entry.state === 'ready' ? entry.generationId : null,
              canonicalizeAflTradeJson(entry),
            ]
          );
        }
        const retained = await loadExact(transaction, batch.batchId);
        if (canonicalizeAflTradeJson(retained) !== canonicalBatch) {
          throw new TypeError('Private evaluation batch replay conflicts with retained custody.');
        }
        const count = await transaction.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM outcome_private_evaluation_batch_entry WHERE batch_id=$1`,
          [batch.batchId]
        );
        if (Number(count.rows[0]?.count) !== batch.content.tradeCount) {
          throw new TypeError('Private evaluation batch registration is incomplete.');
        }
        return retained;
      });
    } catch (error) {
      if (
        isAmbiguousRegistrationAuthorityFailure(error) &&
        !(await this.registrationAuthorityIsCurrent(batch))
      ) {
        throw new GovernedPrivateEvaluationBatchConflictError(
          'Private evaluation batch registration lost current authority.',
          { cause: error }
        );
      }
      if (isAuthorityConflict(error)) {
        throw new GovernedPrivateEvaluationBatchConflictError(
          'Private evaluation batch registration lost current authority.',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async advance(input: {
    readonly scopeKey: string;
    readonly batchId: string;
    readonly expectedRevision: number;
    readonly operationId: string;
    readonly action: 'activate';
    readonly cohortOperationId?: string;
    readonly dispatchClaim?: {
      readonly requestId: string;
      readonly claimId: string;
      readonly leaseToken: string;
    };
  }): Promise<GovernedPrivateEvaluationBatchTransitionResult> {
    if (
      input.operationId !==
      createGovernedPrivateEvaluationBatchOperationId({
        scopeKey: input.scopeKey,
        batchId: input.batchId,
        expectedRevision: input.expectedRevision,
        action: input.action,
      })
    ) {
      throw new TypeError('Private evaluation batch operation identity is not exact.');
    }
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        if (input.dispatchClaim !== undefined) {
          await transaction.query(
            `SELECT load_outcome_private_valuation_dispatch_request_for_claim($1,$2,$3)`,
            [
              input.dispatchClaim.requestId,
              input.dispatchClaim.claimId,
              createHash('sha256').update(input.dispatchClaim.leaseToken, 'utf8').digest('hex'),
            ]
          );
        }
        const captured = input.cohortOperationId !== undefined;
        const result = await transaction.query<TransitionRow>(
          captured
            ? `SELECT batch_id,revision,transition_id,activated_at
                 FROM advance_outcome_current_private_evaluation_batch_from_capture(
                   $1,$2,$3,$4,$5,$6,$7
                 )`
            : `SELECT batch_id,revision,transition_id,activated_at
                 FROM advance_outcome_current_private_evaluation_batch($1,$2,$3,$4,$5,$6)`,
          [
            input.scopeKey,
            input.batchId,
            input.expectedRevision,
            input.operationId,
            input.action,
            AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
            ...(captured ? [input.cohortOperationId!] : []),
          ]
        );
        if (result.rows.length !== 1) {
          throw new TypeError('Private evaluation batch transition returned no exact result.');
        }
        return transitionResult(input.scopeKey, result.rows[0]!);
      });
    } catch (error) {
      if (isAuthorityConflict(error)) {
        throw new GovernedPrivateEvaluationBatchConflictError(
          'Private evaluation batch transition lost current authority.',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async rollback(
    unparsed: GovernedPrivateEvaluationBatchRollback
  ): Promise<GovernedPrivateEvaluationBatchTransitionResult> {
    const rollback = governedPrivateEvaluationBatchRollbackSchema.parse(unparsed);
    const authorized = await this.authorizeEmergencyOperation({
      principalId: rollback.content.principalId,
      scopeKey: rollback.content.scopeKey,
      at: rollback.content.authorizedAt,
    });
    if (!authorized) throw new TypeError('Emergency batch rollback authority is unavailable.');
    try {
      return await this.client.transaction(async (transaction) => {
        await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        const result = await transaction.query<TransitionRow>(
          `SELECT batch_id,revision,transition_id,activated_at
             FROM rollback_outcome_current_private_evaluation_batch($1::jsonb)`,
          [canonicalizeAflTradeJson(rollback)]
        );
        if (result.rows.length !== 1) {
          throw new TypeError('Private evaluation batch rollback returned no exact result.');
        }
        return transitionResult(rollback.content.scopeKey, result.rows[0]!);
      });
    } catch (error) {
      if (isAuthorityConflict(error)) {
        throw new GovernedPrivateEvaluationBatchConflictError(
          'Private evaluation batch rollback lost current authority.',
          { cause: error }
        );
      }
      throw error;
    }
  }

  async withdraw(unparsed: GovernedPrivateEvaluationBatchWithdrawal) {
    const withdrawal = governedPrivateEvaluationBatchWithdrawalSchema.parse(unparsed);
    const authorized = await this.authorizeEmergencyOperation({
      principalId: withdrawal.content.principalId,
      scopeKey: withdrawal.content.scopeKey,
      at: withdrawal.content.withdrawnAt,
    });
    if (!authorized) throw new TypeError('Emergency batch withdrawal authority is unavailable.');
    const canonical = canonicalizeAflTradeJson(withdrawal);
    await this.client.query(
      `INSERT INTO outcome_private_evaluation_batch_withdrawal
        (withdrawal_id,scope_key,batch_id,trade_id,generation_id,principal_id,
         reason,withdrawn_at,withdrawal_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (withdrawal_id) DO NOTHING`,
      [
        withdrawal.withdrawalId,
        withdrawal.content.scopeKey,
        withdrawal.content.batchId,
        withdrawal.content.tradeId,
        withdrawal.content.generationId,
        withdrawal.content.principalId,
        withdrawal.content.reason,
        withdrawal.content.withdrawnAt,
        canonical,
      ]
    );
    const retained = await this.client.query<{ withdrawal_json: unknown }>(
      `SELECT withdrawal_json FROM outcome_private_evaluation_batch_withdrawal WHERE withdrawal_id=$1`,
      [withdrawal.withdrawalId]
    );
    if (
      retained.rows.length !== 1 ||
      canonicalizeAflTradeJson(retained.rows[0]!.withdrawal_json) !== canonical
    ) {
      throw new TypeError('Emergency batch withdrawal replay conflicts with retained custody.');
    }
    return governedPrivateEvaluationBatchWithdrawalSchema.parse(retained.rows[0]!.withdrawal_json);
  }
}
import { createHash } from 'node:crypto';
