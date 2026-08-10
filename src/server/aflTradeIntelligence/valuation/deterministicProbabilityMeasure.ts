export const AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION =
  'binary64_code_unit_ordered_neumaier_actual_total_normalization_v1' as const;
export const AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE = 1e-8;

export const AFL_TRADE_PROBABILITY_MEASURE_ERROR_CODES = [
  'NON_FINITE_TERM',
  'NON_FINITE_DERIVATION',
  'INVALID_TOTAL_MASS',
  'INVALID_PROBABILITY_MASS',
] as const;

export type AflTradeProbabilityMeasureErrorCode =
  (typeof AFL_TRADE_PROBABILITY_MEASURE_ERROR_CODES)[number];

const TRUSTED_PROBABILITY_MEASURE_ERRORS = new WeakSet<object>();

export class AflTradeProbabilityMeasureError extends Error {
  constructor(
    public readonly code: AflTradeProbabilityMeasureErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AflTradeProbabilityMeasureError';
    TRUSTED_PROBABILITY_MEASURE_ERRORS.add(this);
  }
}

export function isAflTradeProbabilityMeasureError(
  value: unknown
): value is AflTradeProbabilityMeasureError {
  return (
    value !== null && typeof value === 'object' && TRUSTED_PROBABILITY_MEASURE_ERRORS.has(value)
  );
}

export interface AflTradeCompensatedAccumulator {
  sum: number;
  correction: number;
}

export function compareAflTradeCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeAflTradeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function requireFiniteTerm(value: number): number {
  if (!Number.isFinite(value)) {
    throw new AflTradeProbabilityMeasureError(
      'NON_FINITE_TERM',
      'A deterministic probability-measure term must be finite.'
    );
  }
  return canonicalizeAflTradeZero(value);
}

function requireFiniteDerivation(value: number): number {
  if (!Number.isFinite(value)) {
    throw new AflTradeProbabilityMeasureError(
      'NON_FINITE_DERIVATION',
      'Deterministic probability-measure arithmetic produced a non-finite result.'
    );
  }
  return canonicalizeAflTradeZero(value);
}

export function createAflTradeCompensatedAccumulator(): AflTradeCompensatedAccumulator {
  return { sum: 0, correction: 0 };
}

export function addAflTradeCompensatedTerm(
  accumulator: AflTradeCompensatedAccumulator,
  unparsedValue: number
): void {
  const value = requireFiniteTerm(unparsedValue);
  const next = requireFiniteDerivation(accumulator.sum + value);
  const correctionTerm =
    Math.abs(accumulator.sum) >= Math.abs(value)
      ? accumulator.sum - next + value
      : value - next + accumulator.sum;
  accumulator.correction = requireFiniteDerivation(accumulator.correction + correctionTerm);
  accumulator.sum = next;
}

export function readAflTradeCompensatedValue(
  accumulator: Readonly<AflTradeCompensatedAccumulator>
): number {
  return requireFiniteDerivation(accumulator.sum + accumulator.correction);
}

export function sumAflTradeFiniteNumbers(values: Iterable<number>): number {
  const accumulator = createAflTradeCompensatedAccumulator();
  for (const value of values) addAflTradeCompensatedTerm(accumulator, value);
  return readAflTradeCompensatedValue(accumulator);
}

export function doAflTradeProbabilityMassesReconcile(left: number, right: number): boolean {
  const finiteLeft = requireFiniteTerm(left);
  const finiteRight = requireFiniteTerm(right);
  const difference = requireFiniteDerivation(finiteLeft - finiteRight);
  return Math.abs(difference) <= AFL_TRADE_UNIT_PROBABILITY_MASS_TOLERANCE;
}

export function isAflTradeUnitProbabilityMass(totalMass: number): boolean {
  return doAflTradeProbabilityMassesReconcile(totalMass, 1);
}

export function requireAflTradeUnitProbabilityMass(totalMass: number): number {
  const finiteTotal = requireFiniteTerm(totalMass);
  if (finiteTotal <= 0 || !isAflTradeUnitProbabilityMass(finiteTotal)) {
    throw new AflTradeProbabilityMeasureError(
      'INVALID_TOTAL_MASS',
      'Total probability mass must be positive and within the governed tolerance of one.'
    );
  }
  return finiteTotal;
}

export function normalizeAflTradeProbabilityMass(mass: number, totalMass: number): number {
  const finiteMass = requireFiniteTerm(mass);
  const acceptedTotal = requireAflTradeUnitProbabilityMass(totalMass);
  if (
    finiteMass < 0 ||
    (finiteMass > acceptedTotal && !doAflTradeProbabilityMassesReconcile(finiteMass, acceptedTotal))
  ) {
    throw new AflTradeProbabilityMeasureError(
      'INVALID_PROBABILITY_MASS',
      'A probability sub-mass must lie between zero and its accepted total mass.'
    );
  }

  const normalized = requireFiniteDerivation(finiteMass / acceptedTotal);
  return canonicalizeAflTradeZero(Math.min(1, Math.max(0, normalized)));
}
