import {
  addAflTradeCompensatedTerm,
  canonicalizeAflTradeZero,
  compareAflTradeCodeUnits,
  createAflTradeCompensatedAccumulator,
  doAflTradeProbabilityMassesReconcile,
  isAflTradeProbabilityMeasureError,
  isAflTradeUnitProbabilityMass,
  readAflTradeCompensatedValue,
} from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
  type AflTradeStructuralWeightedDistributionEventBounds,
  type AflTradeStructuralWeightedDistributionEventProbabilities,
  type AflTradeStructuralWeightedDistributionPolicy,
  type AflTradeStructuralWeightedDistributionStatistics,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import {
  AflTradeStructuralWeightedDistributionError,
  isAflTradeStructuralWeightedDistributionError,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionErrors';
import type {
  AflTradeCanonicalStructuralWeightedDistributionObservation,
  AflTradeStructuralWeightedDistributionObservationSet,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionObservationSet';

interface AflTradeStructuralWeightedDistributionNumericsBase {
  readonly inputProbabilityWeightTotal: number;
  readonly drawCount: number;
  readonly availableDrawCount: number;
  readonly unavailableDrawCount: number;
  readonly availableProbabilityMass: number;
  readonly unavailableProbabilityMass: number;
  readonly unconditionalEventProbabilityBounds: AflTradeStructuralWeightedDistributionEventBounds;
  readonly reasonCodes: readonly string[];
}

export interface AflTradeCompleteStructuralWeightedDistributionNumerics extends AflTradeStructuralWeightedDistributionNumericsBase {
  readonly status: 'complete';
  readonly availableProbabilityMass: 1;
  readonly unavailableProbabilityMass: 0;
  readonly statistics: AflTradeStructuralWeightedDistributionStatistics;
  readonly eventProbabilities: AflTradeStructuralWeightedDistributionEventProbabilities;
  readonly conditionalOnAvailableScope: null;
  readonly conditionalOnAvailableStatistics: null;
  readonly conditionalOnAvailableEventProbabilities: null;
}

export interface AflTradePartialStructuralWeightedDistributionNumerics extends AflTradeStructuralWeightedDistributionNumericsBase {
  readonly status: 'partial';
  readonly statistics: null;
  readonly eventProbabilities: null;
  readonly conditionalOnAvailableScope: typeof AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE;
  readonly conditionalOnAvailableStatistics: AflTradeStructuralWeightedDistributionStatistics;
  readonly conditionalOnAvailableEventProbabilities: AflTradeStructuralWeightedDistributionEventProbabilities;
}

export interface AflTradeUnavailableStructuralWeightedDistributionNumerics extends AflTradeStructuralWeightedDistributionNumericsBase {
  readonly status: 'unavailable';
  readonly availableProbabilityMass: 0;
  readonly unavailableProbabilityMass: 1;
  readonly statistics: null;
  readonly eventProbabilities: null;
  readonly conditionalOnAvailableScope: null;
  readonly conditionalOnAvailableStatistics: null;
  readonly conditionalOnAvailableEventProbabilities: null;
}

export type AflTradeStructuralWeightedDistributionNumerics =
  | AflTradeCompleteStructuralWeightedDistributionNumerics
  | AflTradePartialStructuralWeightedDistributionNumerics
  | AflTradeUnavailableStructuralWeightedDistributionNumerics;

interface RawMeasures {
  totalWeight: number;
  availableWeight: number;
  unavailableWeight: number;
  lowReturnWeight: number;
  eliteOutcomeWeight: number;
  availableObservations: AvailableMeasureObservation[];
}

interface AvailableMeasureObservation {
  drawKey: string;
  probabilityWeight: number;
  value: number;
  conditionalWeight?: number;
}

interface QuantileGroup {
  value: number;
  probabilityMass: number;
}

interface ScaledSumOfSquares {
  scale: number;
  sumSquares: number;
}

function throwStructuralNumericsError(
  code:
    | 'INVALID_INPUT_HEADER'
    | 'INVALID_TOTAL_WEIGHT'
    | 'INCONSISTENT_PROBABILITY_MASS'
    | 'NON_FINITE_DERIVATION'
    | 'INTERNAL_RESULT_CONTRACT_VIOLATION'
): never {
  throw new AflTradeStructuralWeightedDistributionError({ code });
}

function requireFiniteDerivation(value: number): number {
  if (!Number.isFinite(value)) throwStructuralNumericsError('NON_FINITE_DERIVATION');
  return canonicalizeAflTradeZero(value);
}

function clampFinite(value: number, lower: number, upper: number): number {
  const finiteValue = requireFiniteDerivation(value);
  return canonicalizeAflTradeZero(Math.min(upper, Math.max(lower, finiteValue)));
}

function divideSubmass(submass: number, total: number): number {
  if (
    !Number.isFinite(submass) ||
    !Number.isFinite(total) ||
    submass < 0 ||
    total <= 0 ||
    (submass > total && !doAflTradeProbabilityMassesReconcile(submass, total))
  ) {
    throwStructuralNumericsError('INCONSISTENT_PROBABILITY_MASS');
  }
  return clampFinite(submass / total, 0, 1);
}

function validatePolicy(policy: AflTradeStructuralWeightedDistributionPolicy): void {
  const lowThreshold = policy.lowReturnEvent.threshold;
  const eliteThreshold = policy.eliteOutcomeEvent.threshold;
  if (
    !Number.isFinite(lowThreshold) ||
    !Number.isFinite(eliteThreshold) ||
    Object.is(lowThreshold, -0) ||
    Object.is(eliteThreshold, -0) ||
    eliteThreshold <= lowThreshold ||
    policy.quantiles.downside !== 0.1 ||
    policy.quantiles.median !== 0.5 ||
    policy.quantiles.upside !== 0.9 ||
    policy.quantiles.centralIntervalLevel !== 0.8
  ) {
    throwStructuralNumericsError('INVALID_INPUT_HEADER');
  }
}

function validateObservationSet(
  observationSet: AflTradeStructuralWeightedDistributionObservationSet
): void {
  const { observations, availableDrawCount, unavailableDrawCount, reasonCodes } = observationSet;
  if (
    observations.length < 1 ||
    observations.length > AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT ||
    availableDrawCount < 0 ||
    unavailableDrawCount < 0 ||
    availableDrawCount + unavailableDrawCount !== observations.length
  ) {
    throwStructuralNumericsError('INTERNAL_RESULT_CONTRACT_VIOLATION');
  }

  let actualAvailableCount = 0;
  let previousDrawKey: string | null = null;
  for (const observation of observations) {
    if (
      !Number.isFinite(observation.probabilityWeight) ||
      observation.probabilityWeight <= 0 ||
      observation.probabilityWeight > 1 ||
      (previousDrawKey !== null &&
        compareAflTradeCodeUnits(previousDrawKey, observation.drawKey) >= 0)
    ) {
      throwStructuralNumericsError('INTERNAL_RESULT_CONTRACT_VIOLATION');
    }
    if (
      observation.status === 'available' &&
      (!Number.isFinite(observation.value) || Object.is(observation.value, -0))
    ) {
      throwStructuralNumericsError('INTERNAL_RESULT_CONTRACT_VIOLATION');
    }
    if (observation.status === 'available') actualAvailableCount += 1;
    previousDrawKey = observation.drawKey;
  }

  if (
    actualAvailableCount !== availableDrawCount ||
    observations.length - actualAvailableCount !== unavailableDrawCount ||
    (unavailableDrawCount === 0 && reasonCodes.length !== 0) ||
    (unavailableDrawCount > 0 && reasonCodes.length === 0)
  ) {
    throwStructuralNumericsError('INTERNAL_RESULT_CONTRACT_VIOLATION');
  }
  for (let index = 1; index < reasonCodes.length; index += 1) {
    if (compareAflTradeCodeUnits(reasonCodes[index - 1]!, reasonCodes[index]!) >= 0) {
      throwStructuralNumericsError('INTERNAL_RESULT_CONTRACT_VIOLATION');
    }
  }
}

function accumulateRawMeasures(
  observations: readonly AflTradeCanonicalStructuralWeightedDistributionObservation[],
  policy: AflTradeStructuralWeightedDistributionPolicy
): RawMeasures {
  const total = createAflTradeCompensatedAccumulator();
  const available = createAflTradeCompensatedAccumulator();
  const unavailable = createAflTradeCompensatedAccumulator();
  const lowReturn = createAflTradeCompensatedAccumulator();
  const eliteOutcome = createAflTradeCompensatedAccumulator();
  const availableObservations: AvailableMeasureObservation[] = [];

  for (const observation of observations) {
    addAflTradeCompensatedTerm(total, observation.probabilityWeight);
    if (observation.status === 'unavailable') {
      addAflTradeCompensatedTerm(unavailable, observation.probabilityWeight);
      continue;
    }

    addAflTradeCompensatedTerm(available, observation.probabilityWeight);
    if (observation.value <= policy.lowReturnEvent.threshold) {
      addAflTradeCompensatedTerm(lowReturn, observation.probabilityWeight);
    }
    if (observation.value >= policy.eliteOutcomeEvent.threshold) {
      addAflTradeCompensatedTerm(eliteOutcome, observation.probabilityWeight);
    }
    availableObservations.push({
      drawKey: observation.drawKey,
      probabilityWeight: observation.probabilityWeight,
      value: observation.value,
    });
  }

  return {
    totalWeight: readAflTradeCompensatedValue(total),
    availableWeight: readAflTradeCompensatedValue(available),
    unavailableWeight: readAflTradeCompensatedValue(unavailable),
    lowReturnWeight: readAflTradeCompensatedValue(lowReturn),
    eliteOutcomeWeight: readAflTradeCompensatedValue(eliteOutcome),
    availableObservations,
  };
}

function validateRawMeasures(measures: RawMeasures): void {
  if (!isAflTradeUnitProbabilityMass(measures.totalWeight)) {
    throwStructuralNumericsError('INVALID_TOTAL_WEIGHT');
  }
  const reconstructedTotal = requireFiniteDerivation(
    measures.availableWeight + measures.unavailableWeight
  );
  if (!doAflTradeProbabilityMassesReconcile(reconstructedTotal, measures.totalWeight)) {
    throwStructuralNumericsError('INCONSISTENT_PROBABILITY_MASS');
  }
  const observedEventWeight = requireFiniteDerivation(
    measures.lowReturnWeight + measures.eliteOutcomeWeight
  );
  if (
    observedEventWeight > measures.availableWeight &&
    !doAflTradeProbabilityMassesReconcile(observedEventWeight, measures.availableWeight)
  ) {
    throwStructuralNumericsError('INCONSISTENT_PROBABILITY_MASS');
  }
}

function attachConditionalWeights(
  observations: AvailableMeasureObservation[],
  availableWeight: number
): void {
  const conditionalTotal = createAflTradeCompensatedAccumulator();
  for (const observation of observations) {
    const availableRatio = divideSubmass(observation.probabilityWeight, availableWeight);
    observation.conditionalWeight = availableRatio;
    addAflTradeCompensatedTerm(conditionalTotal, availableRatio);
  }
  const actualConditionalTotal = readAflTradeCompensatedValue(conditionalTotal);
  if (actualConditionalTotal <= 0 || !isAflTradeUnitProbabilityMass(actualConditionalTotal)) {
    throwStructuralNumericsError('INCONSISTENT_PROBABILITY_MASS');
  }
  for (const observation of observations) {
    observation.conditionalWeight = divideSubmass(
      observation.conditionalWeight!,
      actualConditionalTotal
    );
  }
}

function addScaledSquare(accumulator: ScaledSumOfSquares, value: number): void {
  const magnitude = Math.abs(requireFiniteDerivation(value));
  if (magnitude === 0) return;
  if (accumulator.scale < magnitude) {
    const ratio = accumulator.scale / magnitude;
    accumulator.sumSquares = requireFiniteDerivation(1 + accumulator.sumSquares * ratio * ratio);
    accumulator.scale = magnitude;
    return;
  }
  const ratio = magnitude / accumulator.scale;
  accumulator.sumSquares = requireFiniteDerivation(accumulator.sumSquares + ratio * ratio);
}

function readScaledSquareRoot(accumulator: ScaledSumOfSquares): number {
  if (accumulator.scale === 0) return 0;
  return requireFiniteDerivation(accumulator.scale * Math.sqrt(accumulator.sumSquares));
}

function calculateStatistics(
  observations: readonly AvailableMeasureObservation[],
  policy: AflTradeStructuralWeightedDistributionPolicy
): AflTradeStructuralWeightedDistributionStatistics {
  let minimum = observations[0]!.value;
  let maximum = minimum;
  let maximumAbsoluteValue = Math.abs(minimum);
  for (let index = 1; index < observations.length; index += 1) {
    const value = observations[index]!.value;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    maximumAbsoluteValue = Math.max(maximumAbsoluteValue, Math.abs(value));
  }

  let mean: number;
  let weightedPopulationStandardDeviation: number;
  if (minimum === maximum || maximumAbsoluteValue === 0) {
    mean = minimum;
    weightedPopulationStandardDeviation = 0;
  } else {
    const scaledMeanAccumulator = createAflTradeCompensatedAccumulator();
    let minimumScaledValue = 1;
    let maximumScaledValue = -1;
    for (const observation of observations) {
      const scaledValue = requireFiniteDerivation(observation.value / maximumAbsoluteValue);
      minimumScaledValue = Math.min(minimumScaledValue, scaledValue);
      maximumScaledValue = Math.max(maximumScaledValue, scaledValue);
      addAflTradeCompensatedTerm(
        scaledMeanAccumulator,
        requireFiniteDerivation(observation.conditionalWeight! * scaledValue)
      );
    }
    const scaledMean = clampFinite(
      readAflTradeCompensatedValue(scaledMeanAccumulator),
      minimumScaledValue,
      maximumScaledValue
    );
    mean = clampFinite(
      requireFiniteDerivation(scaledMean * maximumAbsoluteValue),
      minimum,
      maximum
    );

    const scaledSquares: ScaledSumOfSquares = { scale: 0, sumSquares: 1 };
    for (const observation of observations) {
      const scaledValue = requireFiniteDerivation(observation.value / maximumAbsoluteValue);
      const weightedDeviation = requireFiniteDerivation(
        Math.sqrt(observation.conditionalWeight!) * Math.abs(scaledValue - scaledMean)
      );
      addScaledSquare(scaledSquares, weightedDeviation);
    }
    const supportHalfRange = requireFiniteDerivation((maximumScaledValue - minimumScaledValue) / 2);
    const scaledDispersion = clampFinite(readScaledSquareRoot(scaledSquares), 0, supportHalfRange);
    weightedPopulationStandardDeviation = requireFiniteDerivation(
      scaledDispersion * maximumAbsoluteValue
    );
  }

  const { downside, median, upside } = calculateQuantiles(observations, policy);
  return Object.freeze({
    minimum: canonicalizeAflTradeZero(minimum),
    maximum: canonicalizeAflTradeZero(maximum),
    mean: canonicalizeAflTradeZero(mean),
    median,
    centralInterval: Object.freeze({ level: 0.8 as const, lower: downside, upper: upside }),
    downside: Object.freeze({ quantile: 0.1 as const, value: downside }),
    upside: Object.freeze({ quantile: 0.9 as const, value: upside }),
    empiricalDispersion: Object.freeze({
      definitionVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
      weightedPopulationStandardDeviation: canonicalizeAflTradeZero(
        weightedPopulationStandardDeviation
      ),
    }),
  });
}

function compareAvailableValues(
  left: AvailableMeasureObservation,
  right: AvailableMeasureObservation
): number {
  if (left.value < right.value) return -1;
  if (left.value > right.value) return 1;
  return compareAflTradeCodeUnits(left.drawKey, right.drawKey);
}

function calculateQuantiles(
  observations: readonly AvailableMeasureObservation[],
  policy: AflTradeStructuralWeightedDistributionPolicy
): { downside: number; median: number; upside: number } {
  const ordered = [...observations].sort(compareAvailableValues);
  const groups: QuantileGroup[] = [];
  let index = 0;
  while (index < ordered.length) {
    const value = ordered[index]!.value;
    const groupWeight = createAflTradeCompensatedAccumulator();
    do {
      addAflTradeCompensatedTerm(groupWeight, ordered[index]!.conditionalWeight!);
      index += 1;
    } while (index < ordered.length && ordered[index]!.value === value);
    groups.push({ value, probabilityMass: readAflTradeCompensatedValue(groupWeight) });
  }

  const groupedTotalAccumulator = createAflTradeCompensatedAccumulator();
  for (const group of groups) {
    addAflTradeCompensatedTerm(groupedTotalAccumulator, group.probabilityMass);
  }
  const groupedTotal = readAflTradeCompensatedValue(groupedTotalAccumulator);
  if (groupedTotal <= 0 || !isAflTradeUnitProbabilityMass(groupedTotal)) {
    throwStructuralNumericsError('INCONSISTENT_PROBABILITY_MASS');
  }

  const quantile = (probability: number): number => {
    const target = requireFiniteDerivation(probability * groupedTotal);
    const cumulative = createAflTradeCompensatedAccumulator();
    for (const group of groups) {
      addAflTradeCompensatedTerm(cumulative, group.probabilityMass);
      if (readAflTradeCompensatedValue(cumulative) >= target) {
        return canonicalizeAflTradeZero(group.value);
      }
    }
    throwStructuralNumericsError('INCONSISTENT_PROBABILITY_MASS');
  };

  return {
    downside: quantile(policy.quantiles.downside),
    median: quantile(policy.quantiles.median),
    upside: quantile(policy.quantiles.upside),
  };
}

function freezeEventProbabilities(
  lowReturnProbability: number,
  eliteOutcomeProbability: number
): AflTradeStructuralWeightedDistributionEventProbabilities {
  return Object.freeze({
    lowReturnProbability: canonicalizeAflTradeZero(lowReturnProbability),
    eliteOutcomeProbability: canonicalizeAflTradeZero(eliteOutcomeProbability),
  });
}

function freezeBounds(
  lowLower: number,
  lowUpper: number,
  eliteLower: number,
  eliteUpper: number
): AflTradeStructuralWeightedDistributionEventBounds {
  return Object.freeze({
    lowReturn: Object.freeze({
      lower: canonicalizeAflTradeZero(lowLower),
      upper: canonicalizeAflTradeZero(lowUpper),
    }),
    eliteOutcome: Object.freeze({
      lower: canonicalizeAflTradeZero(eliteLower),
      upper: canonicalizeAflTradeZero(eliteUpper),
    }),
  });
}

function calculateNumerics(
  observationSet: AflTradeStructuralWeightedDistributionObservationSet,
  policy: AflTradeStructuralWeightedDistributionPolicy
): AflTradeStructuralWeightedDistributionNumerics {
  validatePolicy(policy);
  validateObservationSet(observationSet);
  const measures = accumulateRawMeasures(observationSet.observations, policy);
  validateRawMeasures(measures);
  const drawCount = observationSet.observations.length;
  const reasonCodes = Object.freeze([...observationSet.reasonCodes]);

  if (observationSet.availableDrawCount === 0) {
    return Object.freeze({
      status: 'unavailable',
      inputProbabilityWeightTotal: measures.totalWeight,
      drawCount,
      availableDrawCount: 0,
      unavailableDrawCount: observationSet.unavailableDrawCount,
      availableProbabilityMass: 0,
      unavailableProbabilityMass: 1,
      statistics: null,
      eventProbabilities: null,
      conditionalOnAvailableScope: null,
      conditionalOnAvailableStatistics: null,
      conditionalOnAvailableEventProbabilities: null,
      unconditionalEventProbabilityBounds: freezeBounds(0, 1, 0, 1),
      reasonCodes,
    });
  }

  attachConditionalWeights(measures.availableObservations, measures.availableWeight);
  const statistics = calculateStatistics(measures.availableObservations, policy);
  if (observationSet.unavailableDrawCount === 0) {
    const lowReturnProbability = divideSubmass(measures.lowReturnWeight, measures.totalWeight);
    const eliteOutcomeProbability = divideSubmass(
      measures.eliteOutcomeWeight,
      measures.totalWeight
    );
    const eventProbabilities = freezeEventProbabilities(
      lowReturnProbability,
      eliteOutcomeProbability
    );
    return Object.freeze({
      status: 'complete',
      inputProbabilityWeightTotal: measures.totalWeight,
      drawCount,
      availableDrawCount: observationSet.availableDrawCount,
      unavailableDrawCount: 0,
      availableProbabilityMass: 1,
      unavailableProbabilityMass: 0,
      statistics,
      eventProbabilities,
      conditionalOnAvailableScope: null,
      conditionalOnAvailableStatistics: null,
      conditionalOnAvailableEventProbabilities: null,
      unconditionalEventProbabilityBounds: freezeBounds(
        lowReturnProbability,
        lowReturnProbability,
        eliteOutcomeProbability,
        eliteOutcomeProbability
      ),
      reasonCodes,
    });
  }

  const availableProbabilityMass = divideSubmass(measures.availableWeight, measures.totalWeight);
  const unavailableProbabilityMass = divideSubmass(
    measures.unavailableWeight,
    measures.totalWeight
  );
  const conditionalEvents = freezeEventProbabilities(
    divideSubmass(measures.lowReturnWeight, measures.availableWeight),
    divideSubmass(measures.eliteOutcomeWeight, measures.availableWeight)
  );
  const lowLower = divideSubmass(measures.lowReturnWeight, measures.totalWeight);
  const eliteLower = divideSubmass(measures.eliteOutcomeWeight, measures.totalWeight);
  const lowUpper = clampFinite(lowLower + unavailableProbabilityMass, lowLower, 1);
  const eliteUpper = clampFinite(eliteLower + unavailableProbabilityMass, eliteLower, 1);

  return Object.freeze({
    status: 'partial',
    inputProbabilityWeightTotal: measures.totalWeight,
    drawCount,
    availableDrawCount: observationSet.availableDrawCount,
    unavailableDrawCount: observationSet.unavailableDrawCount,
    availableProbabilityMass,
    unavailableProbabilityMass,
    statistics: null,
    eventProbabilities: null,
    conditionalOnAvailableScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
    conditionalOnAvailableStatistics: statistics,
    conditionalOnAvailableEventProbabilities: conditionalEvents,
    unconditionalEventProbabilityBounds: freezeBounds(lowLower, lowUpper, eliteLower, eliteUpper),
    reasonCodes,
  });
}

export function calculateAflTradeStructuralWeightedDistributionNumerics(
  observationSet: AflTradeStructuralWeightedDistributionObservationSet,
  policy: AflTradeStructuralWeightedDistributionPolicy
): AflTradeStructuralWeightedDistributionNumerics {
  try {
    return calculateNumerics(observationSet, policy);
  } catch (error) {
    if (isAflTradeStructuralWeightedDistributionError(error)) throw error;
    if (isAflTradeProbabilityMeasureError(error)) {
      if (error.code === 'INVALID_TOTAL_MASS') {
        throwStructuralNumericsError('INVALID_TOTAL_WEIGHT');
      }
      if (error.code === 'INVALID_PROBABILITY_MASS') {
        throwStructuralNumericsError('INCONSISTENT_PROBABILITY_MASS');
      }
      throwStructuralNumericsError('NON_FINITE_DERIVATION');
    }
    throwStructuralNumericsError('INTERNAL_RESULT_CONTRACT_VIOLATION');
  }
}
