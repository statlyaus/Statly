import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import { aflTradePostseasonYearContentSchema } from '../domain/postseasonYearContext';

const year = aflTradePostseasonYearContentSchema.shape;

function validateCommonReview(
  record: {
    tradeDate: string | null;
    tradeYear: number;
    reviewEvidence: { createdAt: string };
    createdAt: string;
  },
  ctx: z.RefinementCtx
) {
  if (record.tradeDate !== null && Number(record.tradeDate.slice(0, 4)) !== record.tradeYear) {
    ctx.addIssue({ code: 'custom', message: 'Reviewed date and year differ.' });
  }
  if (Date.parse(record.reviewEvidence.createdAt) > Date.parse(record.createdAt)) {
    ctx.addIssue({ code: 'custom', message: 'Review proposal precedes its evidence.' });
  }
}

/** Review content excludes the later decision ID and its actual recording timestamp. */
const observationReviewContentSchema = z
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
  .superRefine(validateCommonReview);

/** Retained parent selection is factual contract authority, never permission to execute a model. */
const valuationParentsSchema = z
  .object({
    componentDrawSetArtifact: aflTradeArtifactRefSchema,
    realizedContributionLedgerArtifact: aflTradeArtifactRefSchema,
    packagePolicyArtifact: aflTradeArtifactRefSchema,
    lineageGraphArtifact: aflTradeArtifactRefSchema,
    laterEffectiveAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const valuationReviewContentSchema = z
  .object({
    ...observationReviewContentSchema.shape,
    schemaVersion: z.literal('afl-trade-postseason-materialization-review/v2'),
    valuation: valuationParentsSchema,
  })
  .strict()
  .superRefine((record, ctx) => {
    validateCommonReview(record, ctx);
    const refs = [
      record.valuation.componentDrawSetArtifact,
      record.valuation.realizedContributionLedgerArtifact,
      record.valuation.packagePolicyArtifact,
      record.valuation.lineageGraphArtifact,
    ];
    if (
      new Set(refs.map((ref) => ref.artifactId)).size !== refs.length ||
      refs.some((ref) => Date.parse(ref.createdAt) > Date.parse(record.createdAt))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Valuation parents must be distinct and precede their review proposal.',
      });
    }
  });

export const aflTradePostseasonMaterializationReviewContentSchema = z.union([
  observationReviewContentSchema,
  valuationReviewContentSchema,
]);

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
