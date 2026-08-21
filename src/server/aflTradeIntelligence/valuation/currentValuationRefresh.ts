import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';

export const AFL_TRADE_CURRENT_VALUATION_REFRESH_RESULT_SCHEMA_VERSION =
  'afl-current-valuation-refresh-result-v1' as const;
export const AFL_TRADE_CURRENT_VALUATION_REFRESH_LIMITATION =
  'No factual, model, prepared-input, private-evaluation, or publication authority is granted.' as const;

const idSchema = z.string().trim().min(1).max(400);
const instantSchema = z.iso.datetime({ offset: true });

export const aflTradeCurrentValuationRefreshTriggerSchema = z.literal('ad_hoc');

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
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
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

export function createAflTradeCurrentValuationRefresh(dependencies: {
  readonly retainNoChange: (
    request: AflTradeCurrentValuationRefreshRequest
  ) => Promise<AflTradeCurrentValuationRefreshResult>;
}): AflTradeCurrentValuationRefresh {
  return {
    async refreshCurrent(unparsedRequest) {
      const request = aflTradeCurrentValuationRefreshRequestSchema.parse(unparsedRequest);
      const result = aflTradeCurrentValuationRefreshResultSchema.parse(
        await dependencies.retainNoChange(request)
      );
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
