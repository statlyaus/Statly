// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION,
  AflTradeProbabilityMeasureError,
} from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
  type AflTradeStructuralWeightedDistributionPolicy,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import {
  AflTradeStructuralWeightedDistributionError,
  type AflTradeStructuralWeightedDistributionErrorCode,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionErrors';
import { calculateAflTradeStructuralWeightedDistributionNumerics } from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionNumerics';
import type {
  AflTradeCanonicalStructuralWeightedDistributionObservation,
  AflTradeStructuralWeightedDistributionObservationSet,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionObservationSet';

type AvailableObservation = Extract<
  AflTradeCanonicalStructuralWeightedDistributionObservation,
  { status: 'available' }
>;
type UnavailableObservation = Extract<
  AflTradeCanonicalStructuralWeightedDistributionObservation,
  { status: 'unavailable' }
>;

interface Dyadic {
  coefficient: bigint;
  exponent: number;
}

const binary64 = new DataView(new ArrayBuffer(8));

function policy(
  overrides: Partial<
    Pick<AflTradeStructuralWeightedDistributionPolicy, 'lowReturnEvent' | 'eliteOutcomeEvent'>
  > = {}
): AflTradeStructuralWeightedDistributionPolicy {
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
    ...overrides,
  };
}

function available(
  drawKey: string,
  probabilityWeight: number,
  value: number
): AvailableObservation {
  return { drawKey, probabilityWeight, status: 'available', value };
}

function unavailable(drawKey: string, probabilityWeight: number): UnavailableObservation {
  return { drawKey, probabilityWeight, status: 'unavailable' };
}

function observationSet(
  observations: readonly AflTradeCanonicalStructuralWeightedDistributionObservation[],
  reasonCodes?: readonly string[]
): AflTradeStructuralWeightedDistributionObservationSet {
  const canonical = [...observations].sort((left, right) =>
    left.drawKey < right.drawKey ? -1 : left.drawKey > right.drawKey ? 1 : 0
  );
  const availableDrawCount = canonical.filter(
    (observation) => observation.status === 'available'
  ).length;
  const unavailableDrawCount = canonical.length - availableDrawCount;
  return {
    observations: canonical,
    availableDrawCount,
    unavailableDrawCount,
    reasonCodes: reasonCodes ?? (unavailableDrawCount === 0 ? [] : ['structural-unavailability']),
  };
}

function expectNumericsError(
  operation: () => unknown,
  code: AflTradeStructuralWeightedDistributionErrorCode
): AflTradeStructuralWeightedDistributionError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AflTradeStructuralWeightedDistributionError);
    expect((error as AflTradeStructuralWeightedDistributionError).code).toBe(code);
    return error as AflTradeStructuralWeightedDistributionError;
  }
  throw new Error(`Expected structural weighted-distribution error ${code}.`);
}

function normalizeDyadic(value: Dyadic): Dyadic {
  if (value.coefficient === 0n) return { coefficient: 0n, exponent: 0 };
  let { coefficient, exponent } = value;
  while ((coefficient & 1n) === 0n) {
    coefficient >>= 1n;
    exponent += 1;
  }
  return { coefficient, exponent };
}

function numberAsExactDyadic(value: number): Dyadic {
  if (!Number.isFinite(value)) throw new TypeError('The independent oracle requires finite input.');
  if (value === 0) return { coefficient: 0n, exponent: 0 };
  binary64.setFloat64(0, value, false);
  const bits = binary64.getBigUint64(0, false);
  const negative = bits >> 63n === 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0x000f_ffff_ffff_ffffn;
  const coefficient = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
  return normalizeDyadic({
    coefficient: negative ? -coefficient : coefficient,
    exponent: exponentBits === 0 ? -1074 : exponentBits - 1023 - 52,
  });
}

function addDyadics(left: Dyadic, right: Dyadic): Dyadic {
  if (left.coefficient === 0n) return right;
  if (right.coefficient === 0n) return left;
  const exponent = Math.min(left.exponent, right.exponent);
  return normalizeDyadic({
    coefficient:
      (left.coefficient << BigInt(left.exponent - exponent)) +
      (right.coefficient << BigInt(right.exponent - exponent)),
    exponent,
  });
}

function subtractDyadics(left: Dyadic, right: Dyadic): Dyadic {
  return addDyadics(left, { coefficient: -right.coefficient, exponent: right.exponent });
}

function multiplyDyadics(left: Dyadic, right: Dyadic): Dyadic {
  return normalizeDyadic({
    coefficient: left.coefficient * right.coefficient,
    exponent: left.exponent + right.exponent,
  });
}

function bitLength(value: bigint): number {
  const magnitude = value < 0n ? -value : value;
  return magnitude.toString(2).length;
}

function leadingMantissa(value: bigint): { mantissa: number; exponent: number } {
  const magnitude = value < 0n ? -value : value;
  const bits = bitLength(magnitude);
  const retainedBits = Math.min(bits, 53);
  const shift = bits - retainedBits;
  return {
    mantissa: Number(magnitude >> BigInt(shift)) / 2 ** (retainedBits - 1),
    exponent: bits - 1,
  };
}

function dyadicRatioToNumber(numerator: Dyadic, denominator: Dyadic): number {
  if (numerator.coefficient === 0n) return 0;
  const numeratorParts = leadingMantissa(numerator.coefficient);
  const denominatorParts = leadingMantissa(denominator.coefficient);
  let mantissa = numeratorParts.mantissa / denominatorParts.mantissa;
  let exponent =
    numeratorParts.exponent - denominatorParts.exponent + numerator.exponent - denominator.exponent;
  if (mantissa < 1) {
    mantissa *= 2;
    exponent -= 1;
  } else if (mantissa >= 2) {
    mantissa /= 2;
    exponent += 1;
  }
  return (numerator.coefficient < 0n ? -1 : 1) * mantissa * 2 ** exponent;
}

function squareRootOfDyadicRatio(numerator: Dyadic, denominator: Dyadic): number {
  if (numerator.coefficient === 0n) return 0;
  const numeratorParts = leadingMantissa(numerator.coefficient);
  const denominatorParts = leadingMantissa(denominator.coefficient);
  let mantissa = numeratorParts.mantissa / denominatorParts.mantissa;
  let exponent =
    numeratorParts.exponent - denominatorParts.exponent + numerator.exponent - denominator.exponent;
  if (mantissa < 1) {
    mantissa *= 2;
    exponent -= 1;
  } else if (mantissa >= 2) {
    mantissa /= 2;
    exponent += 1;
  }
  if (exponent % 2 !== 0) {
    mantissa *= 2;
    exponent -= 1;
  }
  return Math.sqrt(mantissa) * 2 ** (exponent / 2);
}

function exactWeightedMoments(observations: readonly AvailableObservation[]): {
  mean: number;
  standardDeviation: number;
} {
  let totalWeight: Dyadic = { coefficient: 0n, exponent: 0 };
  let weightedValue: Dyadic = { coefficient: 0n, exponent: 0 };
  let weightedSquare: Dyadic = { coefficient: 0n, exponent: 0 };
  for (const observation of observations) {
    const weight = numberAsExactDyadic(observation.probabilityWeight);
    const value = numberAsExactDyadic(observation.value);
    totalWeight = addDyadics(totalWeight, weight);
    weightedValue = addDyadics(weightedValue, multiplyDyadics(weight, value));
    weightedSquare = addDyadics(
      weightedSquare,
      multiplyDyadics(weight, multiplyDyadics(value, value))
    );
  }
  const varianceNumerator = subtractDyadics(
    multiplyDyadics(weightedSquare, totalWeight),
    multiplyDyadics(weightedValue, weightedValue)
  );
  const varianceDenominator = multiplyDyadics(totalWeight, totalWeight);
  return {
    mean: dyadicRatioToNumber(weightedValue, totalWeight),
    standardDeviation: squareRootOfDyadicRatio(varianceNumerator, varianceDenominator),
  };
}

function nextBinary64(value: number, direction: 'down' | 'up'): number {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return direction === 'up' ? Number.MIN_VALUE : -Number.MIN_VALUE;
  binary64.setFloat64(0, value, false);
  let bits = binary64.getBigUint64(0, false);
  const increaseBits = value > 0 === (direction === 'up');
  bits = increaseBits ? bits + 1n : bits - 1n;
  binary64.setBigUint64(0, bits, false);
  return binary64.getFloat64(0, false);
}

function expectCloseToRelative(actual: number, expected: number, relativeTolerance = 2e-14): void {
  if (expected === 0) {
    expect(Math.abs(actual)).toBeLessThanOrEqual(Number.MIN_VALUE);
    return;
  }
  expect(Math.abs((actual - expected) / expected)).toBeLessThanOrEqual(relativeTolerance);
}

function expectCanonicalZeros(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === 'number' && value === 0) {
    expect(Object.is(value, -0)).toBe(false);
    return;
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const nested of Object.values(value)) expectCanonicalZeros(nested, seen);
}

function expectDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested, seen);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('AFL trade structural weighted-distribution numerical states', () => {
  it('derives ordinary complete weighted statistics from hand-calculated values', () => {
    const observations = [
      available('draw-a', 0.1, -10),
      available('draw-b', 0.2, 0),
      available('draw-c', 0.3, 10),
      available('draw-d', 0.4, 20),
    ];
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet(observations),
      policy()
    );

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('Expected a complete result.');
    expect(result.statistics).toEqual({
      minimum: -10,
      maximum: 20,
      mean: 10,
      median: 10,
      centralInterval: { level: 0.8, lower: -10, upper: 20 },
      downside: { quantile: 0.1, value: -10 },
      upside: { quantile: 0.9, value: 20 },
      empiricalDispersion: {
        definitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
        weightedPopulationStandardDeviation: 10,
      },
    });
    expect(result.eventProbabilities.lowReturnProbability).toBeCloseTo(0.3, 15);
    expect(result.eventProbabilities.eliteOutcomeProbability).toBeCloseTo(0.7, 15);
    expect(result.unconditionalEventProbabilityBounds.lowReturn.lower).toBe(
      result.eventProbabilities.lowReturnProbability
    );
    expect(result.unconditionalEventProbabilityBounds.lowReturn.upper).toBe(
      result.eventProbabilities.lowReturnProbability
    );
    expect(result.unconditionalEventProbabilityBounds.eliteOutcome.lower).toBe(
      result.eventProbabilities.eliteOutcomeProbability
    );
    expect(result.unconditionalEventProbabilityBounds.eliteOutcome.upper).toBe(
      result.eventProbabilities.eliteOutcomeProbability
    );
    expect(result.conditionalOnAvailableScope).toBeNull();
  });

  it('derives partial conditional summaries and direct unconditional E/W bounds', () => {
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet([
        available('draw-a', 0.2, -1),
        available('draw-b', 0.3, 5),
        available('draw-c', 0.1, 10),
        unavailable('draw-d', 0.4),
      ]),
      policy()
    );

    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected a partial result.');
    expect(result.availableProbabilityMass).toBeCloseTo(0.6, 15);
    expect(result.unavailableProbabilityMass).toBeCloseTo(0.4, 15);
    expect(result.statistics).toBeNull();
    expect(result.eventProbabilities).toBeNull();
    expect(result.conditionalOnAvailableScope).toBe(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE
    );
    expect(result.conditionalOnAvailableEventProbabilities.lowReturnProbability).toBeCloseTo(
      1 / 3,
      15
    );
    expect(result.conditionalOnAvailableEventProbabilities.eliteOutcomeProbability).toBeCloseTo(
      1 / 6,
      15
    );
    expect(result.unconditionalEventProbabilityBounds.lowReturn.lower).toBeCloseTo(0.2, 15);
    expect(result.unconditionalEventProbabilityBounds.lowReturn.upper).toBeCloseTo(0.6, 15);
    expect(result.unconditionalEventProbabilityBounds.eliteOutcome.lower).toBeCloseTo(0.1, 15);
    expect(result.unconditionalEventProbabilityBounds.eliteOutcome.upper).toBeCloseTo(0.5, 15);
  });

  it('takes partial lower bounds directly from E/W when a reconstructed product differs', () => {
    const eventWeight = 2.7934029957198183e-250;
    const otherAvailableWeight = 0.8141227171523496;
    const unavailableWeight = 0.18587728284765037;
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet([
        available('draw-a', eventWeight, -1),
        available('draw-b', otherAvailableWeight, 5),
        unavailable('draw-c', unavailableWeight),
      ]),
      policy()
    );

    expect(result.status).toBe('partial');
    if (result.status !== 'partial') throw new Error('Expected a partial result.');
    const reconstructedLower =
      result.conditionalOnAvailableEventProbabilities.lowReturnProbability *
      result.availableProbabilityMass;

    expect(reconstructedLower).not.toBe(eventWeight);
    expect(result.unconditionalEventProbabilityBounds.lowReturn.lower).toBe(eventWeight);
  });

  it('derives the wholly unavailable state without conditional statistics', () => {
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet(
        [unavailable('draw-a', 0.4), unavailable('draw-b', 0.6)],
        ['identity-unresolved', 'source-missing']
      ),
      policy()
    );

    expect(result).toMatchObject({
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
      reasonCodes: ['identity-unresolved', 'source-missing'],
    });
  });
});

describe('AFL trade structural weighted-distribution full-range arithmetic', () => {
  it('retains ordinary ±1e280 moments when negligible ±MAX support would collapse an affine coordinate', () => {
    const observations = [
      available('draw-a', Number.MIN_VALUE, -Number.MAX_VALUE),
      available('draw-b', 0.25, -1e280),
      available('draw-c', 0.75, 1e280),
      available('draw-d', Number.MIN_VALUE, Number.MAX_VALUE),
    ];
    const oracle = exactWeightedMoments(observations);
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet(observations),
      policy()
    );
    if (result.status !== 'complete') throw new Error('Expected a complete result.');

    expectCloseToRelative(result.statistics.mean, oracle.mean);
    expectCloseToRelative(
      result.statistics.empiricalDispersion.weightedPopulationStandardDeviation,
      oracle.standardDeviation
    );
    expect(Math.abs(result.statistics.mean)).toBeGreaterThan(1e279);
  });

  it('keeps nonzero dispersion for {0,w≈1; MAX,w=MIN}', () => {
    const observations = [
      available('draw-a', 1, 0),
      available('draw-b', Number.MIN_VALUE, Number.MAX_VALUE),
    ];
    const oracle = exactWeightedMoments(observations);
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet(observations),
      policy()
    );
    if (result.status !== 'complete') throw new Error('Expected a complete result.');

    const dispersion = result.statistics.empiricalDispersion.weightedPopulationStandardDeviation;
    expect(dispersion).toBeGreaterThan(0);
    expectCloseToRelative(dispersion, oracle.standardDeviation);
    expectCloseToRelative(result.statistics.mean, oracle.mean);
  });

  it('derives zero mean and MAX dispersion for equal ±MAX support', () => {
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet([
        available('draw-a', 0.5, -Number.MAX_VALUE),
        available('draw-b', 0.5, Number.MAX_VALUE),
      ]),
      policy()
    );
    if (result.status !== 'complete') throw new Error('Expected a complete result.');

    expect(result.statistics.mean).toBe(0);
    expect(result.statistics.empiricalDispersion.weightedPopulationStandardDeviation).toBe(
      Number.MAX_VALUE
    );
  });

  it('preserves subnormal ±MIN support, zero mean, and MIN dispersion', () => {
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet([
        available('draw-a', 0.5, -Number.MIN_VALUE),
        available('draw-b', 0.5, Number.MIN_VALUE),
      ]),
      policy()
    );
    if (result.status !== 'complete') throw new Error('Expected a complete result.');

    expect(result.statistics.minimum).toBe(-Number.MIN_VALUE);
    expect(result.statistics.maximum).toBe(Number.MIN_VALUE);
    expect(result.statistics.mean).toBe(0);
    expect(result.statistics.empiricalDispersion.weightedPopulationStandardDeviation).toBe(
      Number.MIN_VALUE
    );
  });
});

describe('AFL trade structural weighted-distribution quantiles and events', () => {
  it('uses inclusive thresholds and distinguishes their immediate binary64 neighbors', () => {
    const observations = [
      available('draw-a', 0.2, nextBinary64(0, 'down')),
      available('draw-b', 0.2, 0),
      available('draw-c', 0.2, nextBinary64(0, 'up')),
      available('draw-d', 0.2, nextBinary64(10, 'down')),
      available('draw-e', 0.2, 10),
    ];
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet(observations),
      policy()
    );
    if (result.status !== 'complete') throw new Error('Expected a complete result.');

    expect(result.eventProbabilities.lowReturnProbability).toBeCloseTo(0.4, 15);
    expect(result.eventProbabilities.eliteOutcomeProbability).toBeCloseTo(0.2, 15);
  });

  it('groups exact tied zero values before epsilon-free inverse-CDF selection', () => {
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet([
        available('draw-a', 0.05, 0),
        available('draw-b', 0.05, 0),
        available('draw-c', 0.4, 5),
        available('draw-d', 0.5, 10),
      ]),
      policy()
    );
    if (result.status !== 'complete') throw new Error('Expected a complete result.');

    expect(result.statistics.downside.value).toBe(0);
    expect(result.statistics.median).toBe(5);
    expect(result.statistics.upside.value).toBe(10);
    expectCanonicalZeros(result.statistics);
  });

  it('canonicalizes every reported zero for constant-zero and unavailable distributions', () => {
    const complete = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet([available('draw-a', 1, 0)]),
      policy()
    );
    const missing = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet([unavailable('draw-a', 1)]),
      policy()
    );

    expectCanonicalZeros(complete);
    expectCanonicalZeros(missing);
  });
});

describe('AFL trade structural weighted-distribution input invariants', () => {
  it.each([
    policy({ lowReturnEvent: { operator: 'less_than_or_equal', threshold: Number.NaN } }),
    policy({ eliteOutcomeEvent: { operator: 'greater_than_or_equal', threshold: Infinity } }),
    policy({ lowReturnEvent: { operator: 'less_than_or_equal', threshold: -0 } }),
    policy({
      lowReturnEvent: { operator: 'less_than_or_equal', threshold: 10 },
      eliteOutcomeEvent: { operator: 'greater_than_or_equal', threshold: 10 },
    }),
    {
      ...policy(),
      quantiles: { downside: 0.2, median: 0.5, upside: 0.9, centralIntervalLevel: 0.8 },
    },
  ])('rejects a malformed numerical policy header', (malformedPolicy) => {
    expectNumericsError(
      () =>
        calculateAflTradeStructuralWeightedDistributionNumerics(
          observationSet([available('draw-a', 1, 1)]),
          malformedPolicy as AflTradeStructuralWeightedDistributionPolicy
        ),
      'INVALID_INPUT_HEADER'
    );
  });

  it.each([
    {
      observations: [],
      availableDrawCount: 0,
      unavailableDrawCount: 0,
      reasonCodes: [],
    },
    {
      observations: [available('draw-a', 1, 1)],
      availableDrawCount: 0,
      unavailableDrawCount: 1,
      reasonCodes: ['missing'],
    },
    {
      observations: [available('draw-b', 0.5, 1), available('draw-a', 0.5, 2)],
      availableDrawCount: 2,
      unavailableDrawCount: 0,
      reasonCodes: [],
    },
    {
      observations: [available('draw-a', 0, 1)],
      availableDrawCount: 1,
      unavailableDrawCount: 0,
      reasonCodes: [],
    },
    {
      observations: [available('draw-a', 1, Number.NaN)],
      availableDrawCount: 1,
      unavailableDrawCount: 0,
      reasonCodes: [],
    },
    {
      observations: [available('draw-a', 1, -0)],
      availableDrawCount: 1,
      unavailableDrawCount: 0,
      reasonCodes: [],
    },
    {
      observations: [unavailable('draw-a', 1)],
      availableDrawCount: 0,
      unavailableDrawCount: 1,
      reasonCodes: [],
    },
    {
      observations: [unavailable('draw-a', 1)],
      availableDrawCount: 0,
      unavailableDrawCount: 1,
      reasonCodes: ['reason-b', 'reason-a'],
    },
  ] satisfies AflTradeStructuralWeightedDistributionObservationSet[])(
    'rejects malformed internal observation-set invariants',
    (malformedSet) => {
      expectNumericsError(
        () => calculateAflTradeStructuralWeightedDistributionNumerics(malformedSet, policy()),
        'INTERNAL_RESULT_CONTRACT_VIOLATION'
      );
    }
  );

  it.each([0.5, 1.5])('rejects total input probability weight %d', (weight) => {
    expectNumericsError(
      () =>
        calculateAflTradeStructuralWeightedDistributionNumerics(
          observationSet([available('draw-a', weight, 1)]),
          policy()
        ),
      weight <= 1 ? 'INVALID_TOTAL_WEIGHT' : 'INTERNAL_RESULT_CONTRACT_VIOLATION'
    );
  });

  it('sanitizes unexpected source access failures as an internal contract violation', () => {
    const hostile = new Proxy(observationSet([available('draw-a', 1, 1)]), {
      get(target, property, receiver) {
        if (property === 'observations') throw new Error('secret hostile payload');
        return Reflect.get(target, property, receiver);
      },
    });
    const error = expectNumericsError(
      () => calculateAflTradeStructuralWeightedDistributionNumerics(hostile, policy()),
      'INTERNAL_RESULT_CONTRACT_VIOLATION'
    );
    expect(JSON.stringify(error)).not.toContain('secret hostile payload');
  });

  it('sanitizes hostile thrown values without inspecting prototypes or error-code properties', () => {
    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('secret classification trap');
        },
      }
    );
    const prototypeSpoof = Object.create(AflTradeProbabilityMeasureError.prototype, {
      code: {
        get() {
          throw new Error('secret code trap');
        },
      },
    });

    for (const hostileThrownValue of [throwingPrototype, prototypeSpoof]) {
      const hostilePolicy = new Proxy(policy(), {
        get() {
          throw hostileThrownValue;
        },
      });
      const error = expectNumericsError(
        () =>
          calculateAflTradeStructuralWeightedDistributionNumerics(
            observationSet([available('draw-a', 1, 1)]),
            hostilePolicy
          ),
        'INTERNAL_RESULT_CONTRACT_VIOLATION'
      );
      expect(error.message).toBe(
        'The structural weighted-distribution result violated its internal contract.'
      );
      expect(JSON.stringify(error)).not.toMatch(/secret (classification|code) trap/);
    }
  });
});

describe('AFL trade structural weighted-distribution isolation and determinism', () => {
  it('does not mutate deeply frozen inputs and returns a deeply frozen isolated result', () => {
    const observations = Object.freeze([
      Object.freeze(available('draw-a', 0.4, -5)),
      Object.freeze(available('draw-b', 0.3, 5)),
      Object.freeze(unavailable('draw-c', 0.3)),
    ]);
    const reasons = Object.freeze(['source-missing']);
    const input = Object.freeze({
      observations,
      availableDrawCount: 2,
      unavailableDrawCount: 1,
      reasonCodes: reasons,
    });
    const frozenPolicy = Object.freeze(policy());
    const result = calculateAflTradeStructuralWeightedDistributionNumerics(input, frozenPolicy);

    expect(input.observations).toBe(observations);
    expect(input.reasonCodes).toBe(reasons);
    expectDeeplyFrozen(result);
    expect(result.reasonCodes).not.toBe(reasons);
  });

  it('is identical across canonicalized permutations of the same draw records', () => {
    const records = [
      available('draw-a', 0.1, -10),
      available('draw-b', 0.2, 0),
      available('draw-c', 0.3, 10),
      unavailable('draw-d', 0.4),
    ];
    const permutations = [
      records,
      [...records].reverse(),
      [records[2]!, records[0]!, records[3]!, records[1]!],
    ];
    const results = permutations.map((candidate) =>
      calculateAflTradeStructuralWeightedDistributionNumerics(observationSet(candidate), policy())
    );

    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('matches an exact dyadic oracle across deterministic exponent-stratified cases', () => {
    const random = mulberry32(0x51a7_2026);
    const exponents = [-900, -600, -300, -20, 0, 20, 300, 600, 900];
    for (let caseIndex = 0; caseIndex < 24; caseIndex += 1) {
      const rawWeights = Array.from({ length: 9 }, () => 1 + Math.floor(random() * 1000));
      const rawTotal = rawWeights.reduce((total, weight) => total + weight, 0);
      const observations = exponents.map((exponent, index) => {
        const coefficient = 1 + Math.floor(random() * 4);
        const sign = random() < 0.5 ? -1 : 1;
        return available(
          `draw-${index}`,
          rawWeights[index]! / rawTotal,
          sign * coefficient * 2 ** exponent
        );
      });
      const oracle = exactWeightedMoments(observations);
      const result = calculateAflTradeStructuralWeightedDistributionNumerics(
        observationSet(observations),
        policy()
      );
      if (result.status !== 'complete') throw new Error('Expected a complete result.');

      expectCloseToRelative(result.statistics.mean, oracle.mean, 2e-13);
      expectCloseToRelative(
        result.statistics.empiricalDispersion.weightedPopulationStandardDeviation,
        oracle.standardDeviation,
        2e-13
      );
    }
  });
});
