import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import { aflTradePrivateValuationDispatchTriggerSchema } from './privateValuationScheduling';

export const AFL_TRADE_CURRENT_VALUATION_REFRESH_RESULT_SCHEMA_VERSION =
  'afl-current-valuation-refresh-result-v1' as const;
export const AFL_TRADE_CURRENT_VALUATION_REFRESH_LIMITATION =
  'Private local non-production current-authority refresh trace only; no factual, model, prepared-input, private-evaluation, production, activation, or publication authority is granted.' as const;

const EXECUTION_DATABASE_ROLE = 'afl_trade_private_evaluation_coordinator';

const idSchema = z.string().trim().min(1).max(400);
const instantSchema = z.iso.datetime({ offset: true });

export const aflTradeCurrentValuationRefreshTriggerSchema =
  aflTradePrivateValuationDispatchTriggerSchema;

export const aflTradeCurrentValuationRefreshRequestSchema = z
  .object({
    scopeKey: idSchema,
    trigger: aflTradeCurrentValuationRefreshTriggerSchema,
    stableOperationKey: idSchema,
  })
  .strict();

export const aflTradeCurrentValuationRefreshAuthoritySchema = z
  .object({
    factualReleaseScopeKey: idSchema,
    factualReleaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    factualReleaseRevision: z.number().int().positive(),
    modelQualificationId: aflTradeContentAddressedIdSchema('model-qualification'),
    modelQualificationWorkId: aflTradeContentAddressedIdSchema('model-qualification-work'),
    modelPairRevision: z.number().int().positive(),
    preparedInputSetId: aflTradeContentAddressedIdSchema('prepared-valuation-input-set'),
    preparedInputSetRevision: z.number().int().positive(),
    privateBatchId: aflTradeContentAddressedIdSchema('private-evaluation-batch'),
    privateBatchRevision: z.number().int().positive(),
    privateBatchTransitionId: aflTradeContentAddressedIdSchema(
      'private-evaluation-batch-transition'
    ),
  })
  .strict();

export const aflTradeCurrentValuationRefreshResultSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_CURRENT_VALUATION_REFRESH_RESULT_SCHEMA_VERSION),
    operationId: aflTradeContentAddressedIdSchema('current-valuation-refresh-operation'),
    scopeKey: idSchema,
    trigger: aflTradeCurrentValuationRefreshTriggerSchema,
    stableOperationKey: idSchema,
    state: z.literal('no_change'),
    capturedAuthority: aflTradeCurrentValuationRefreshAuthoritySchema,
    capturedAt: instantSchema,
    completedAt: instantSchema,
    executionLocation: z.literal('local'),
    visibility: z.literal('private'),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    publicationProhibited: z.literal(true),
    limitation: z.literal(AFL_TRADE_CURRENT_VALUATION_REFRESH_LIMITATION),
  })
  .strict()
  .superRefine((result, context) => {
    if (Date.parse(result.completedAt) < Date.parse(result.capturedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Current valuation refresh cannot complete before authority capture.',
      });
    }
  });

export type AflTradeCurrentValuationRefreshRequest = z.infer<
  typeof aflTradeCurrentValuationRefreshRequestSchema
>;
export type AflTradeCurrentValuationRefreshResult = z.infer<
  typeof aflTradeCurrentValuationRefreshResultSchema
>;

export interface AflTradeCurrentValuationRefresh {
  refreshCurrent(
    request: AflTradeCurrentValuationRefreshRequest
  ): Promise<AflTradeCurrentValuationRefreshResult>;
}

interface RetainedRefreshRow {
  readonly operation_id: string;
  readonly operation_json: unknown;
  readonly result_json: unknown;
}

export function createAflTradeCurrentValuationRefresh(dependencies: {
  readonly client: AflOutcomeSqlClient;
}): AflTradeCurrentValuationRefresh {
  return {
    async refreshCurrent(unparsedRequest) {
      const request = aflTradeCurrentValuationRefreshRequestSchema.parse(unparsedRequest);
      const retained = await dependencies.client.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL ROLE ${EXECUTION_DATABASE_ROLE}`);
        return transaction.query<RetainedRefreshRow>(
          'SELECT * FROM retain_outcome_current_valuation_refresh_no_change($1,$2,$3)',
          [request.scopeKey, request.trigger, request.stableOperationKey]
        );
      });
      const row = retained.rows[0];
      if (row === undefined || retained.rows.length !== 1) {
        throw new TypeError('Current valuation refresh did not retain exactly one result.');
      }
      const result = aflTradeCurrentValuationRefreshResultSchema.parse(row.result_json);
      if (result.operationId !== row.operation_id) {
        throw new TypeError(
          'Current valuation refresh result disagrees with retained operation custody.'
        );
      }
      if (
        result.scopeKey !== request.scopeKey ||
        result.trigger !== request.trigger ||
        result.stableOperationKey !== request.stableOperationKey
      ) {
        throw new TypeError(
          'Current valuation refresh result conflicts with the requested operation.'
        );
      }
      return result;
    },
  };
}
