import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
  aflTradeStructuralWeightedDistributionInputSchema,
  aflTradeStructuralWeightedDistributionSchema,
  type AflTradeStructuralWeightedDistribution,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import {
  AflTradeStructuralWeightedDistributionError,
  isAflTradeStructuralWeightedDistributionError,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionErrors';
import { calculateAflTradeStructuralWeightedDistributionNumerics } from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionNumerics';
import { materializeAflTradeStructuralWeightedDistributionObservationSet } from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionObservationSet';

const INPUT_KEYS = [
  'inputSchemaVersion',
  'publicAssetBoundary',
  'valueScope',
  'valueUnitId',
  'policy',
  'drawCount',
  'observations',
] as const;

type InputKey = (typeof INPUT_KEYS)[number];
type InputSnapshot = Record<InputKey, unknown>;

const INPUT_KEY_SET = new Set<string>(INPUT_KEYS);
const VALIDATION_PLACEHOLDER_OBSERVATIONS: readonly unknown[] = Object.freeze([]);

function createError(
  code: 'INVALID_INPUT_HEADER' | 'INTERNAL_RESULT_CONTRACT_VIOLATION'
): AflTradeStructuralWeightedDistributionError {
  return new AflTradeStructuralWeightedDistributionError({ code });
}

function snapshotInput(value: unknown): InputSnapshot | null {
  if (value === null || typeof value !== 'object') return null;

  try {
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== INPUT_KEYS.length ||
      ownKeys.some((key) => typeof key !== 'string' || !INPUT_KEY_SET.has(key))
    ) {
      return null;
    }

    const snapshot = {} as InputSnapshot;
    for (const key of INPUT_KEYS) snapshot[key] = Reflect.get(value, key, value);
    return snapshot;
  } catch {
    return null;
  }
}

function parseInputHeader(snapshot: InputSnapshot) {
  try {
    return aflTradeStructuralWeightedDistributionInputSchema.safeParse({
      inputSchemaVersion: snapshot.inputSchemaVersion,
      publicAssetBoundary: snapshot.publicAssetBoundary,
      valueScope: snapshot.valueScope,
      valueUnitId: snapshot.valueUnitId,
      policy: snapshot.policy,
      drawCount: snapshot.drawCount,
      observations: VALIDATION_PLACEHOLDER_OBSERVATIONS,
    });
  } catch {
    return null;
  }
}

function deepFreezeResult<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreezeResult(nested, seen);
  return Object.freeze(value);
}

export function calculateAflTradeStructuralWeightedDistribution(
  unparsedInput: unknown
): AflTradeStructuralWeightedDistribution {
  try {
    const snapshot = snapshotInput(unparsedInput);
    if (snapshot === null) throw createError('INVALID_INPUT_HEADER');

    const parsedHeader = parseInputHeader(snapshot);
    if (parsedHeader === null || !parsedHeader.success) {
      throw createError('INVALID_INPUT_HEADER');
    }

    const input = parsedHeader.data;
    const observationSet = materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: input.drawCount,
      observations: snapshot.observations,
    });
    const numerics = calculateAflTradeStructuralWeightedDistributionNumerics(
      observationSet,
      input.policy
    );
    const parsedResult = aflTradeStructuralWeightedDistributionSchema.safeParse({
      schemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
      inputSchemaVersion: input.inputSchemaVersion,
      publicAssetBoundary: input.publicAssetBoundary,
      valueScope: input.valueScope,
      valueUnitId: input.valueUnitId,
      policy: input.policy,
      ...numerics,
    });
    if (!parsedResult.success) {
      throw createError('INTERNAL_RESULT_CONTRACT_VIOLATION');
    }

    return deepFreezeResult(parsedResult.data);
  } catch (error) {
    if (isAflTradeStructuralWeightedDistributionError(error)) throw error;
    throw createError('INTERNAL_RESULT_CONTRACT_VIOLATION');
  }
}
