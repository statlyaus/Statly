import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradePostseasonYearContentSchema } from '../domain/postseasonYearContext';

const year = aflTradePostseasonYearContentSchema.shape;

/** Review content excludes the later decision ID and its actual recording timestamp. */
export const aflTradePostseasonMaterializationReviewContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-postseason-materialization-review/v1'),
    authorityBoundary: z.literal('private_factual_materialization_no_numerical_admission'),
    environment: year.environment,
    competition: year.competition,
    scopeKey: z.string().trim().min(1).max(1000),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    spellVersionId: aflTradeContentAddressedIdSchema('acquisition-spell-version'),
    tradeId: year.tradeId,
    promotionId: year.promotionId,
    eventVersionId: year.eventVersionId,
    tradeYear: year.tradeYear,
    tradeDate: year.tradeDate,
    period: year.period,
    reviewEvidence: year.reviewEvidence,
    createdAt: year.recordedAt,
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.tradeDate !== null && Number(record.tradeDate.slice(0, 4)) !== record.tradeYear) {
      ctx.addIssue({ code: 'custom', message: 'Reviewed date and year differ.' });
    }
    if (Date.parse(record.reviewEvidence.createdAt) > Date.parse(record.createdAt)) {
      ctx.addIssue({ code: 'custom', message: 'Review proposal precedes its evidence.' });
    }
  });

export const aflTradePostseasonMaterializationReviewSchema = z
  .object({
    reviewId: aflTradeContentAddressedIdSchema('postseason-materialization-review'),
    content: aflTradePostseasonMaterializationReviewContentSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    addAflTradeContentAddressIssue(
      'postseason-materialization-review',
      record.reviewId,
      record.content,
      ctx,
      ['reviewId']
    );
  });

export function createAflTradePostseasonMaterializationReview(
  input: z.input<typeof aflTradePostseasonMaterializationReviewContentSchema>
) {
  const content = aflTradePostseasonMaterializationReviewContentSchema.parse(input);
  return aflTradePostseasonMaterializationReviewSchema.parse({
    reviewId: createAflTradeContentAddress('postseason-materialization-review', content),
    content,
  });
}
