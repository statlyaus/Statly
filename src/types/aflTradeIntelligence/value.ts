import { z } from 'zod';

import {
  AFL_TRADE_NEXT_ACTION_KINDS,
  addAflTradeUniqueArrayIssue,
  aflTradeIsoDateTimeSchema,
  aflTradeNextActionSchema,
  aflTradePublicHrefSchema,
  aflTradePublicIdSchema,
  aflTradePublicMessageSchema,
  aflTradePublicWarningSchema,
  aflTradeTemporalContextSchema,
  aflTradeValueUnitSchema,
} from './shared';

export const AFL_TRADE_VALUATION_VIEWS = ['at_trade', 'realized', 'remaining', 'current'] as const;

export const AFL_TRADE_VALUE_AVAILABILITY = [
  'not_calculated',
  'source_blocked',
  'insufficient_data',
  'identity_unresolved',
  'lineage_unresolved',
  'model_not_approved',
  'calculating',
  'available',
  'available_partial',
  'stale',
  'failed_previous_available',
  'withdrawn',
  'unsupported_trade',
] as const;

export const AFL_TRADE_VALUE_BEARING_AVAILABILITY = [
  'available',
  'available_partial',
  'stale',
  'failed_previous_available',
] as const;

type AflTradeValueAvailabilityValue = (typeof AFL_TRADE_VALUE_AVAILABILITY)[number];
type AflTradeValueBearingAvailabilityValue =
  (typeof AFL_TRADE_VALUE_BEARING_AVAILABILITY)[number];

export const AFL_TRADE_VALUE_UNAVAILABLE_AVAILABILITY = AFL_TRADE_VALUE_AVAILABILITY.filter(
  (availability): availability is Exclude<
    AflTradeValueAvailabilityValue,
    AflTradeValueBearingAvailabilityValue
  > => !(AFL_TRADE_VALUE_BEARING_AVAILABILITY as readonly string[]).includes(availability)
);

export const AFL_TRADE_VALUE_INTERPRETATIONS = [
  'balanced_within_uncertainty',
  'leans_to_club',
  'strongly_leans_to_club',
] as const;

export const AFL_TRADE_MODEL_VINTAGES = [
  'original_vintage',
  'historical_restatement',
  'current',
] as const;

export const AFL_TRADE_COMPARISON_BASES = [
  'complete_trade',
  'included_assets_only',
  'model_adjusted_for_exclusions',
] as const;

export const AFL_TRADE_ASSESSMENT_SCOPES = ['complete_trade', 'included_assets_only'] as const;

export const AFL_TRADE_CONFIDENCE_LEVELS = ['low', 'moderate', 'high'] as const;

export const AFL_TRADE_CONFIDENCE_DIMENSIONS = [
  'model_calibration',
  'data_coverage',
  'identity',
  'lineage',
  'source_freshness',
] as const;

export const aflTradeValuationViewSchema = z.enum(AFL_TRADE_VALUATION_VIEWS);
export const aflTradeValueAvailabilitySchema = z.enum(AFL_TRADE_VALUE_AVAILABILITY);
export const aflTradeModelVintageSchema = z.enum(AFL_TRADE_MODEL_VINTAGES);

export const aflTradeUncertaintyComponentSchema = z
  .object({
    kind: z.enum(['outcome', 'model', 'data_quality', 'identity', 'lineage', 'source_freshness']),
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(300),
  })
  .strict();

export const aflTradeUncertaintySchema = z
  .object({
    lower: z.number().finite(),
    median: z.number().finite(),
    upper: z.number().finite(),
    intervalLevel: z.number().finite().gt(0).lt(1),
    components: z.array(aflTradeUncertaintyComponentSchema).min(1).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.lower > value.median || value.median > value.upper) {
      context.addIssue({
        code: 'custom',
        message: 'Uncertainty bounds must satisfy lower <= median <= upper.',
      });
    }
  });

export const aflTradeConfidenceDimensionSchema = z
  .object({
    kind: z.enum(AFL_TRADE_CONFIDENCE_DIMENSIONS),
    level: z.enum(AFL_TRADE_CONFIDENCE_LEVELS),
    reasonCode: aflTradePublicIdSchema,
    explanation: z.string().trim().min(1).max(400),
  })
  .strict();

export const aflTradeConfidenceSchema = z
  .object({
    level: z.enum(AFL_TRADE_CONFIDENCE_LEVELS),
    dimensions: z.array(aflTradeConfidenceDimensionSchema).min(1).max(
      AFL_TRADE_CONFIDENCE_DIMENSIONS.length
    ),
  })
  .strict()
  .superRefine((value, context) => {
    addAflTradeUniqueArrayIssue(
      value.dimensions.map((dimension) => dimension.kind),
      context,
      'Confidence dimensions must be unique.',
      ['dimensions']
    );
    const rank: Record<(typeof AFL_TRADE_CONFIDENCE_LEVELS)[number], number> = {
      low: 0,
      moderate: 1,
      high: 2,
    };
    const weakestLevel = value.dimensions.reduce(
      (weakest, dimension) =>
        rank[dimension.level] < rank[weakest] ? dimension.level : weakest,
      value.dimensions[0].level
    );
    if (value.level !== weakestLevel) {
      context.addIssue({
        code: 'custom',
        path: ['level'],
        message: 'Overall confidence must equal the weakest reported confidence dimension.',
      });
    }
  });

export const aflTradeOutcomeDistributionSummarySchema = z
  .object({
    downside: z
      .object({
        quantile: z.union([z.literal(0.05), z.literal(0.1)]),
        value: z.number().finite(),
      })
      .strict(),
    upside: z
      .object({
        quantile: z.union([z.literal(0.9), z.literal(0.95)]),
        value: z.number().finite(),
      })
      .strict(),
    lowReturn: z
      .object({ threshold: z.number().finite(), probability: z.number().finite().min(0).max(1) })
      .strict(),
    eliteOutcome: z
      .object({ threshold: z.number().finite(), probability: z.number().finite().min(0).max(1) })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.downside.value > value.upside.value) {
      context.addIssue({
        code: 'custom',
        message: 'The downside value cannot exceed the upside value.',
      });
    }
    if (value.lowReturn.threshold >= value.eliteOutcome.threshold) {
      context.addIssue({
        code: 'custom',
        path: ['eliteOutcome', 'threshold'],
        message: 'The elite-outcome threshold must exceed the low-return threshold.',
      });
    }
    if (value.lowReturn.probability + value.eliteOutcome.probability > 1 + 1e-9) {
      context.addIssue({
        code: 'custom',
        message: 'Mutually exclusive low-return and elite-outcome probabilities cannot exceed one.',
      });
    }
  });

export const aflTradeValueFactorSchema = z
  .object({
    kind: z.enum(['positive', 'negative', 'uncertainty']),
    code: aflTradePublicIdSchema,
    label: z.string().trim().min(1).max(120),
    explanation: z.string().trim().min(1).max(400),
  })
  .strict();

export const aflTradePackageValueComponentSchema = z
  .object({
    median: z.number().finite(),
    interval: z
      .object({
        lower: z.number().finite(),
        upper: z.number().finite(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.interval.lower > value.median || value.median > value.interval.upper) {
      context.addIssue({
        code: 'custom',
        path: ['interval'],
        message: 'Package-value interval bounds must contain the median value.',
      });
    }
  });

export const aflTradePackageValueSummarySchema = z
  .object({
    received: aflTradePackageValueComponentSchema,
    givenUp: aflTradePackageValueComponentSchema,
    net: aflTradePackageValueComponentSchema,
  })
  .strict();

export const aflTradeClubValueSchema = z
  .object({
    aflClubId: aflTradePublicIdSchema,
    clubName: z.string().trim().min(1).max(120),
    estimate: z.number().finite(),
    estimateStatistic: z.literal('mean'),
    uncertainty: aflTradeUncertaintySchema,
    distribution: aflTradeOutcomeDistributionSummarySchema,
    factors: z.array(aflTradeValueFactorSchema).max(20),
    packageValue: aflTradePackageValueSummarySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.distribution.downside.value > value.uncertainty.median ||
      value.uncertainty.median > value.distribution.upside.value
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distribution'],
        message: 'Downside and upside values must bracket the median.',
      });
    }
  });

const comparisonShape = {
  aflClubIds: z.array(aflTradePublicIdSchema).min(2).max(18),
  probabilities: z
    .array(
      z
        .object({
          aflClubId: aflTradePublicIdSchema,
          finishesAhead: z.number().finite().min(0).max(1),
        })
        .strict()
    )
    .min(2)
    .max(18),
  practicalEquivalenceProbability: z.number().finite().min(0).max(1),
};

const completeTradeComparisonSchema = z
  .object({ ...comparisonShape, basis: z.literal('complete_trade') })
  .strict();

const includedAssetsOnlyComparisonSchema = z
  .object({
    ...comparisonShape,
    basis: z.literal('included_assets_only'),
    excludedAssetIds: z.array(aflTradePublicIdSchema).min(1).max(100),
  })
  .strict();

const adjustedComparisonSchema = z
  .object({
    ...comparisonShape,
    basis: z.literal('model_adjusted_for_exclusions'),
    excludedAssetIds: z.array(aflTradePublicIdSchema).min(1).max(100),
    adjustmentMethodCode: aflTradePublicIdSchema,
    adjustmentExplanation: z.string().trim().min(1).max(400),
  })
  .strict();

export const aflTradeComparisonSchema = z
  .discriminatedUnion('basis', [
    completeTradeComparisonSchema,
    includedAssetsOnlyComparisonSchema,
    adjustedComparisonSchema,
  ])
  .superRefine((value, context) => {
    addAflTradeUniqueArrayIssue(value.aflClubIds, context, 'Comparison AFL clubs must be unique.', [
      'aflClubIds',
    ]);
    const probabilityClubIds = value.probabilities.map((entry) => entry.aflClubId);
    addAflTradeUniqueArrayIssue(
      probabilityClubIds,
      context,
      'Comparison probabilities must have one entry per AFL club.',
      ['probabilities']
    );
    if (
      value.aflClubIds.length !== probabilityClubIds.length ||
      value.aflClubIds.some((aflClubId) => !probabilityClubIds.includes(aflClubId))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['probabilities'],
        message: 'Comparison probabilities must match the declared comparison set.',
      });
    }
    const total =
      value.probabilities.reduce((sum, entry) => sum + entry.finishesAhead, 0) +
      value.practicalEquivalenceProbability;
    if (Math.abs(total - 1) > 1e-9) {
      context.addIssue({
        code: 'custom',
        path: ['probabilities'],
        message: 'Club and practical-equivalence probabilities must sum to one.',
      });
    }
    if (value.basis !== 'complete_trade') {
      addAflTradeUniqueArrayIssue(
        value.excludedAssetIds,
        context,
        'Comparison exclusions must be unique.',
        ['excludedAssetIds']
      );
    }
  });

export const aflTradeExcludedAssetSchema = z
  .object({
    assetId: aflTradePublicIdSchema,
    reasonCode: aflTradePublicIdSchema,
    message: aflTradePublicMessageSchema,
  })
  .strict();

const coverageShape = {
  totalAssetCount: z.number().int().positive(),
  valuedAssetCount: z.number().int().nonnegative(),
  excludedAssetCount: z.number().int().nonnegative(),
  coverageRatio: z.number().finite().min(0).max(1),
  excludedAssets: z.array(aflTradeExcludedAssetSchema).max(100),
};

function validateCoverage(
  value: {
    totalAssetCount: number;
    valuedAssetCount: number;
    excludedAssetCount: number;
    coverageRatio: number;
    excludedAssets: Array<{ assetId: string }>;
  },
  context: z.RefinementCtx
) {
  if (value.valuedAssetCount + value.excludedAssetCount !== value.totalAssetCount) {
    context.addIssue({
      code: 'custom',
      message: 'Valued and excluded asset counts must reconcile to the total.',
    });
  }
  if (value.excludedAssets.length !== value.excludedAssetCount) {
    context.addIssue({
      code: 'custom',
      path: ['excludedAssets'],
      message: 'Every excluded asset must have one public reason.',
    });
  }
  addAflTradeUniqueArrayIssue(
    value.excludedAssets.map((asset) => asset.assetId),
    context,
    'Excluded assets must be unique.',
    ['excludedAssets']
  );
  const expectedRatio = value.valuedAssetCount / value.totalAssetCount;
  if (Math.abs(value.coverageRatio - expectedRatio) > 1e-9) {
    context.addIssue({
      code: 'custom',
      path: ['coverageRatio'],
      message: 'Coverage ratio must equal valued assets divided by total assets.',
    });
  }
}

export const aflTradeCompleteCoverageSchema = z
  .object(coverageShape)
  .strict()
  .superRefine((value, context) => {
    validateCoverage(value, context);
    if (
      value.valuedAssetCount !== value.totalAssetCount ||
      value.excludedAssetCount !== 0 ||
      value.coverageRatio !== 1
    ) {
      context.addIssue({ code: 'custom', message: 'Complete coverage must include every asset.' });
    }
  });

export const aflTradePartialCoverageSchema = z
  .object(coverageShape)
  .strict()
  .superRefine((value, context) => {
    validateCoverage(value, context);
    if (
      value.valuedAssetCount < 1 ||
      value.valuedAssetCount >= value.totalAssetCount ||
      value.excludedAssetCount < 1
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Partial coverage must value some, but not all, assets.',
      });
    }
  });

export const aflTradeAssessmentSchema = z
  .object({
    interpretation: z.enum(AFL_TRADE_VALUE_INTERPRETATIONS),
    favouredAflClubId: aflTradePublicIdSchema.nullable(),
    scope: z.enum(AFL_TRADE_ASSESSMENT_SCOPES),
  })
  .strict();

const numericValueShape = {
  view: aflTradeValuationViewSchema,
  modelVintage: aflTradeModelVintageSchema,
  temporalContext: aflTradeTemporalContextSchema,
  unit: aflTradeValueUnitSchema,
  clubValues: z.array(aflTradeClubValueSchema).min(2).max(18),
  comparison: aflTradeComparisonSchema,
  assessment: aflTradeAssessmentSchema,
  confidence: aflTradeConfidenceSchema,
  methodologyHref: aflTradePublicHrefSchema,
};

interface NumericValueForValidation {
  view: (typeof AFL_TRADE_VALUATION_VIEWS)[number];
  modelVintage: (typeof AFL_TRADE_MODEL_VINTAGES)[number];
  clubValues: Array<{ aflClubId: string }>;
  comparison: {
    basis: (typeof AFL_TRADE_COMPARISON_BASES)[number];
    aflClubIds: string[];
    probabilities: Array<{ aflClubId: string; finishesAhead: number }>;
    excludedAssetIds?: string[];
  };
  assessment: {
    interpretation: (typeof AFL_TRADE_VALUE_INTERPRETATIONS)[number];
    favouredAflClubId: string | null;
    scope: (typeof AFL_TRADE_ASSESSMENT_SCOPES)[number];
  };
  coverage: { excludedAssets: Array<{ assetId: string }> };
}

function validateNumericModelVintage(
  value: NumericValueForValidation,
  context: z.RefinementCtx
) {
  if (value.view === 'at_trade' && value.modelVintage === 'current') {
    context.addIssue({
      code: 'custom',
      path: ['modelVintage'],
      message: 'At-trade values must be original-vintage assessments or historical restatements.',
    });
  }
  if (value.view !== 'at_trade' && value.modelVintage !== 'current') {
    context.addIssue({
      code: 'custom',
      path: ['modelVintage'],
      message: 'Realized, remaining and current views use the current model vintage.',
    });
  }
}

function validateNumericClubAlignment(
  value: NumericValueForValidation,
  context: z.RefinementCtx
) {
  const clubIds = value.clubValues.map((club) => club.aflClubId);
  addAflTradeUniqueArrayIssue(clubIds, context, 'AFL clubs must not be duplicated.', [
    'clubValues',
  ]);
  if (
    clubIds.length !== value.comparison.aflClubIds.length ||
    clubIds.some((aflClubId) => !value.comparison.aflClubIds.includes(aflClubId))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['comparison'],
      message: 'The comparison set must contain every and only valued AFL clubs.',
    });
  }
}

function validateNumericExclusionAlignment(
  value: NumericValueForValidation,
  context: z.RefinementCtx,
  coverageExcludedAssetIds: readonly string[],
  comparisonExcludedAssetIds: readonly string[]
) {
  if (
    coverageExcludedAssetIds.length !== comparisonExcludedAssetIds.length ||
    coverageExcludedAssetIds.some((assetId, index) => assetId !== comparisonExcludedAssetIds[index])
  ) {
    context.addIssue({
      code: 'custom',
      path: ['comparison'],
      message: 'The comparison basis must identify exactly the assets excluded from coverage.',
    });
  }
}

function validateNumericAssessmentScope(
  value: NumericValueForValidation,
  context: z.RefinementCtx,
  coverageExcludedAssetIds: readonly string[]
) {
  if (value.comparison.basis === 'complete_trade') {
    if (coverageExcludedAssetIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['comparison', 'basis'],
        message: 'Complete-trade comparisons require complete asset coverage.',
      });
    }
    if (value.assessment.scope !== 'complete_trade') {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'scope'],
        message: 'Complete-trade comparisons require a complete-trade assessment.',
      });
    }
  } else {
    if (coverageExcludedAssetIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['comparison', 'basis'],
        message: 'Exclusion-based comparisons require partial asset coverage.',
      });
    }
    const expectedAssessmentScope =
      value.comparison.basis === 'included_assets_only' ? 'included_assets_only' : 'complete_trade';
    if (value.assessment.scope !== expectedAssessmentScope) {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'scope'],
        message:
          value.comparison.basis === 'included_assets_only'
            ? 'Included-assets-only comparisons cannot support a complete-trade assessment.'
            : 'Model-adjusted comparisons must report a complete-trade assessment.',
      });
    }
  }
}

function validateNumericFavouredClub(
  value: NumericValueForValidation,
  context: z.RefinementCtx
) {
  const favoured = value.assessment.favouredAflClubId;
  if (value.assessment.interpretation === 'balanced_within_uncertainty') {
    if (favoured !== null) {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'favouredAflClubId'],
        message: 'Balanced results must not declare a favoured AFL club.',
      });
    }
    return;
  }
  if (favoured === null || !value.comparison.aflClubIds.includes(favoured)) {
    context.addIssue({
      code: 'custom',
      path: ['assessment', 'favouredAflClubId'],
      message: 'Leaning results require a favoured club from the comparison set.',
    });
    return;
  }
  const favouredProbability = value.comparison.probabilities.find(
    (entry) => entry.aflClubId === favoured
  )?.finishesAhead;
  if (
    favouredProbability === undefined ||
    value.comparison.probabilities.some(
      (entry) => entry.aflClubId !== favoured && entry.finishesAhead > favouredProbability
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['assessment', 'favouredAflClubId'],
      message: 'The favoured AFL club must have the highest finishes-ahead probability.',
    });
  }
}

function validateNumericValue(value: NumericValueForValidation, context: z.RefinementCtx) {
  const coverageExcludedAssetIds = value.coverage.excludedAssets
    .map((asset) => asset.assetId)
    .sort();
  const comparisonExcludedAssetIds = [...(value.comparison.excludedAssetIds ?? [])].sort();

  validateNumericModelVintage(value, context);
  validateNumericClubAlignment(value, context);
  validateNumericExclusionAlignment(
    value,
    context,
    coverageExcludedAssetIds,
    comparisonExcludedAssetIds
  );
  validateNumericAssessmentScope(value, context, coverageExcludedAssetIds);
  validateNumericFavouredClub(value, context);
}

export const aflTradeValueAvailableSchema = z
  .object({
    ...numericValueShape,
    availability: z.literal('available'),
    coverage: aflTradeCompleteCoverageSchema,
    warnings: z.array(aflTradePublicWarningSchema).max(20),
  })
  .strict()
  .superRefine(validateNumericValue);

const partialStatusShape = {
  reasonCode: aflTradePublicIdSchema,
  message: aflTradePublicMessageSchema,
  nextAction: aflTradeNextActionSchema.nullable(),
  warnings: z.array(aflTradePublicWarningSchema).min(1).max(20),
};

export const aflTradeValueAvailablePartialSchema = z
  .object({
    ...numericValueShape,
    ...partialStatusShape,
    availability: z.literal('available_partial'),
    coverage: aflTradePartialCoverageSchema,
  })
  .strict()
  .superRefine(validateNumericValue);

export const aflTradeValueStaleSchema = z
  .object({
    ...numericValueShape,
    ...partialStatusShape,
    availability: z.literal('stale'),
    coverage: z.union([aflTradeCompleteCoverageSchema, aflTradePartialCoverageSchema]),
    staleSince: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine(validateNumericValue);

export const aflTradeValueFailedPreviousAvailableSchema = z
  .object({
    ...numericValueShape,
    ...partialStatusShape,
    availability: z.literal('failed_previous_available'),
    coverage: z.union([aflTradeCompleteCoverageSchema, aflTradePartialCoverageSchema]),
    latestAttemptFailedAt: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine(validateNumericValue);

const unavailableBaseSchema = z.object({
  view: aflTradeValuationViewSchema,
  modelVintage: aflTradeModelVintageSchema.nullable(),
  temporalContext: aflTradeTemporalContextSchema.nullable(),
  reasonCode: aflTradePublicIdSchema,
  message: aflTradePublicMessageSchema,
  nextAction: aflTradeNextActionSchema.nullable(),
  warnings: z.array(aflTradePublicWarningSchema).max(20),
  methodologyHref: aflTradePublicHrefSchema,
});

export const aflTradeValueUnavailableSchema = unavailableBaseSchema
  .extend({ availability: z.enum(AFL_TRADE_VALUE_UNAVAILABLE_AVAILABILITY) })
  .strict()
  .superRefine((value, context) => {
    const allowedNextActions: Record<
      typeof value.availability,
      readonly (typeof AFL_TRADE_NEXT_ACTION_KINDS)[number][]
    > = {
      not_calculated: ['await_calculation', 'view_methodology'],
      source_blocked: ['await_source_approval', 'view_methodology'],
      insufficient_data: ['collect_more_evidence', 'view_methodology'],
      identity_unresolved: ['resolve_identity', 'view_methodology'],
      lineage_unresolved: ['resolve_lineage', 'view_methodology'],
      model_not_approved: ['await_model_approval', 'view_methodology'],
      calculating: ['await_calculation', 'retry_later'],
      withdrawn: ['view_methodology'],
      unsupported_trade: ['view_methodology'],
    };
    if (
      value.nextAction &&
      !allowedNextActions[value.availability].includes(value.nextAction.kind)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nextAction', 'kind'],
        message: `Next action ${value.nextAction.kind} is invalid for ${value.availability}.`,
      });
    }
  });

export const aflTradeValueBearingSchema = z.union([
  aflTradeValueAvailableSchema,
  aflTradeValueAvailablePartialSchema,
  aflTradeValueStaleSchema,
  aflTradeValueFailedPreviousAvailableSchema,
]);

export const aflTradeValueResultSchema = z.union([
  aflTradeValueBearingSchema,
  aflTradeValueUnavailableSchema,
]);

export function isAflTradeValueBearingAvailability(
  availability: AflTradeValueAvailability
): availability is AflTradeValueBearingAvailability {
  return (AFL_TRADE_VALUE_BEARING_AVAILABILITY as readonly string[]).includes(availability);
}

export type AflTradeValuationView = z.infer<typeof aflTradeValuationViewSchema>;
export type AflTradeValueAvailability = z.infer<typeof aflTradeValueAvailabilitySchema>;
export type AflTradeValueBearingAvailability =
  (typeof AFL_TRADE_VALUE_BEARING_AVAILABILITY)[number];
export type AflTradeValueUnavailableAvailability =
  (typeof AFL_TRADE_VALUE_UNAVAILABLE_AVAILABILITY)[number];
export type AflTradeModelVintage = z.infer<typeof aflTradeModelVintageSchema>;
export type AflTradeUncertainty = z.infer<typeof aflTradeUncertaintySchema>;
export type AflTradeConfidence = z.infer<typeof aflTradeConfidenceSchema>;
export type AflTradeOutcomeDistributionSummary = z.infer<
  typeof aflTradeOutcomeDistributionSummarySchema
>;
export type AflTradeClubValue = z.infer<typeof aflTradeClubValueSchema>;
export type AflTradeComparison = z.infer<typeof aflTradeComparisonSchema>;
export type AflTradeValueAvailable = z.infer<typeof aflTradeValueAvailableSchema>;
export type AflTradeValueAvailablePartial = z.infer<typeof aflTradeValueAvailablePartialSchema>;
export type AflTradeValueBearing = z.infer<typeof aflTradeValueBearingSchema>;
export type AflTradeValueUnavailable = z.infer<typeof aflTradeValueUnavailableSchema>;
export type AflTradeValueResult = z.infer<typeof aflTradeValueResultSchema>;
