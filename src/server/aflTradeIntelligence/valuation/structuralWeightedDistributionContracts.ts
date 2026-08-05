import { z } from 'zod';

import {
  AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
  compareAflTradeCodeUnits,
  doAflTradeProbabilityMassesReconcile,
  isAflTradeUnitProbabilityMass,
  sumAflTradeFiniteNumbers,
} from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import { aflTradePublicIdSchema } from '@/types/aflTradeIntelligence/shared';

export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION =
  'afl-trade-structural-weighted-distribution/v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION =
  'afl-trade-structural-weighted-distribution-input/v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION =
  'complete_iff_every_positive_weight_draw_is_available_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION =
  'positive_binary64_weights_code_unit_ordered_neumaier_w_within_absolute_1e_8_unconditional_raw_submass_over_actual_w_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION =
  'raw_event_submass_over_actual_available_mass_observation_weight_ratios_renormalized_by_neumaier_actual_conditional_total_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION =
  'available_only_canonical_zero_exact_binary64_value_groups_numeric_then_draw_key_code_unit_order_conditional_weights_grouped_actual_total_first_cumulative_gte_q_no_epsilon_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION =
  'low_lte_threshold_elite_gte_threshold_unquantized_binary64_complete_e_over_w_partial_conditional_e_over_a_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION =
  'raw_event_submass_over_actual_w_lower_plus_raw_missing_submass_over_actual_w_assigned_independently_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION =
  'available_only_weighted_population_standard_deviation_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION =
  'available_only_max_abs_signed_unit_interval_binary64_code_unit_ordered_neumaier_conditional_mean_two_pass_sqrt_weighted_scaled_sum_squares_population_sd_support_bound_reconciliation_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE =
  'empirical_draw_measure_summary_not_sampling_error_or_model_confidence_v1' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE =
  'conditional_on_available_draws_not_complete_distribution' as const;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY =
  'source_native_afl_assets_no_user_or_fantasy_ownership' as const;

export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MIN_DRAW_COUNT = 1;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT = 100_000;
export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES = 100;

const finiteNumberSchema = z.number().finite();
const canonicalFiniteNumberSchema = finiteNumberSchema.refine((value) => !Object.is(value, -0), {
  message: 'Persisted structural weighted-distribution numbers must use canonical positive zero.',
});
const canonicalNonnegativeNumberSchema = finiteNumberSchema
  .nonnegative()
  .refine((value) => !Object.is(value, -0), {
    message: 'Persisted structural weighted-distribution numbers must use canonical positive zero.',
  });
const probabilitySchema = finiteNumberSchema
  .min(0)
  .max(1)
  .refine((value) => !Object.is(value, -0), {
    message:
      'Persisted structural weighted-distribution probabilities must use canonical positive zero.',
  });
const canonicalZeroSchema = z.literal(0).refine((value) => Object.is(value, 0), {
  message: 'Persisted structural weighted-distribution numbers must use canonical positive zero.',
});

export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_VALUE_SCOPES = [
  'universal_football_value_cross_club_comparable',
  'single_afl_club_utility_not_cross_club_comparable',
] as const;

export const aflTradeStructuralWeightedDistributionValueScopeSchema = z.enum(
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_VALUE_SCOPES
);

export const aflTradeStructuralWeightedDistributionPolicySchema = z
  .object({
    probabilityMeasureDefinitionVersion: z.literal(
      AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION
    ),
    completenessDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION
    ),
    normalizationDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION
    ),
    conditionalMeasureDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION
    ),
    quantileDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION
    ),
    eventDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION
    ),
    boundsDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION
    ),
    dispersionDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION
    ),
    statisticsArithmeticDefinitionVersion: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION
    ),
    measureScope: z.literal(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE),
    quantiles: z
      .object({
        downside: z.literal(0.1),
        median: z.literal(0.5),
        upside: z.literal(0.9),
        centralIntervalLevel: z.literal(0.8),
      })
      .strict(),
    lowReturnEvent: z
      .object({
        operator: z.literal('less_than_or_equal'),
        threshold: canonicalFiniteNumberSchema,
      })
      .strict(),
    eliteOutcomeEvent: z
      .object({
        operator: z.literal('greater_than_or_equal'),
        threshold: canonicalFiniteNumberSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.eliteOutcomeEvent.threshold <= policy.lowReturnEvent.threshold) {
      context.addIssue({
        code: 'custom',
        path: ['eliteOutcomeEvent', 'threshold'],
        message: 'The elite-outcome threshold must exceed the low-return threshold.',
      });
    }
  });

function usesCanonicalUniqueCodeUnitOrder(values: readonly string[]): boolean {
  const canonical = [...new Set(values)].sort(compareAflTradeCodeUnits);
  return (
    canonical.length === values.length &&
    canonical.every((candidate, index) => candidate === values[index])
  );
}

const unavailableReasonCodesSchema = z
  .array(aflTradePublicIdSchema)
  .min(1)
  .max(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES)
  .superRefine((reasonCodes, context) => {
    if (!usesCanonicalUniqueCodeUnitOrder(reasonCodes)) {
      context.addIssue({
        code: 'custom',
        message: 'Unavailable reason codes must be unique and use canonical code-unit order.',
      });
    }
  });

const availableObservationSchema = z
  .object({
    drawKey: aflTradePublicIdSchema,
    probabilityWeight: finiteNumberSchema.positive().max(1),
    status: z.literal('available'),
    value: finiteNumberSchema,
  })
  .strict();

const unavailableObservationSchema = z
  .object({
    drawKey: aflTradePublicIdSchema,
    probabilityWeight: finiteNumberSchema.positive().max(1),
    status: z.literal('unavailable'),
    reasonCodes: unavailableReasonCodesSchema,
  })
  .strict();

export const aflTradeStructuralWeightedDistributionObservationSchema = z.discriminatedUnion(
  'status',
  [availableObservationSchema, unavailableObservationSchema]
);

type InferredStructuralWeightedDistributionObservation = z.infer<
  typeof aflTradeStructuralWeightedDistributionObservationSchema
>;

const synchronousObservationIterableSchema = z.custom<Iterable<unknown>>(
  (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return false;
    }
    try {
      return typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
    } catch {
      return false;
    }
  },
  { message: 'Structural weighted-distribution observations must be a synchronous iterable.' }
);

export const aflTradeStructuralWeightedDistributionInputSchema = z
  .object({
    inputSchemaVersion: z.literal(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION),
    publicAssetBoundary: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY
    ),
    valueScope: aflTradeStructuralWeightedDistributionValueScopeSchema,
    valueUnitId: aflTradePublicIdSchema,
    policy: aflTradeStructuralWeightedDistributionPolicySchema,
    drawCount: z
      .number()
      .int()
      .min(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MIN_DRAW_COUNT)
      .max(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT),
    observations: synchronousObservationIterableSchema,
  })
  .strict();

export const aflTradeStructuralWeightedDistributionStatisticsSchema = z
  .object({
    minimum: canonicalFiniteNumberSchema,
    maximum: canonicalFiniteNumberSchema,
    mean: canonicalFiniteNumberSchema,
    median: canonicalFiniteNumberSchema,
    centralInterval: z
      .object({
        level: z.literal(0.8),
        lower: canonicalFiniteNumberSchema,
        upper: canonicalFiniteNumberSchema,
      })
      .strict(),
    downside: z.object({ quantile: z.literal(0.1), value: canonicalFiniteNumberSchema }).strict(),
    upside: z.object({ quantile: z.literal(0.9), value: canonicalFiniteNumberSchema }).strict(),
    empiricalDispersion: z
      .object({
        definitionVersion: z.literal(
          AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION
        ),
        weightedPopulationStandardDeviation: canonicalNonnegativeNumberSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((statistics, context) => {
    if (statistics.minimum > statistics.maximum) {
      context.addIssue({
        code: 'custom',
        path: ['maximum'],
        message: 'The maximum must be no less than the minimum.',
      });
    }
    if (statistics.mean < statistics.minimum || statistics.mean > statistics.maximum) {
      context.addIssue({
        code: 'custom',
        path: ['mean'],
        message: 'The weighted mean must lie within the observed value range.',
      });
    }
    if (
      statistics.downside.value < statistics.minimum ||
      statistics.downside.value > statistics.median ||
      statistics.median > statistics.upside.value ||
      statistics.upside.value > statistics.maximum
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Distribution quantiles must be monotonically ordered within the value range.',
      });
    }
    if (
      statistics.centralInterval.lower !== statistics.downside.value ||
      statistics.centralInterval.upper !== statistics.upside.value
    ) {
      context.addIssue({
        code: 'custom',
        path: ['centralInterval'],
        message: 'The 80% central interval must use the reported P10 and P90 endpoints.',
      });
    }
  });

export const aflTradeStructuralWeightedDistributionEventProbabilitiesSchema = z
  .object({
    lowReturnProbability: probabilitySchema,
    eliteOutcomeProbability: probabilitySchema,
  })
  .strict()
  .superRefine((probabilities, context) => {
    const total = sumAflTradeFiniteNumbers([
      probabilities.lowReturnProbability,
      probabilities.eliteOutcomeProbability,
    ]);
    if (total > 1 && !doAflTradeProbabilityMassesReconcile(total, 1)) {
      context.addIssue({
        code: 'custom',
        message:
          'Disjoint low-return and elite-outcome probabilities must reconcile to no more than one within the governed tolerance.',
      });
    }
  });

const probabilityBoundsSchema = z
  .object({
    lower: probabilitySchema,
    upper: probabilitySchema,
  })
  .strict()
  .superRefine((bounds, context) => {
    if (bounds.lower > bounds.upper) {
      context.addIssue({
        code: 'custom',
        path: ['upper'],
        message: 'An event-probability upper bound must be no less than its lower bound.',
      });
    }
  });

export const aflTradeStructuralWeightedDistributionEventBoundsSchema = z
  .object({
    lowReturn: probabilityBoundsSchema,
    eliteOutcome: probabilityBoundsSchema,
  })
  .strict();

const drawCountSchema = z
  .number()
  .int()
  .min(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MIN_DRAW_COUNT)
  .max(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT);
const resultDrawCountSchema = z
  .number()
  .int()
  .min(0)
  .max(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT);

const structuralWeightedDistributionResultBaseShape = {
  schemaVersion: z.literal(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION),
  inputSchemaVersion: z.literal(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION),
  publicAssetBoundary: z.literal(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY),
  valueScope: aflTradeStructuralWeightedDistributionValueScopeSchema,
  valueUnitId: aflTradePublicIdSchema,
  policy: aflTradeStructuralWeightedDistributionPolicySchema,
  inputProbabilityWeightTotal: finiteNumberSchema.positive(),
  drawCount: drawCountSchema,
  availableDrawCount: resultDrawCountSchema,
  unavailableDrawCount: resultDrawCountSchema,
  availableProbabilityMass: probabilitySchema,
  unavailableProbabilityMass: probabilitySchema,
  unconditionalEventProbabilityBounds: aflTradeStructuralWeightedDistributionEventBoundsSchema,
} as const;

const positiveResultDrawCountSchema = z
  .number()
  .int()
  .positive()
  .max(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT);
const positiveProbabilitySchema = finiteNumberSchema
  .positive()
  .max(1)
  .refine((value) => !Object.is(value, -0), {
    message:
      'Persisted structural weighted-distribution probabilities must use canonical positive zero.',
  });
const emptyReasonCodesSchema = z.array(aflTradePublicIdSchema).length(0);
const whollyUnavailableEventBoundsSchema = z
  .object({
    lowReturn: z.object({ lower: canonicalZeroSchema, upper: z.literal(1) }).strict(),
    eliteOutcome: z.object({ lower: canonicalZeroSchema, upper: z.literal(1) }).strict(),
  })
  .strict();

export const aflTradeCompleteStructuralWeightedDistributionSchema = z
  .object({
    ...structuralWeightedDistributionResultBaseShape,
    status: z.literal('complete'),
    availableDrawCount: positiveResultDrawCountSchema,
    unavailableDrawCount: canonicalZeroSchema,
    availableProbabilityMass: z.literal(1),
    unavailableProbabilityMass: canonicalZeroSchema,
    statistics: aflTradeStructuralWeightedDistributionStatisticsSchema,
    eventProbabilities: aflTradeStructuralWeightedDistributionEventProbabilitiesSchema,
    conditionalOnAvailableScope: z.null(),
    conditionalOnAvailableStatistics: z.null(),
    conditionalOnAvailableEventProbabilities: z.null(),
    reasonCodes: emptyReasonCodesSchema,
  })
  .strict();

export const aflTradePartialStructuralWeightedDistributionSchema = z
  .object({
    ...structuralWeightedDistributionResultBaseShape,
    status: z.literal('partial'),
    availableDrawCount: positiveResultDrawCountSchema,
    unavailableDrawCount: positiveResultDrawCountSchema,
    availableProbabilityMass: positiveProbabilitySchema,
    unavailableProbabilityMass: positiveProbabilitySchema,
    statistics: z.null(),
    eventProbabilities: z.null(),
    conditionalOnAvailableScope: z.literal(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE
    ),
    conditionalOnAvailableStatistics: aflTradeStructuralWeightedDistributionStatisticsSchema,
    conditionalOnAvailableEventProbabilities:
      aflTradeStructuralWeightedDistributionEventProbabilitiesSchema,
    reasonCodes: unavailableReasonCodesSchema,
  })
  .strict();

export const aflTradeUnavailableStructuralWeightedDistributionSchema = z
  .object({
    ...structuralWeightedDistributionResultBaseShape,
    status: z.literal('unavailable'),
    availableDrawCount: canonicalZeroSchema,
    unavailableDrawCount: positiveResultDrawCountSchema,
    availableProbabilityMass: canonicalZeroSchema,
    unavailableProbabilityMass: z.literal(1),
    unconditionalEventProbabilityBounds: whollyUnavailableEventBoundsSchema,
    statistics: z.null(),
    eventProbabilities: z.null(),
    conditionalOnAvailableScope: z.null(),
    conditionalOnAvailableStatistics: z.null(),
    conditionalOnAvailableEventProbabilities: z.null(),
    reasonCodes: unavailableReasonCodesSchema,
  })
  .strict();

function addResultIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string
): void {
  context.addIssue({ code: 'custom', path, message });
}

function addSummaryCoherenceIssues({
  context,
  policy,
  statistics,
  eventProbabilities,
  statisticsPath,
  eventProbabilitiesPath,
}: {
  context: z.RefinementCtx;
  policy: z.infer<typeof aflTradeStructuralWeightedDistributionPolicySchema>;
  statistics: z.infer<typeof aflTradeStructuralWeightedDistributionStatisticsSchema>;
  eventProbabilities: z.infer<
    typeof aflTradeStructuralWeightedDistributionEventProbabilitiesSchema
  >;
  statisticsPath: string;
  eventProbabilitiesPath: string;
}): void {
  if (
    statistics.minimum === statistics.maximum &&
    statistics.empiricalDispersion.weightedPopulationStandardDeviation !== 0
  ) {
    addResultIssue(
      context,
      [statisticsPath, 'empiricalDispersion', 'weightedPopulationStandardDeviation'],
      'Constant observed support must have zero weighted population dispersion.'
    );
  }

  if (
    statistics.maximum <= policy.lowReturnEvent.threshold &&
    eventProbabilities.lowReturnProbability !== 1
  ) {
    addResultIssue(
      context,
      [eventProbabilitiesPath, 'lowReturnProbability'],
      'Low-return probability must be one when all observed values satisfy its threshold.'
    );
  }
  if (
    statistics.minimum > policy.lowReturnEvent.threshold &&
    eventProbabilities.lowReturnProbability !== 0
  ) {
    addResultIssue(
      context,
      [eventProbabilitiesPath, 'lowReturnProbability'],
      'Low-return probability must be zero when no observed value satisfies its threshold.'
    );
  }
  if (
    statistics.minimum >= policy.eliteOutcomeEvent.threshold &&
    eventProbabilities.eliteOutcomeProbability !== 1
  ) {
    addResultIssue(
      context,
      [eventProbabilitiesPath, 'eliteOutcomeProbability'],
      'Elite-outcome probability must be one when all observed values satisfy its threshold.'
    );
  }
  if (
    statistics.maximum < policy.eliteOutcomeEvent.threshold &&
    eventProbabilities.eliteOutcomeProbability !== 0
  ) {
    addResultIssue(
      context,
      [eventProbabilitiesPath, 'eliteOutcomeProbability'],
      'Elite-outcome probability must be zero when no observed value satisfies its threshold.'
    );
  }
}

function boundsReconcile(
  bounds: { lower: number; upper: number },
  expectedLower: number,
  expectedUpper: number
): boolean {
  return (
    doAflTradeProbabilityMassesReconcile(bounds.lower, expectedLower) &&
    doAflTradeProbabilityMassesReconcile(bounds.upper, expectedUpper)
  );
}

function boundsAreExactlyDegenerateAtProbability(
  bounds: { lower: number; upper: number },
  probability: number
): boolean {
  return bounds.lower === probability && bounds.upper === probability;
}

export const aflTradeStructuralWeightedDistributionSchema = z
  .discriminatedUnion('status', [
    aflTradeCompleteStructuralWeightedDistributionSchema,
    aflTradePartialStructuralWeightedDistributionSchema,
    aflTradeUnavailableStructuralWeightedDistributionSchema,
  ])
  .superRefine((result, context) => {
    if (!isAflTradeUnitProbabilityMass(result.inputProbabilityWeightTotal)) {
      addResultIssue(
        context,
        ['inputProbabilityWeightTotal'],
        'The compensated input probability-weight total must be within the governed tolerance of one.'
      );
    }

    if (result.availableDrawCount + result.unavailableDrawCount !== result.drawCount) {
      addResultIssue(
        context,
        ['drawCount'],
        'Available and unavailable draw counts must reconcile to the total draw count.'
      );
    }

    if (
      !doAflTradeProbabilityMassesReconcile(
        result.availableProbabilityMass + result.unavailableProbabilityMass,
        1
      )
    ) {
      addResultIssue(
        context,
        ['availableProbabilityMass'],
        'Available and unavailable probability mass must reconcile to one.'
      );
    }

    if (result.status === 'complete') {
      if (result.availableDrawCount !== result.drawCount) {
        addResultIssue(
          context,
          ['availableDrawCount'],
          'A complete distribution must report every draw as available.'
        );
      }
      addSummaryCoherenceIssues({
        context,
        policy: result.policy,
        statistics: result.statistics,
        eventProbabilities: result.eventProbabilities,
        statisticsPath: 'statistics',
        eventProbabilitiesPath: 'eventProbabilities',
      });
      if (
        !boundsAreExactlyDegenerateAtProbability(
          result.unconditionalEventProbabilityBounds.lowReturn,
          result.eventProbabilities.lowReturnProbability
        ) ||
        !boundsAreExactlyDegenerateAtProbability(
          result.unconditionalEventProbabilityBounds.eliteOutcome,
          result.eventProbabilities.eliteOutcomeProbability
        )
      ) {
        addResultIssue(
          context,
          ['unconditionalEventProbabilityBounds'],
          'Complete-distribution event bounds must be degenerate at the complete event probabilities.'
        );
      }
      return;
    }

    if (result.status === 'unavailable') {
      if (result.unavailableDrawCount !== result.drawCount) {
        addResultIssue(
          context,
          ['unavailableDrawCount'],
          'A wholly unavailable distribution must report every draw as unavailable.'
        );
      }
      return;
    }

    const conditionalEvents = result.conditionalOnAvailableEventProbabilities;
    addSummaryCoherenceIssues({
      context,
      policy: result.policy,
      statistics: result.conditionalOnAvailableStatistics,
      eventProbabilities: conditionalEvents,
      statisticsPath: 'conditionalOnAvailableStatistics',
      eventProbabilitiesPath: 'conditionalOnAvailableEventProbabilities',
    });
    const lowReturnBounds = result.unconditionalEventProbabilityBounds.lowReturn;
    const eliteOutcomeBounds = result.unconditionalEventProbabilityBounds.eliteOutcome;
    const expectedLowReturnLower =
      conditionalEvents.lowReturnProbability * result.availableProbabilityMass;
    const expectedEliteOutcomeLower =
      conditionalEvents.eliteOutcomeProbability * result.availableProbabilityMass;
    const expectedLowReturnUpper = Math.min(
      1,
      expectedLowReturnLower + result.unavailableProbabilityMass
    );
    const expectedEliteOutcomeUpper = Math.min(
      1,
      expectedEliteOutcomeLower + result.unavailableProbabilityMass
    );

    if (
      !boundsReconcile(lowReturnBounds, expectedLowReturnLower, expectedLowReturnUpper) ||
      !boundsReconcile(eliteOutcomeBounds, expectedEliteOutcomeLower, expectedEliteOutcomeUpper)
    ) {
      addResultIssue(
        context,
        ['unconditionalEventProbabilityBounds'],
        'Partial-distribution event bounds must reconcile conditional event mass and missing probability mass.'
      );
    }

    const observedEventMass = sumAflTradeFiniteNumbers([
      lowReturnBounds.lower,
      eliteOutcomeBounds.lower,
    ]);
    if (
      observedEventMass > result.availableProbabilityMass &&
      !doAflTradeProbabilityMassesReconcile(observedEventMass, result.availableProbabilityMass)
    ) {
      addResultIssue(
        context,
        ['unconditionalEventProbabilityBounds'],
        'Observed disjoint event mass must reconcile to no more than available probability mass within the governed tolerance.'
      );
    }
  });

export type AflTradeStructuralWeightedDistributionValueScope = z.infer<
  typeof aflTradeStructuralWeightedDistributionValueScopeSchema
>;
export type AflTradeStructuralWeightedDistributionPolicy = z.infer<
  typeof aflTradeStructuralWeightedDistributionPolicySchema
>;
export type AflTradeStructuralWeightedDistributionObservation =
  InferredStructuralWeightedDistributionObservation;
export type AflTradeStructuralWeightedDistributionInput = z.infer<
  typeof aflTradeStructuralWeightedDistributionInputSchema
>;
export type AflTradeStructuralWeightedDistributionStatistics = z.infer<
  typeof aflTradeStructuralWeightedDistributionStatisticsSchema
>;
export type AflTradeStructuralWeightedDistributionEventProbabilities = z.infer<
  typeof aflTradeStructuralWeightedDistributionEventProbabilitiesSchema
>;
export type AflTradeStructuralWeightedDistributionEventBounds = z.infer<
  typeof aflTradeStructuralWeightedDistributionEventBoundsSchema
>;
export type AflTradeCompleteStructuralWeightedDistribution = z.infer<
  typeof aflTradeCompleteStructuralWeightedDistributionSchema
>;
export type AflTradePartialStructuralWeightedDistribution = z.infer<
  typeof aflTradePartialStructuralWeightedDistributionSchema
>;
export type AflTradeUnavailableStructuralWeightedDistribution = z.infer<
  typeof aflTradeUnavailableStructuralWeightedDistributionSchema
>;
export type AflTradeStructuralWeightedDistribution = z.infer<
  typeof aflTradeStructuralWeightedDistributionSchema
>;
