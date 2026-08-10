export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_ERROR_CODES = [
  'INVALID_INPUT_HEADER',
  'OBSERVATION_SOURCE_FAILURE',
  'OBSERVATION_COUNT_MISMATCH',
  'INVALID_OBSERVATION',
  'DUPLICATE_DRAW_KEY',
  'REASON_CODE_LIMIT_EXCEEDED',
  'INVALID_TOTAL_WEIGHT',
  'INCONSISTENT_PROBABILITY_MASS',
  'NON_FINITE_DERIVATION',
  'INTERNAL_RESULT_CONTRACT_VIOLATION',
] as const;

export type AflTradeStructuralWeightedDistributionErrorCode =
  (typeof AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_ERROR_CODES)[number];

export const AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SOURCE_FAILURE_STAGES = [
  'acquisition',
  'protocol',
  'advancement',
] as const;

export type AflTradeStructuralWeightedDistributionSourceFailureStage =
  (typeof AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SOURCE_FAILURE_STAGES)[number];

type IndexedErrorCode =
  | 'OBSERVATION_COUNT_MISMATCH'
  | 'INVALID_OBSERVATION'
  | 'DUPLICATE_DRAW_KEY'
  | 'REASON_CODE_LIMIT_EXCEEDED';

type NonIndexedErrorCode = Exclude<
  AflTradeStructuralWeightedDistributionErrorCode,
  IndexedErrorCode | 'OBSERVATION_SOURCE_FAILURE'
>;

interface IteratorCloseFailureMetadata {
  iteratorCloseFailed?: boolean;
}

export type AflTradeStructuralWeightedDistributionErrorDescriptor =
  | ({
      code: 'OBSERVATION_SOURCE_FAILURE';
      sourceFailureStage: AflTradeStructuralWeightedDistributionSourceFailureStage;
      observationIndex?: number;
    } & IteratorCloseFailureMetadata)
  | ({
      code: IndexedErrorCode;
      observationIndex: number;
    } & IteratorCloseFailureMetadata)
  | {
      code: NonIndexedErrorCode;
    };

export interface AflTradeSerializedStructuralWeightedDistributionError {
  name: 'AflTradeStructuralWeightedDistributionError';
  code: AflTradeStructuralWeightedDistributionErrorCode;
  message: string;
  sourceFailureStage: AflTradeStructuralWeightedDistributionSourceFailureStage | null;
  observationIndex: number | null;
  iteratorCloseFailed: boolean;
}

const ERROR_MESSAGES = {
  INVALID_INPUT_HEADER: 'The structural weighted-distribution input header is invalid.',
  OBSERVATION_SOURCE_FAILURE:
    'The structural weighted-distribution observation source could not be consumed.',
  OBSERVATION_COUNT_MISMATCH:
    'The observation source cardinality does not match the declared draw count.',
  INVALID_OBSERVATION: 'A structural weighted-distribution observation is invalid.',
  DUPLICATE_DRAW_KEY: 'The structural weighted-distribution contains a duplicate draw key.',
  REASON_CODE_LIMIT_EXCEEDED:
    'The structural weighted-distribution unavailable-reason limit was exceeded.',
  INVALID_TOTAL_WEIGHT:
    'The compensated structural weighted-distribution probability-weight total is invalid.',
  INCONSISTENT_PROBABILITY_MASS:
    'Derived structural weighted-distribution probability masses are inconsistent.',
  NON_FINITE_DERIVATION:
    'Structural weighted-distribution arithmetic produced a non-finite result.',
  INTERNAL_RESULT_CONTRACT_VIOLATION:
    'The structural weighted-distribution result violated its internal contract.',
} as const satisfies Record<AflTradeStructuralWeightedDistributionErrorCode, string>;

interface NormalizedErrorDescriptor {
  code: AflTradeStructuralWeightedDistributionErrorCode;
  sourceFailureStage: AflTradeStructuralWeightedDistributionSourceFailureStage | null;
  observationIndex: number | null;
  iteratorCloseFailed: boolean;
}

function normalizeObservationIndex(observationIndex: number | undefined): number | null {
  if (observationIndex === undefined) return null;
  if (!Number.isSafeInteger(observationIndex) || observationIndex < 0) {
    throw new TypeError(
      'A structural weighted-distribution error observation index must be a nonnegative safe integer.'
    );
  }
  return observationIndex;
}

function normalizeErrorDescriptor(
  descriptor: AflTradeStructuralWeightedDistributionErrorDescriptor
): NormalizedErrorDescriptor {
  const sourceFailureStage =
    descriptor.code === 'OBSERVATION_SOURCE_FAILURE' ? descriptor.sourceFailureStage : null;
  const observationIndex =
    'observationIndex' in descriptor
      ? normalizeObservationIndex(descriptor.observationIndex)
      : null;
  const iteratorCloseFailed =
    'iteratorCloseFailed' in descriptor ? descriptor.iteratorCloseFailed === true : false;

  return {
    code: descriptor.code,
    sourceFailureStage,
    observationIndex,
    iteratorCloseFailed,
  };
}

const TRUSTED_STRUCTURAL_WEIGHTED_DISTRIBUTION_ERRORS = new WeakSet<object>();

export class AflTradeStructuralWeightedDistributionError extends Error {
  readonly code: AflTradeStructuralWeightedDistributionErrorCode;
  readonly sourceFailureStage: AflTradeStructuralWeightedDistributionSourceFailureStage | null;
  readonly observationIndex: number | null;
  readonly iteratorCloseFailed: boolean;

  constructor(descriptor: AflTradeStructuralWeightedDistributionErrorDescriptor) {
    const normalized = normalizeErrorDescriptor(descriptor);
    super(ERROR_MESSAGES[normalized.code]);
    this.name = 'AflTradeStructuralWeightedDistributionError';
    this.code = normalized.code;
    this.sourceFailureStage = normalized.sourceFailureStage;
    this.observationIndex = normalized.observationIndex;
    this.iteratorCloseFailed = normalized.iteratorCloseFailed;
    TRUSTED_STRUCTURAL_WEIGHTED_DISTRIBUTION_ERRORS.add(this);
  }

  toJSON(): AflTradeSerializedStructuralWeightedDistributionError {
    return {
      name: 'AflTradeStructuralWeightedDistributionError',
      code: this.code,
      message: this.message,
      sourceFailureStage: this.sourceFailureStage,
      observationIndex: this.observationIndex,
      iteratorCloseFailed: this.iteratorCloseFailed,
    };
  }
}

export function isAflTradeStructuralWeightedDistributionError(
  value: unknown
): value is AflTradeStructuralWeightedDistributionError {
  return (
    value !== null &&
    typeof value === 'object' &&
    TRUSTED_STRUCTURAL_WEIGHTED_DISTRIBUTION_ERRORS.has(value)
  );
}
