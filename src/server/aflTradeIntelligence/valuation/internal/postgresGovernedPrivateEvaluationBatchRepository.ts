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
  governedPrivateEvaluationBatchWithdrawalSchema,
  type GovernedPrivateEvaluationBatch,
  type GovernedPrivateEvaluationBatchWithdrawal,
} from './governedPrivateEvaluationBatch';

interface BatchRow {
  readonly batch_json: unknown;
}

interface HeadRow {
  readonly batch_id: string;
  readonly revision: number;
  readonly transition_id: string;
  readonly activated_at: Date | string;
}

export interface GovernedPrivateEvaluationBatchHead {
  readonly scopeKey: string;
  readonly batchId: string;
  readonly revision: number;
  readonly transitionId: string;
  readonly activatedAt: string;
}

function instant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Private evaluation batch head has an invalid trusted time.');
  }
  return date.toISOString();
}

function head(scopeKey: string, row: HeadRow): GovernedPrivateEvaluationBatchHead {
  return {
    scopeKey,
    batchId: row.batch_id,
    revision: row.revision,
    transitionId: row.transition_id,
    activatedAt: instant(row.activated_at),
  };
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
    private readonly authorizeEmergencyWithdrawal: (input: {
      readonly principalId: string;
      readonly scopeKey: string;
      readonly at: string;
    }) => Promise<boolean>
  ) {}

  async register(unparsed: GovernedPrivateEvaluationBatch) {
    const batch = governedPrivateEvaluationBatchSchema.parse(unparsed);
    return this.client.transaction(async (transaction) => {
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
  }

  async advance(input: {
    readonly scopeKey: string;
    readonly batchId: string;
    readonly expectedRevision: number;
    readonly operationId: string;
    readonly action: 'activate' | 'rollback';
  }): Promise<GovernedPrivateEvaluationBatchHead> {
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
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      const result = await transaction.query<HeadRow>(
        `SELECT batch_id,revision,transition_id,activated_at
           FROM advance_outcome_current_private_evaluation_batch($1,$2,$3,$4,$5,$6)`,
        [
          input.scopeKey,
          input.batchId,
          input.expectedRevision,
          input.operationId,
          input.action,
          AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID,
        ]
      );
      if (result.rows.length !== 1) {
        throw new TypeError('Private evaluation batch transition returned no exact head.');
      }
      return head(input.scopeKey, result.rows[0]!);
    });
  }

  async withdraw(unparsed: GovernedPrivateEvaluationBatchWithdrawal) {
    const withdrawal = governedPrivateEvaluationBatchWithdrawalSchema.parse(unparsed);
    const authorized = await this.authorizeEmergencyWithdrawal({
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
    return governedPrivateEvaluationBatchWithdrawalSchema.parse(
      retained.rows[0]!.withdrawal_json
    );
  }
}
