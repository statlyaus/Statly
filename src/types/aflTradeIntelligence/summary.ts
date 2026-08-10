import { z } from 'zod';

import {
  addAflTradeUniqueArrayIssue,
  aflTradeIsoDateTimeSchema,
  aflTradeNextActionSchema,
  aflTradePublicHrefSchema,
  aflTradePublicIdSchema,
  aflTradePublicMessageSchema,
  aflTradePublicWarningSchema,
  aflTradeValueUnitSchema,
} from './shared';
import {
  AFL_TRADE_COMPARISON_BASES,
  aflTradeAssessmentSchema,
  aflTradeConfidenceSchema,
  aflTradeModelVintageSchema,
  aflTradePackageValueSummarySchema,
  aflTradeValuationViewSchema,
  aflTradeValueUnavailableSchema,
} from './value';

export { aflTradePackageValueSummarySchema } from './value';

export const aflTradeClubValueSummarySchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    clubName: z.string().trim().min(1).max(120),
    expectedValue: z.number().finite(),
    medianValue: z.number().finite(),
    interval: z
      .object({
        lower: z.number().finite(),
        upper: z.number().finite(),
        level: z.number().finite().gt(0).lt(1),
      })
      .strict(),
    finishesAheadProbability: z.number().finite().min(0).max(1),
    packageValue: aflTradePackageValueSummarySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.interval.lower > value.medianValue || value.medianValue > value.interval.upper) {
      context.addIssue({
        code: 'custom',
        path: ['interval'],
        message: 'Summary interval bounds must contain the median value.',
      });
    }
  });

const completeCoverageSummarySchema = z
  .object({
    status: z.literal('complete'),
    coverageRatio: z.literal(1),
    excludedAssetCount: z.literal(0),
  })
  .strict();

const partialCoverageSummarySchema = z
  .object({
    status: z.literal('partial'),
    coverageRatio: z.number().finite().gt(0).lt(1),
    excludedAssetCount: z.number().int().positive(),
  })
  .strict();

export const aflTradeCoverageSummarySchema = z.discriminatedUnion('status', [
  completeCoverageSummarySchema,
  partialCoverageSummarySchema,
]);

const numericSummaryShape = {
  view: aflTradeValuationViewSchema,
  modelVintage: aflTradeModelVintageSchema,
  unit: aflTradeValueUnitSchema,
  clubValues: z.array(aflTradeClubValueSummarySchema).min(2).max(18),
  practicalEquivalenceProbability: z.number().finite().min(0).max(1),
  comparisonBasis: z.enum(AFL_TRADE_COMPARISON_BASES),
  assessment: aflTradeAssessmentSchema,
  confidence: aflTradeConfidenceSchema,
  methodologyHref: aflTradePublicHrefSchema,
};

interface NumericSummaryForValidation {
  view: 'at_trade' | 'realized' | 'remaining' | 'current';
  modelVintage: 'original_vintage' | 'historical_restatement' | 'current';
  clubValues: Array<{ aflClubId: string; finishesAheadProbability: number }>;
  practicalEquivalenceProbability: number;
  comparisonBasis: (typeof AFL_TRADE_COMPARISON_BASES)[number];
  assessment: {
    interpretation: 'balanced_within_uncertainty' | 'leans_to_club' | 'strongly_leans_to_club';
    favouredAflClubId: string | null;
    scope: 'complete_trade' | 'included_assets_only';
  };
  coverage: { status: 'complete' | 'partial' };
}

function validateNumericSummary(value: NumericSummaryForValidation, context: z.RefinementCtx) {
  const clubIds = value.clubValues.map((club) => club.aflClubId);
  addAflTradeUniqueArrayIssue(clubIds, context, 'Summary AFL clubs must be unique.', ['clubValues']);

  const probabilityTotal =
    value.clubValues.reduce((sum, club) => sum + club.finishesAheadProbability, 0) +
    value.practicalEquivalenceProbability;
  if (Math.abs(probabilityTotal - 1) > 1e-9) {
    context.addIssue({
      code: 'custom',
      path: ['clubValues'],
      message: 'Summary club and practical-equivalence probabilities must sum to one.',
    });
  }

  if (value.view === 'at_trade' && value.modelVintage === 'current') {
    context.addIssue({
      code: 'custom',
      path: ['modelVintage'],
      message: 'At-trade summaries require an original-vintage assessment or restatement.',
    });
  }
  if (value.view !== 'at_trade' && value.modelVintage !== 'current') {
    context.addIssue({
      code: 'custom',
      path: ['modelVintage'],
      message: 'Realized, remaining and current summaries require the current model vintage.',
    });
  }

  const favoured = value.assessment.favouredAflClubId;
  if (value.assessment.interpretation === 'balanced_within_uncertainty') {
    if (favoured !== null) {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'favouredAflClubId'],
        message: 'Balanced summaries must not declare a favoured AFL club.',
      });
    }
  } else {
    const favouredProbability = value.clubValues.find(
      (club) => club.aflClubId === favoured
    )?.finishesAheadProbability;
    if (
      favoured === null ||
      favouredProbability === undefined ||
      value.clubValues.some(
        (club) =>
          club.aflClubId !== favoured && club.finishesAheadProbability > favouredProbability
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'favouredAflClubId'],
        message: 'A leaning summary must favour the AFL club with the highest probability.',
      });
    }
  }

  if (value.comparisonBasis === 'complete_trade') {
    if (value.coverage.status !== 'complete' || value.assessment.scope !== 'complete_trade') {
      context.addIssue({
        code: 'custom',
        path: ['comparisonBasis'],
        message: 'Complete-trade summaries require complete coverage and assessment scope.',
      });
    }
    return;
  }
  if (value.coverage.status !== 'partial') {
    context.addIssue({
      code: 'custom',
      path: ['coverage'],
      message: 'Exclusion-based summaries require partial coverage.',
    });
  }
  const expectedScope =
    value.comparisonBasis === 'included_assets_only' ? 'included_assets_only' : 'complete_trade';
  if (value.assessment.scope !== expectedScope) {
    context.addIssue({
      code: 'custom',
      path: ['assessment', 'scope'],
      message: 'Summary assessment scope must match its comparison basis.',
    });
  }
}

export const aflTradeValueAvailableSummarySchema = z
  .object({
    ...numericSummaryShape,
    availability: z.literal('available'),
    coverage: completeCoverageSummarySchema,
    warnings: z.array(aflTradePublicWarningSchema).max(20),
  })
  .strict()
  .superRefine(validateNumericSummary);

const partialSummaryShape = {
  reasonCode: aflTradePublicIdSchema,
  message: aflTradePublicMessageSchema,
  nextAction: aflTradeNextActionSchema.nullable(),
  warnings: z.array(aflTradePublicWarningSchema).min(1).max(20),
};

export const aflTradeValuePartialSummarySchema = z
  .object({
    ...numericSummaryShape,
    ...partialSummaryShape,
    availability: z.literal('available_partial'),
    coverage: partialCoverageSummarySchema,
  })
  .strict()
  .superRefine(validateNumericSummary);

export const aflTradeValueStaleSummarySchema = z
  .object({
    ...numericSummaryShape,
    ...partialSummaryShape,
    availability: z.literal('stale'),
    coverage: aflTradeCoverageSummarySchema,
    staleSince: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine(validateNumericSummary);

export const aflTradeValueFailedPreviousSummarySchema = z
  .object({
    ...numericSummaryShape,
    ...partialSummaryShape,
    availability: z.literal('failed_previous_available'),
    coverage: aflTradeCoverageSummarySchema,
    latestAttemptFailedAt: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine(validateNumericSummary);

export const aflTradeValueBearingSummarySchema = z.union([
  aflTradeValueAvailableSummarySchema,
  aflTradeValuePartialSummarySchema,
  aflTradeValueStaleSummarySchema,
  aflTradeValueFailedPreviousSummarySchema,
]);

export const aflTradeValueSummarySchema = z.union([
  aflTradeValueBearingSummarySchema,
  aflTradeValueUnavailableSchema,
]);

export type AflTradeClubValueSummary = z.infer<typeof aflTradeClubValueSummarySchema>;
export type AflTradeValueBearingSummary = z.infer<typeof aflTradeValueBearingSummarySchema>;
export type AflTradeValueSummary = z.infer<typeof aflTradeValueSummarySchema>;
