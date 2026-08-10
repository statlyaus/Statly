import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';

export const AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION =
  'afl-trade-external-reconciliation-source-authority/v1' as const;
export const AFL_TRADE_EXTERNAL_RECONCILIATION_CANDIDATE_SCHEMA_VERSION =
  'afl-trade-external-reconciliation/v2' as const;

const instantSchema = z.iso.datetime({ offset: true });

const historicalCompletionAuthoritySchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION),
    kind: z.literal('historical_plan_completion'),
    completionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
    completionSha256: aflTradeSha256Schema,
    planId: aflTradeContentAddressedIdSchema('external-historical-capture-plan'),
    planSha256: aflTradeSha256Schema,
    targetSetSha256: aflTradeSha256Schema,
    resultSetSha256: aflTradeSha256Schema,
    completionSourceBatchSetSha256: aflTradeSha256Schema,
    candidateSourceBatchSetSha256: aflTradeSha256Schema,
    completedAt: instantSchema,
  })
  .strict()
  .superRefine((authority, context) => {
    if (
      authority.completionId !==
      `external-historical-capture-completion:${authority.completionSha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completionId'],
        message: 'Historical completion identity must bind its exact digest.',
      });
    }
  });

const reviewedBatchSetAuthoritySchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION),
    kind: z.literal('reviewed_batch_set'),
    reviewDecisionId: aflTradeContentAddressedIdSchema('review-decision'),
    reviewDecisionSha256: aflTradeSha256Schema,
    candidateSourceBatchSetSha256: aflTradeSha256Schema,
    decidedAt: instantSchema,
  })
  .strict()
  .superRefine((authority, context) => {
    if (authority.reviewDecisionId !== `review-decision:${authority.reviewDecisionSha256}`) {
      context.addIssue({
        code: 'custom',
        path: ['reviewDecisionId'],
        message: 'Reviewed batch-set decision identity must bind its exact digest.',
      });
    }
  });

export const aflTradeExternalReconciliationSourceAuthoritySchema = z.discriminatedUnion('kind', [
  historicalCompletionAuthoritySchema,
  reviewedBatchSetAuthoritySchema,
]);

export type AflTradeExternalReconciliationSourceAuthority = z.infer<
  typeof aflTradeExternalReconciliationSourceAuthoritySchema
>;
export type AflTradeHistoricalCompletionReconciliationAuthority = z.infer<
  typeof historicalCompletionAuthoritySchema
>;
export type AflTradeReviewedBatchSetReconciliationAuthority = z.infer<
  typeof reviewedBatchSetAuthoritySchema
>;

export function createAflTradeHistoricalCompletionReconciliationAuthority(
  input: z.input<typeof historicalCompletionAuthoritySchema>
): AflTradeHistoricalCompletionReconciliationAuthority {
  return historicalCompletionAuthoritySchema.parse(input);
}

export function createAflTradeReviewedBatchSetReconciliationAuthority(
  input: z.input<typeof reviewedBatchSetAuthoritySchema>
): AflTradeReviewedBatchSetReconciliationAuthority {
  return reviewedBatchSetAuthoritySchema.parse(input);
}
