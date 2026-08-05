// @vitest-environment node

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE,
} from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_VALUE_SCOPES,
  aflTradeStructuralWeightedDistributionEventBoundsSchema,
  aflTradeStructuralWeightedDistributionEventProbabilitiesSchema,
  aflTradeStructuralWeightedDistributionInputSchema,
  aflTradeStructuralWeightedDistributionObservationSchema,
  aflTradeStructuralWeightedDistributionPolicySchema,
  aflTradeStructuralWeightedDistributionSchema,
  aflTradeStructuralWeightedDistributionStatisticsSchema,
  aflTradeStructuralWeightedDistributionValueScopeSchema,
  type AflTradeCompleteStructuralWeightedDistribution,
  type AflTradePartialStructuralWeightedDistribution,
  type AflTradeStructuralWeightedDistributionEventProbabilities,
  type AflTradeStructuralWeightedDistributionInput,
  type AflTradeStructuralWeightedDistributionObservation,
  type AflTradeStructuralWeightedDistributionPolicy,
  type AflTradeStructuralWeightedDistributionStatistics,
  type AflTradeUnavailableStructuralWeightedDistribution,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';

function policy(): AflTradeStructuralWeightedDistributionPolicy {
  return {
    probabilityMeasureDefinitionVersion: AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
    completenessDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
    normalizationDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
    conditionalMeasureDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
    quantileDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
    eventDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
    boundsDefinitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
    dispersionDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
    statisticsArithmeticDefinitionVersion:
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
    measureScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
    quantiles: {
      downside: 0.1,
      median: 0.5,
      upside: 0.9,
      centralIntervalLevel: 0.8,
    },
    lowReturnEvent: { operator: 'less_than_or_equal', threshold: 0 },
    eliteOutcomeEvent: { operator: 'greater_than_or_equal', threshold: 10 },
  };
}

function statistics(): AflTradeStructuralWeightedDistributionStatistics {
  return {
    minimum: -5,
    maximum: 15,
    mean: 5,
    median: 5,
    centralInterval: { level: 0.8, lower: -1, upper: 11 },
    downside: { quantile: 0.1, value: -1 },
    upside: { quantile: 0.9, value: 11 },
    empiricalDispersion: {
      definitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
      weightedPopulationStandardDeviation: 4,
    },
  };
}

function eventProbabilities(
  lowReturnProbability = 0.3,
  eliteOutcomeProbability = 0.2
): AflTradeStructuralWeightedDistributionEventProbabilities {
  return { lowReturnProbability, eliteOutcomeProbability };
}

function availableObservation(
  overrides: Partial<
    Extract<AflTradeStructuralWeightedDistributionObservation, { status: 'available' }>
  > = {}
): Extract<AflTradeStructuralWeightedDistributionObservation, { status: 'available' }> {
  return {
    drawKey: 'draw-a',
    probabilityWeight: 1,
    status: 'available',
    value: 5,
    ...overrides,
  };
}

function unavailableObservation(
  overrides: Partial<
    Extract<AflTradeStructuralWeightedDistributionObservation, { status: 'unavailable' }>
  > = {}
): Extract<AflTradeStructuralWeightedDistributionObservation, { status: 'unavailable' }> {
  return {
    drawKey: 'draw-a',
    probabilityWeight: 1,
    status: 'unavailable',
    reasonCodes: ['source-missing'],
    ...overrides,
  };
}

function inputHeader(
  observations: Iterable<unknown> = [availableObservation()]
): AflTradeStructuralWeightedDistributionInput {
  return {
    inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
    valueScope: 'universal_football_value_cross_club_comparable',
    valueUnitId: 'fixture-contribution-unit',
    policy: policy(),
    drawCount: 1,
    observations,
  };
}

function resultBase() {
  return {
    schemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
    inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
    valueScope: 'universal_football_value_cross_club_comparable' as const,
    valueUnitId: 'fixture-contribution-unit',
    policy: policy(),
    inputProbabilityWeightTotal: 1,
  };
}

function completeResult(): AflTradeCompleteStructuralWeightedDistribution {
  return {
    ...resultBase(),
    status: 'complete',
    drawCount: 2,
    availableDrawCount: 2,
    unavailableDrawCount: 0,
    availableProbabilityMass: 1,
    unavailableProbabilityMass: 0,
    statistics: statistics(),
    eventProbabilities: eventProbabilities(),
    conditionalOnAvailableScope: null,
    conditionalOnAvailableStatistics: null,
    conditionalOnAvailableEventProbabilities: null,
    unconditionalEventProbabilityBounds: {
      lowReturn: { lower: 0.3, upper: 0.3 },
      eliteOutcome: { lower: 0.2, upper: 0.2 },
    },
    reasonCodes: [],
  };
}

function partialResult(): AflTradePartialStructuralWeightedDistribution {
  return {
    ...resultBase(),
    status: 'partial',
    drawCount: 2,
    availableDrawCount: 1,
    unavailableDrawCount: 1,
    availableProbabilityMass: 0.6,
    unavailableProbabilityMass: 0.4,
    statistics: null,
    eventProbabilities: null,
    conditionalOnAvailableScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
    conditionalOnAvailableStatistics: statistics(),
    conditionalOnAvailableEventProbabilities: eventProbabilities(0.5, 0.25),
    unconditionalEventProbabilityBounds: {
      lowReturn: { lower: 0.3, upper: 0.7 },
      eliteOutcome: { lower: 0.15, upper: 0.55 },
    },
    reasonCodes: ['source-missing'],
  };
}

function unavailableResult(): AflTradeUnavailableStructuralWeightedDistribution {
  return {
    ...resultBase(),
    status: 'unavailable',
    drawCount: 2,
    availableDrawCount: 0,
    unavailableDrawCount: 2,
    availableProbabilityMass: 0,
    unavailableProbabilityMass: 1,
    statistics: null,
    eventProbabilities: null,
    conditionalOnAvailableScope: null,
    conditionalOnAvailableStatistics: null,
    conditionalOnAvailableEventProbabilities: null,
    unconditionalEventProbabilityBounds: {
      lowReturn: { lower: 0, upper: 1 },
      eliteOutcome: { lower: 0, upper: 1 },
    },
    reasonCodes: ['source-missing'],
  };
}

function subUlpPartialResult(): AflTradePartialStructuralWeightedDistribution {
  return {
    ...partialResult(),
    availableProbabilityMass: 1,
    unavailableProbabilityMass: Number.MIN_VALUE,
    conditionalOnAvailableEventProbabilities: eventProbabilities(0.5, 0.25),
    unconditionalEventProbabilityBounds: {
      lowReturn: { lower: 0.5, upper: 0.5 },
      eliteOutcome: { lower: 0.25, upper: 0.25 },
    },
  };
}

function replaceAtPath(value: unknown, path: readonly (string | number)[], replacement: unknown) {
  const clone = structuredClone(value);
  let cursor: unknown = clone;
  for (const key of path.slice(0, -1)) {
    if (typeof key === 'number') {
      if (!Array.isArray(cursor)) throw new Error('Expected an array fixture path.');
      cursor = cursor[key];
    } else {
      if (cursor === null || typeof cursor !== 'object') {
        throw new Error('Expected an object fixture path.');
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }
  }
  const finalKey = path.at(-1);
  if (finalKey === undefined) return replacement;
  if (typeof finalKey === 'number') {
    if (!Array.isArray(cursor)) throw new Error('Expected an array fixture path.');
    cursor[finalKey] = replacement;
  } else {
    if (cursor === null || typeof cursor !== 'object') {
      throw new Error('Expected an object fixture path.');
    }
    (cursor as Record<string, unknown>)[finalKey] = replacement;
  }
  return clone;
}

function deleteAtPath(value: unknown, path: readonly string[]) {
  const clone = structuredClone(value);
  let cursor = clone as Record<string, unknown>;
  for (const key of path.slice(0, -1)) {
    cursor = cursor[key] as Record<string, unknown>;
  }
  delete cursor[path.at(-1)!];
  return clone;
}

describe('AFL trade structural weighted-distribution immutable contracts', () => {
  it('freezes every persisted schema and mathematical definition literal', () => {
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION).toBe(
      'afl-trade-structural-weighted-distribution/v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION).toBe(
      'afl-trade-structural-weighted-distribution-input/v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION).toBe(
      'complete_iff_every_positive_weight_draw_is_available_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION).toBe(
      'positive_binary64_weights_code_unit_ordered_neumaier_w_within_absolute_1e_8_unconditional_raw_submass_over_actual_w_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION).toBe(
      'raw_event_submass_over_actual_available_mass_observation_weight_ratios_renormalized_by_neumaier_actual_conditional_total_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION).toBe(
      'available_only_canonical_zero_exact_binary64_value_groups_numeric_then_draw_key_code_unit_order_conditional_weights_grouped_actual_total_first_cumulative_gte_q_no_epsilon_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION).toBe(
      'low_lte_threshold_elite_gte_threshold_unquantized_binary64_complete_e_over_w_partial_conditional_e_over_a_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION).toBe(
      'raw_event_submass_over_actual_w_lower_plus_raw_missing_submass_over_actual_w_assigned_independently_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION).toBe(
      'available_only_weighted_population_standard_deviation_v1'
    );
    expect(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION
    ).toBe(
      'available_only_max_abs_signed_unit_interval_binary64_code_unit_ordered_neumaier_conditional_mean_two_pass_sqrt_weighted_scaled_sum_squares_population_sd_support_bound_reconciliation_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE).toBe(
      'empirical_draw_measure_summary_not_sampling_error_or_model_confidence_v1'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE).toBe(
      'conditional_on_available_draws_not_complete_distribution'
    );
  });

  it('freezes the public AFL boundary and both comparison-safety scopes', () => {
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY).toBe(
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    );
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_VALUE_SCOPES).toEqual([
      'universal_football_value_cross_club_comparable',
      'single_afl_club_utility_not_cross_club_comparable',
    ]);
    expect(
      aflTradeStructuralWeightedDistributionValueScopeSchema.safeParse(
        'universal_football_value_cross_club_comparable'
      ).success
    ).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionValueScopeSchema.safeParse(
        'single_afl_club_utility_not_cross_club_comparable'
      ).success
    ).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionValueScopeSchema.safeParse(
        'club_utility_cross_club_comparable'
      ).success
    ).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution policy contract', () => {
  it('accepts the canonical resolved policy', () => {
    expect(aflTradeStructuralWeightedDistributionPolicySchema.parse(policy())).toEqual(policy());
  });

  it.each([
    ['probabilityMeasureDefinitionVersion'],
    ['completenessDefinitionVersion'],
    ['normalizationDefinitionVersion'],
    ['conditionalMeasureDefinitionVersion'],
    ['quantileDefinitionVersion'],
    ['eventDefinitionVersion'],
    ['boundsDefinitionVersion'],
    ['dispersionDefinitionVersion'],
    ['statisticsArithmeticDefinitionVersion'],
    ['measureScope'],
  ])('rejects a changed %s literal', (...path) => {
    expect(
      aflTradeStructuralWeightedDistributionPolicySchema.safeParse(
        replaceAtPath(policy(), path, 'changed-definition/v2')
      ).success
    ).toBe(false);
  });

  it.each([
    ['probabilityMeasureDefinitionVersion'],
    ['completenessDefinitionVersion'],
    ['normalizationDefinitionVersion'],
    ['conditionalMeasureDefinitionVersion'],
    ['quantileDefinitionVersion'],
    ['eventDefinitionVersion'],
    ['boundsDefinitionVersion'],
    ['dispersionDefinitionVersion'],
    ['statisticsArithmeticDefinitionVersion'],
    ['measureScope'],
  ])('rejects an omitted %s literal', (...path) => {
    expect(
      aflTradeStructuralWeightedDistributionPolicySchema.safeParse(deleteAtPath(policy(), path))
        .success
    ).toBe(false);
  });

  it.each([
    [['quantiles', 'downside'], 0.2],
    [['quantiles', 'median'], 0.4],
    [['quantiles', 'upside'], 0.95],
    [['quantiles', 'centralIntervalLevel'], 0.9],
    [['lowReturnEvent', 'operator'], 'less_than'],
    [['eliteOutcomeEvent', 'operator'], 'greater_than'],
  ])('rejects a changed governed policy value at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionPolicySchema.safeParse(
        replaceAtPath(policy(), path, replacement)
      ).success
    ).toBe(false);
  });

  it('requires the elite threshold to be strictly greater than the low threshold', () => {
    expect(
      aflTradeStructuralWeightedDistributionPolicySchema.safeParse(
        replaceAtPath(policy(), ['eliteOutcomeEvent', 'threshold'], 0)
      ).success
    ).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionPolicySchema.safeParse(
        replaceAtPath(policy(), ['eliteOutcomeEvent', 'threshold'], -1)
      ).success
    ).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionPolicySchema.safeParse({
        ...policy(),
        eliteOutcomeEvent: {
          operator: 'greater_than_or_equal',
          threshold: Number.MIN_VALUE,
        },
      }).success
    ).toBe(true);
  });

  it.each([-0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects noncanonical or non-finite threshold %s',
    (threshold) => {
      expect(
        aflTradeStructuralWeightedDistributionPolicySchema.safeParse(
          replaceAtPath(policy(), ['lowReturnEvent', 'threshold'], threshold)
        ).success
      ).toBe(false);
    }
  );

  it.each([
    [['unexpected'], true],
    [['quantiles', 'unexpected'], true],
    [['lowReturnEvent', 'unexpected'], true],
    [['eliteOutcomeEvent', 'unexpected'], true],
  ])('rejects an unknown nested field at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionPolicySchema.safeParse(
        replaceAtPath(policy(), path, replacement)
      ).success
    ).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution observation contract', () => {
  it('accepts canonical available and unavailable observations', () => {
    expect(
      aflTradeStructuralWeightedDistributionObservationSchema.parse(availableObservation())
    ).toEqual(availableObservation());
    expect(
      aflTradeStructuralWeightedDistributionObservationSchema.parse(unavailableObservation())
    ).toEqual(unavailableObservation());
  });

  it('accepts the smallest positive weight and leaves input negative zero for the engine to canonicalize', () => {
    const parsed = aflTradeStructuralWeightedDistributionObservationSchema.parse(
      availableObservation({ probabilityWeight: Number.MIN_VALUE, value: -0 })
    );
    expect(parsed.probabilityWeight).toBe(Number.MIN_VALUE);
    expect(parsed.status).toBe('available');
    if (parsed.status !== 'available') throw new Error('Expected an available observation.');
    expect(Object.is(parsed.value, -0)).toBe(true);
  });

  it.each([-0, 0, -1, 1 + Number.EPSILON, Number.NaN, Infinity, -Infinity])(
    'rejects invalid probability weight %s',
    (probabilityWeight) => {
      expect(
        aflTradeStructuralWeightedDistributionObservationSchema.safeParse(
          availableObservation({ probabilityWeight })
        ).success
      ).toBe(false);
    }
  );

  it.each([
    { reasonCodes: ['source-missing'] },
    { partialValue: 5 },
    { ownership: { userId: 'user-a' } },
    { userId: 'user-a' },
    { fantasyLeagueId: 'league-a' },
  ])('rejects an available observation with forbidden extra fields', (extra) => {
    expect(
      aflTradeStructuralWeightedDistributionObservationSchema.safeParse({
        ...availableObservation(),
        ...extra,
      }).success
    ).toBe(false);
  });

  it.each([{ value: 5 }, { value: null }, { partialValue: 5 }, { ownerId: 'user-a' }])(
    'rejects unavailable value leakage and ownership fields',
    (extra) => {
      expect(
        aflTradeStructuralWeightedDistributionObservationSchema.safeParse({
          ...unavailableObservation(),
          ...extra,
        }).success
      ).toBe(false);
    }
  );

  it.each([
    { reasonCodes: [] },
    { reasonCodes: ['source-missing', 'source-missing'] },
    { reasonCodes: ['reason-a', ' reason-a '] },
    { reasonCodes: ['reason-a', 'reason-Z'] },
    {
      reasonCodes: Array.from(
        { length: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES + 1 },
        (_, index) => `reason-${String(index).padStart(3, '0')}`
      ),
    },
  ])('rejects invalid unavailable reason-code collections', ({ reasonCodes }) => {
    expect(
      aflTradeStructuralWeightedDistributionObservationSchema.safeParse(
        unavailableObservation({ reasonCodes })
      ).success
    ).toBe(false);
  });

  it('uses code-unit rather than locale ordering for reasons', () => {
    expect(
      aflTradeStructuralWeightedDistributionObservationSchema.safeParse(
        unavailableObservation({ reasonCodes: ['reason-Z', 'reason-a'] })
      ).success
    ).toBe(true);
  });

  it('emits the canonical-order issue for an otherwise valid unavailable observation', () => {
    const parsed = aflTradeStructuralWeightedDistributionObservationSchema.safeParse(
      unavailableObservation({ reasonCodes: ['reason-a', 'reason-Z'] })
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('Expected canonical reason-order validation to fail.');
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        code: 'custom',
        path: ['reasonCodes'],
        message: 'Unavailable reason codes must be unique and use canonical code-unit order.',
      })
    );
  });

  it.each([
    deleteAtPath(availableObservation(), ['status']),
    { ...availableObservation(), status: 'partially_available' },
  ])('rejects a missing or unknown observation discriminant', (candidate) => {
    expect(
      aflTradeStructuralWeightedDistributionObservationSchema.safeParse(candidate).success
    ).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution non-materializing input boundary', () => {
  it('checks iterable shape without invoking the iterator or reading an item', () => {
    const counters = { propertyReads: 0, iteratorInvocations: 0, nextCalls: 0, yields: 0 };
    const trackedIterable = {
      get [Symbol.iterator]() {
        counters.propertyReads += 1;
        return () => {
          counters.iteratorInvocations += 1;
          let done = false;
          return {
            next() {
              counters.nextCalls += 1;
              if (done) return { done: true as const, value: undefined };
              done = true;
              counters.yields += 1;
              return { done: false as const, value: availableObservation() };
            },
          };
        };
      },
    };

    const parsed = aflTradeStructuralWeightedDistributionInputSchema.parse(
      inputHeader(trackedIterable)
    );

    expect(counters).toEqual({
      propertyReads: 1,
      iteratorInvocations: 0,
      nextCalls: 0,
      yields: 0,
    });
    expect(parsed.observations).toBe(trackedIterable);
    expectTypeOf(parsed.observations).toEqualTypeOf<Iterable<unknown>>();
  });

  it('does not consume a one-shot generator when the same header is parsed twice', () => {
    let yielded = 0;
    function* generator() {
      yielded += 1;
      yield availableObservation();
    }
    const observations = generator();
    const header = inputHeader(observations);

    const first = aflTradeStructuralWeightedDistributionInputSchema.parse(header);
    const second = aflTradeStructuralWeightedDistributionInputSchema.parse(header);

    expect(yielded).toBe(0);
    expect(first.observations).toBe(observations);
    expect(second.observations).toBe(observations);
    expect(observations.next().done).toBe(false);
    expect(yielded).toBe(1);
  });

  it('turns a hostile Symbol.iterator getter into a schema failure', () => {
    const hostile = {
      get [Symbol.iterator](): never {
        throw new Error('hostile iterator getter');
      },
    };

    expect(() =>
      aflTradeStructuralWeightedDistributionInputSchema.safeParse(inputHeader(hostile))
    ).not.toThrow();
    expect(
      aflTradeStructuralWeightedDistributionInputSchema.safeParse(inputHeader(hostile)).success
    ).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution input shape and deferred validation', () => {
  it('accepts array, set, generator, and function-valued synchronous iterables', () => {
    function* generator() {
      yield availableObservation();
    }
    const functionIterable = Object.assign(() => undefined, {
      *[Symbol.iterator]() {
        yield availableObservation();
      },
    });

    for (const observations of [
      [availableObservation()],
      new Set([availableObservation()]),
      generator(),
      functionIterable,
    ]) {
      expect(
        aflTradeStructuralWeightedDistributionInputSchema.safeParse(inputHeader(observations))
          .success
      ).toBe(true);
    }
  });

  it.each([
    null,
    1,
    'iterable-scalar',
    {},
    { [Symbol.asyncIterator]: async function* () {} },
    { [Symbol.iterator]: 5 },
  ])('rejects a non-synchronous-iterable observation source', (observations) => {
    expect(
      aflTradeStructuralWeightedDistributionInputSchema.safeParse({
        ...inputHeader(),
        observations,
      }).success
    ).toBe(false);
  });

  it.each([0, 1.5, AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT + 1])(
    'rejects invalid declared draw count %s',
    (drawCount) => {
      expect(
        aflTradeStructuralWeightedDistributionInputSchema.safeParse({
          ...inputHeader(),
          drawCount,
        }).success
      ).toBe(false);
    }
  );

  it.each([
    { inputSchemaVersion: 'changed-input/v2' },
    { publicAssetBoundary: 'fantasy-owned-assets' },
    { valueScope: 'unknown-scope' },
    { valueUnitId: '' },
    { userId: 'user-a' },
  ])('rejects an invalid or extra header field', (override) => {
    expect(
      aflTradeStructuralWeightedDistributionInputSchema.safeParse({
        ...inputHeader(),
        ...override,
      }).success
    ).toBe(false);
  });

  it.each(['conditionalMeasureDefinitionVersion', 'statisticsArithmeticDefinitionVersion'])(
    'requires replay-critical policy field %s on input',
    (field) => {
      expect(
        aflTradeStructuralWeightedDistributionInputSchema.safeParse(
          deleteAtPath(inputHeader(), ['policy', field])
        ).success
      ).toBe(false);
    }
  );

  it('deliberately defers item, cardinality, uniqueness, and total-weight validation', () => {
    const invalidObservation = { status: 'available', value: Number.NaN };
    const deferredSources: Iterable<unknown>[] = [
      [],
      [invalidObservation],
      [availableObservation(), availableObservation()],
      [
        availableObservation({ drawKey: 'draw-a', probabilityWeight: 0.2 }),
        availableObservation({ drawKey: 'draw-b', probabilityWeight: 0.2 }),
      ],
      (function* infiniteCapableSource() {
        while (true) yield availableObservation();
      })(),
    ];

    for (const observations of deferredSources) {
      expect(
        aflTradeStructuralWeightedDistributionInputSchema.safeParse(inputHeader(observations))
          .success
      ).toBe(true);
    }
    expect(
      aflTradeStructuralWeightedDistributionObservationSchema.safeParse(invalidObservation).success
    ).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution statistics contract', () => {
  it('accepts canonical statistics and a mean outside the central interval', () => {
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(statistics()).success
    ).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse({
        ...statistics(),
        mean: 14,
      }).success
    ).toBe(true);
  });

  it.each([
    [['minimum'], 16],
    [['mean'], -6],
    [['mean'], 16],
    [['downside', 'value'], 6],
    [['median'], 12],
    [['upside', 'value'], 16],
  ])('rejects an invalid range or quantile ordering at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(statistics(), path, replacement)
      ).success
    ).toBe(false);
  });

  it.each([
    [['centralInterval', 'lower'], -2],
    [['centralInterval', 'upper'], 12],
    [['centralInterval', 'level'], 0.9],
    [['downside', 'quantile'], 0.2],
    [['upside', 'quantile'], 0.8],
  ])('rejects central-interval or quantile-definition drift at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(statistics(), path, replacement)
      ).success
    ).toBe(false);
  });

  it.each([
    ['minimum'],
    ['maximum'],
    ['mean'],
    ['median'],
    ['centralInterval', 'lower'],
    ['centralInterval', 'upper'],
    ['downside', 'value'],
    ['upside', 'value'],
    ['empiricalDispersion', 'weightedPopulationStandardDeviation'],
  ])('rejects signed zero in persisted statistics at %j', (...path) => {
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(statistics(), path, -0)
      ).success
    ).toBe(false);
  });

  it.each([Number.NaN, Infinity, -Infinity])('rejects non-finite statistic %s', (replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(statistics(), ['mean'], replacement)
      ).success
    ).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(
          statistics(),
          ['empiricalDispersion', 'weightedPopulationStandardDeviation'],
          replacement
        )
      ).success
    ).toBe(false);
  });

  it('rejects negative dispersion, definition drift, and unknown nested fields', () => {
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(
          statistics(),
          ['empiricalDispersion', 'weightedPopulationStandardDeviation'],
          -1
        )
      ).success
    ).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(
          statistics(),
          ['empiricalDispersion', 'definitionVersion'],
          'changed-dispersion/v2'
        )
      ).success
    ).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionStatisticsSchema.safeParse(
        replaceAtPath(statistics(), ['centralInterval', 'confidence'], 0.95)
      ).success
    ).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution event contracts', () => {
  it('accepts canonical disjoint event probabilities', () => {
    expect(
      aflTradeStructuralWeightedDistributionEventProbabilitiesSchema.parse(
        eventProbabilities(0.6, 0.4)
      )
    ).toEqual(eventProbabilities(0.6, 0.4));
  });

  it('uses governed reconciliation for a binary64 event-probability total', () => {
    expect(
      aflTradeStructuralWeightedDistributionEventProbabilitiesSchema.safeParse(
        eventProbabilities(0.6, 0.4 + 5e-9)
      ).success
    ).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionEventProbabilitiesSchema.safeParse(
        eventProbabilities(0.6, 0.4 + 2e-8)
      ).success
    ).toBe(false);
  });

  it.each([-0, -1, 1 + Number.EPSILON, Number.NaN, Infinity, -Infinity])(
    'rejects invalid event probability %s',
    (lowReturnProbability) => {
      expect(
        aflTradeStructuralWeightedDistributionEventProbabilitiesSchema.safeParse(
          eventProbabilities(lowReturnProbability, 0.2)
        ).success
      ).toBe(false);
    }
  );

  it('accepts independently interpreted marginal bounds whose uppers sum above one', () => {
    expect(
      aflTradeStructuralWeightedDistributionEventBoundsSchema.safeParse({
        lowReturn: { lower: 0.2, upper: 0.8 },
        eliteOutcome: { lower: 0.1, upper: 0.7 },
      }).success
    ).toBe(true);
  });

  it('rejects an exact one-ULP bound inversion', () => {
    const immediatelyAboveHalf = 0.5 + Number.EPSILON / 2;
    expect(immediatelyAboveHalf).toBeGreaterThan(0.5);
    expect(
      aflTradeStructuralWeightedDistributionEventBoundsSchema.safeParse({
        lowReturn: { lower: immediatelyAboveHalf, upper: 0.5 },
        eliteOutcome: { lower: 0.1, upper: 0.2 },
      }).success
    ).toBe(false);
  });

  it('rejects signed zero, out-of-range values, and unknown nested bound fields', () => {
    expect(
      aflTradeStructuralWeightedDistributionEventBoundsSchema.safeParse({
        lowReturn: { lower: -0, upper: 0.5 },
        eliteOutcome: { lower: 0.1, upper: 0.2 },
      }).success
    ).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionEventBoundsSchema.safeParse({
        lowReturn: { lower: 0, upper: 1 + Number.EPSILON },
        eliteOutcome: { lower: 0.1, upper: 0.2 },
      }).success
    ).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionEventBoundsSchema.safeParse({
        lowReturn: { lower: 0, upper: 0.5, confidence: 0.95 },
        eliteOutcome: { lower: 0.1, upper: 0.2 },
      }).success
    ).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution result states', () => {
  it('accepts canonical complete, partial, and wholly unavailable results', () => {
    expect(aflTradeStructuralWeightedDistributionSchema.parse(completeResult())).toEqual(
      completeResult()
    );
    expect(aflTradeStructuralWeightedDistributionSchema.parse(partialResult())).toEqual(
      partialResult()
    );
    expect(aflTradeStructuralWeightedDistributionSchema.parse(unavailableResult())).toEqual(
      unavailableResult()
    );
  });

  it.each([
    [['availableDrawCount'], 1],
    [['unavailableDrawCount'], 1],
    [['unavailableProbabilityMass'], 0.1],
    [['reasonCodes'], ['source-missing']],
    [['conditionalOnAvailableScope'], AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE],
    [['conditionalOnAvailableStatistics'], statistics()],
    [['conditionalOnAvailableEventProbabilities'], eventProbabilities()],
  ])('rejects an inconsistent complete result at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(completeResult(), path, replacement)
      ).success
    ).toBe(false);
  });

  it('requires complete bounds to be exactly degenerate', () => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(
          completeResult(),
          ['unconditionalEventProbabilityBounds', 'lowReturn', 'upper'],
          0.3 + 5e-9
        )
      ).success
    ).toBe(false);
  });

  it.each([
    [['availableDrawCount'], 0],
    [['unavailableDrawCount'], 0],
    [['availableProbabilityMass'], 0],
    [['unavailableProbabilityMass'], 0],
    [['statistics'], statistics()],
    [['eventProbabilities'], eventProbabilities()],
    [['conditionalOnAvailableScope'], null],
    [['conditionalOnAvailableScope'], 'conditional_distribution'],
    [['conditionalOnAvailableStatistics'], null],
    [['conditionalOnAvailableEventProbabilities'], null],
    [['reasonCodes'], []],
  ])('rejects an inconsistent partial result at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(partialResult(), path, replacement)
      ).success
    ).toBe(false);
  });

  it('accepts partial structural evidence even when available mass rounds to one', () => {
    expect(1 + Number.MIN_VALUE).toBe(1);
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(subUlpPartialResult()).success
    ).toBe(true);
  });

  it.each([
    [['availableDrawCount'], 1],
    [['unavailableDrawCount'], 1],
    [['availableProbabilityMass'], Number.MIN_VALUE],
    [['statistics'], statistics()],
    [['eventProbabilities'], eventProbabilities()],
    [['conditionalOnAvailableScope'], AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE],
    [['conditionalOnAvailableStatistics'], statistics()],
    [['conditionalOnAvailableEventProbabilities'], eventProbabilities()],
    [['unconditionalEventProbabilityBounds', 'lowReturn', 'upper'], 0.9],
  ])('rejects an inconsistent wholly unavailable result at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(unavailableResult(), path, replacement)
      ).success
    ).toBe(false);
  });

  it('rejects relabelling partial evidence as complete without complete-state reconciliation', () => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...partialResult(),
        status: 'complete',
      }).success
    ).toBe(false);
  });

  it('does not falsely claim standalone schema validation proves observation provenance', () => {
    const partial = partialResult();
    const structurallyCompleteButNotInputVerified = {
      ...partial,
      status: 'complete',
      availableDrawCount: partial.drawCount,
      unavailableDrawCount: 0,
      availableProbabilityMass: 1,
      unavailableProbabilityMass: 0,
      statistics: partial.conditionalOnAvailableStatistics,
      eventProbabilities: partial.conditionalOnAvailableEventProbabilities,
      conditionalOnAvailableScope: null,
      conditionalOnAvailableStatistics: null,
      conditionalOnAvailableEventProbabilities: null,
      unconditionalEventProbabilityBounds: {
        lowReturn: { lower: 0.5, upper: 0.5 },
        eliteOutcome: { lower: 0.25, upper: 0.25 },
      },
      reasonCodes: [],
    };

    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        structurallyCompleteButNotInputVerified
      ).success
    ).toBe(true);
  });
});

describe('AFL trade structural weighted-distribution support coherence', () => {
  const constantStatistics = (dispersion: number) => ({
    minimum: 5,
    maximum: 5,
    mean: 5,
    median: 5,
    centralInterval: { level: 0.8, lower: 5, upper: 5 },
    downside: { quantile: 0.1, value: 5 },
    upside: { quantile: 0.9, value: 5 },
    empiricalDispersion: {
      definitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
      weightedPopulationStandardDeviation: dispersion,
    },
  });

  it('requires zero dispersion for constant observed support', () => {
    const base = completeResult();
    const candidate = {
      ...base,
      statistics: constantStatistics(1),
      eventProbabilities: eventProbabilities(0, 0),
      unconditionalEventProbabilityBounds: {
        lowReturn: { lower: 0, upper: 0 },
        eliteOutcome: { lower: 0, upper: 0 },
      },
    };
    expect(aflTradeStructuralWeightedDistributionSchema.safeParse(candidate).success).toBe(false);
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...candidate,
        statistics: constantStatistics(0),
      }).success
    ).toBe(true);
  });

  it.each([
    {
      name: 'all values are low return',
      summary: {
        minimum: -2,
        maximum: 0,
        mean: -1,
        median: -1,
        centralInterval: { level: 0.8, lower: -2, upper: 0 },
        downside: { quantile: 0.1, value: -2 },
        upside: { quantile: 0.9, value: 0 },
        empiricalDispersion: {
          definitionVersion:
            AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
          weightedPopulationStandardDeviation: 1,
        },
      },
      probabilities: eventProbabilities(0.9, 0),
    },
    {
      name: 'no value is low return',
      summary: { ...statistics(), minimum: 1, downside: { quantile: 0.1, value: 1 } },
      probabilities: eventProbabilities(0.1, 0.2),
    },
    {
      name: 'all values are elite',
      summary: {
        ...statistics(),
        minimum: 10,
        mean: 12,
        median: 12,
        centralInterval: { level: 0.8, lower: 10, upper: 15 },
        downside: { quantile: 0.1, value: 10 },
        upside: { quantile: 0.9, value: 15 },
      },
      probabilities: eventProbabilities(0, 0.9),
    },
    {
      name: 'no value is elite',
      summary: {
        ...statistics(),
        maximum: 9,
        centralInterval: { level: 0.8, lower: -1, upper: 9 },
        upside: { quantile: 0.9, value: 9 },
      },
      probabilities: eventProbabilities(0.3, 0.1),
    },
  ])('rejects incoherent threshold probability when $name', ({ summary, probabilities }) => {
    const candidate = {
      ...completeResult(),
      statistics: summary,
      eventProbabilities: probabilities,
      unconditionalEventProbabilityBounds: {
        lowReturn: {
          lower: probabilities.lowReturnProbability,
          upper: probabilities.lowReturnProbability,
        },
        eliteOutcome: {
          lower: probabilities.eliteOutcomeProbability,
          upper: probabilities.eliteOutcomeProbability,
        },
      },
    };
    expect(aflTradeStructuralWeightedDistributionSchema.safeParse(candidate).success).toBe(false);
  });

  it('applies support coherence to partial conditional diagnostics', () => {
    const partial = partialResult();
    const candidate = {
      ...partial,
      conditionalOnAvailableStatistics: constantStatistics(0),
      conditionalOnAvailableEventProbabilities: eventProbabilities(0.5, 0),
      unconditionalEventProbabilityBounds: {
        lowReturn: { lower: 0.3, upper: 0.7 },
        eliteOutcome: { lower: 0, upper: 0.4 },
      },
    };
    expect(aflTradeStructuralWeightedDistributionSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('AFL trade structural weighted-distribution binary64 boundaries', () => {
  it.each([1 - 5e-9, 1 + 5e-9])(
    'accepts clearly in-tolerance input weight total %s',
    (inputProbabilityWeightTotal) => {
      expect(
        aflTradeStructuralWeightedDistributionSchema.safeParse({
          ...completeResult(),
          inputProbabilityWeightTotal,
        }).success
      ).toBe(true);
    }
  );

  it.each([1 - 2e-8, 1 + 2e-8])(
    'rejects clearly out-of-tolerance input weight total %s',
    (inputProbabilityWeightTotal) => {
      expect(
        aflTradeStructuralWeightedDistributionSchema.safeParse({
          ...completeResult(),
          inputProbabilityWeightTotal,
        }).success
      ).toBe(false);
    }
  );

  it('uses tolerance for normalized mass reconciliation without changing structural state', () => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...partialResult(),
        availableProbabilityMass: 0.6 + 5e-9,
      }).success
    ).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...partialResult(),
        availableProbabilityMass: 0.6 + 2e-8,
      }).success
    ).toBe(false);
  });

  it('accepts clearly sub-tolerance bound perturbation and rejects super-tolerance perturbation', () => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(
          partialResult(),
          ['unconditionalEventProbabilityBounds', 'lowReturn', 'lower'],
          0.3 + 5e-9
        )
      ).success
    ).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(
          partialResult(),
          ['unconditionalEventProbabilityBounds', 'lowReturn', 'lower'],
          0.3 + 2e-8
        )
      ).success
    ).toBe(false);
  });

  it('derives a partial upper bound independently of the submitted lower bound', () => {
    const coordinatedTamper = {
      ...partialResult(),
      unconditionalEventProbabilityBounds: {
        ...partialResult().unconditionalEventProbabilityBounds,
        lowReturn: { lower: 0.3 + 9e-9, upper: 0.7 + 18e-9 },
      },
    };
    expect(aflTradeStructuralWeightedDistributionSchema.safeParse(coordinatedTamper).success).toBe(
      false
    );
  });

  it('saturates a marginal partial upper bound at one', () => {
    const allLowStatistics = {
      minimum: -2,
      maximum: 0,
      mean: -1,
      median: -1,
      centralInterval: { level: 0.8, lower: -2, upper: 0 },
      downside: { quantile: 0.1, value: -2 },
      upside: { quantile: 0.9, value: 0 },
      empiricalDispersion: {
        definitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
        weightedPopulationStandardDeviation: 1,
      },
    };
    const candidate = {
      ...partialResult(),
      availableProbabilityMass: 0.2,
      unavailableProbabilityMass: 0.8,
      conditionalOnAvailableStatistics: allLowStatistics,
      conditionalOnAvailableEventProbabilities: eventProbabilities(1, 0),
      unconditionalEventProbabilityBounds: {
        lowReturn: { lower: 0.2, upper: 1 },
        eliteOutcome: { lower: 0, upper: 0.8 },
      },
    };
    expect(aflTradeStructuralWeightedDistributionSchema.safeParse(candidate).success).toBe(true);
  });

  it('round-trips sub-ULP missing mass without pretending the bounds widened', () => {
    expect(1 + Number.MIN_VALUE).toBe(1);
    expect(0.5 + Number.MIN_VALUE).toBe(0.5);
    const roundTripped: unknown = JSON.parse(JSON.stringify(subUlpPartialResult()));
    const parsed = aflTradeStructuralWeightedDistributionSchema.parse(roundTripped);
    expect(parsed.status).toBe('partial');
    expect(parsed.unavailableProbabilityMass).toBe(Number.MIN_VALUE);
    expect(parsed.unconditionalEventProbabilityBounds.lowReturn).toEqual({
      lower: 0.5,
      upper: 0.5,
    });
  });

  it.each([
    [completeResult(), ['unavailableDrawCount']],
    [completeResult(), ['unavailableProbabilityMass']],
    [unavailableResult(), ['availableDrawCount']],
    [unavailableResult(), ['availableProbabilityMass']],
    [unavailableResult(), ['unconditionalEventProbabilityBounds', 'lowReturn', 'lower']],
    [unavailableResult(), ['unconditionalEventProbabilityBounds', 'eliteOutcome', 'lower']],
  ])('rejects signed zero in literal-zero result fields', (fixture, path) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(replaceAtPath(fixture, path, -0))
        .success
    ).toBe(false);
  });

  it.each([Number.NaN, Infinity, -Infinity])(
    'rejects non-finite persisted input total %s',
    (inputProbabilityWeightTotal) => {
      expect(
        aflTradeStructuralWeightedDistributionSchema.safeParse({
          ...completeResult(),
          inputProbabilityWeightTotal,
        }).success
      ).toBe(false);
    }
  );

  it('records the governed tolerance without claiming exact decimal representability', () => {
    expect(AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE).toBe(1e-8);
  });
});

describe('AFL trade structural weighted-distribution strict tamper surface', () => {
  it.each([
    'confidence',
    'samplingUncertainty',
    'publicationState',
    'comparisonProbabilities',
    'aflClubId',
    'assetId',
    'subjectId',
    'userId',
    'ownerId',
    'fantasyLeagueId',
  ])('rejects forbidden top-level field %s', (field) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(completeResult(), [field], 'forbidden')
      ).success
    ).toBe(false);
  });

  it.each([
    ['policy', 'ownership'],
    ['policy', 'confidence'],
    ['policy', 'samplingUncertainty'],
    ['policy', 'userId'],
    ['policy', 'fantasyLeagueId'],
    ['statistics', 'confidence'],
    ['statistics', 'empiricalDispersion', 'samplingError'],
    ['eventProbabilities', 'confidence'],
    ['unconditionalEventProbabilityBounds', 'lowReturn', 'confidence'],
  ])('rejects forbidden nested field %j', (...path) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(completeResult(), path, 'forbidden')
      ).success
    ).toBe(false);
  });

  it.each([
    [['schemaVersion'], 'changed-result/v2'],
    [['inputSchemaVersion'], 'changed-input/v2'],
    [['publicAssetBoundary'], 'fantasy-owned-assets'],
    [['valueScope'], 'unknown-scope'],
    [['valueUnitId'], ''],
  ])('rejects changed result metadata at %j', (path, replacement) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        replaceAtPath(completeResult(), path, replacement)
      ).success
    ).toBe(false);
  });

  it.each([
    ['schemaVersion'],
    ['inputSchemaVersion'],
    ['publicAssetBoundary'],
    ['valueScope'],
    ['valueUnitId'],
    ['policy'],
  ])('rejects omitted required result metadata %s', (field) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse(
        deleteAtPath(completeResult(), [field])
      ).success
    ).toBe(false);
  });

  it.each([
    ['complete', completeResult()],
    ['partial', partialResult()],
    ['unavailable', unavailableResult()],
  ])('requires replay-critical policy fields on every %s result', (_status, result) => {
    for (const field of [
      'conditionalMeasureDefinitionVersion',
      'statisticsArithmeticDefinitionVersion',
    ]) {
      expect(
        aflTradeStructuralWeightedDistributionSchema.safeParse(
          deleteAtPath(result, ['policy', field])
        ).success
      ).toBe(false);
    }
  });

  it('allows the tagged single-club utility measure but no club identity inside the scalar kernel', () => {
    const utility = {
      ...completeResult(),
      valueScope: 'single_afl_club_utility_not_cross_club_comparable',
    };
    expect(aflTradeStructuralWeightedDistributionSchema.safeParse(utility).success).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...utility,
        evaluatedForAflClubId: 'afl-club-a',
      }).success
    ).toBe(false);
  });

  it.each([
    ['source-missing', 'source-missing'],
    ['source-missing', 'reason-Z'],
    Array.from(
      { length: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES + 1 },
      (_, index) => `reason-${String(index).padStart(3, '0')}`
    ),
  ])('rejects a noncanonical or oversized result reason union', (reasonCodes) => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...partialResult(),
        reasonCodes,
      }).success
    ).toBe(false);
  });

  it('rejects individually tolerated lower-bound drift when disjoint observed mass exceeds available mass', () => {
    const candidate = {
      ...partialResult(),
      conditionalOnAvailableEventProbabilities: eventProbabilities(0.5, 0.5),
      unconditionalEventProbabilityBounds: {
        lowReturn: { lower: 0.3 + 6e-9, upper: 0.7 },
        eliteOutcome: { lower: 0.3 + 6e-9, upper: 0.7 },
      },
    };
    expect(aflTradeStructuralWeightedDistributionSchema.safeParse(candidate).success).toBe(false);
  });

  it('retains independent marginal bounds rather than summing their uppers', () => {
    const parsed = aflTradeStructuralWeightedDistributionSchema.parse(partialResult());
    expect(
      parsed.unconditionalEventProbabilityBounds.lowReturn.upper +
        parsed.unconditionalEventProbabilityBounds.eliteOutcome.upper
    ).toBeGreaterThan(1);
  });

  it('enforces result draw-count limits', () => {
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...completeResult(),
        drawCount: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
        availableDrawCount: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
      }).success
    ).toBe(true);
    expect(
      aflTradeStructuralWeightedDistributionSchema.safeParse({
        ...completeResult(),
        drawCount: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT + 1,
        availableDrawCount: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT + 1,
      }).success
    ).toBe(false);
  });
});
