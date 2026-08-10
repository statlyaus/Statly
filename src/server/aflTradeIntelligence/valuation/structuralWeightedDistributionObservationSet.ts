import {
  canonicalizeAflTradeZero,
  compareAflTradeCodeUnits,
} from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MIN_DRAW_COUNT,
  aflTradeStructuralWeightedDistributionObservationSchema,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import {
  AflTradeStructuralWeightedDistributionError,
  isAflTradeStructuralWeightedDistributionError,
  type AflTradeStructuralWeightedDistributionErrorDescriptor,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionErrors';

export type AflTradeCanonicalStructuralWeightedDistributionObservation =
  | Readonly<{
      drawKey: string;
      probabilityWeight: number;
      status: 'available';
      value: number;
    }>
  | Readonly<{
      drawKey: string;
      probabilityWeight: number;
      status: 'unavailable';
    }>;

export interface AflTradeStructuralWeightedDistributionObservationSet {
  readonly observations: readonly AflTradeCanonicalStructuralWeightedDistributionObservation[];
  readonly availableDrawCount: number;
  readonly unavailableDrawCount: number;
  readonly reasonCodes: readonly string[];
}

export interface MaterializeAflTradeStructuralWeightedDistributionObservationSetInput {
  drawCount: number;
  observations: unknown;
}

type EcmaScriptObject = object | ((...args: unknown[]) => unknown);
type Callable = (...args: never[]) => unknown;

interface IteratorRecord {
  iterator: EcmaScriptObject;
  next: Callable;
}

type CloseableObservationSetErrorDescriptor = Extract<
  AflTradeStructuralWeightedDistributionErrorDescriptor,
  {
    code:
      | 'OBSERVATION_SOURCE_FAILURE'
      | 'OBSERVATION_COUNT_MISMATCH'
      | 'INVALID_OBSERVATION'
      | 'DUPLICATE_DRAW_KEY'
      | 'REASON_CODE_LIMIT_EXCEEDED';
  }
>;

interface IteratorAdvancementDone {
  done: true;
}

interface IteratorAdvancementValue {
  done: false;
  value: unknown;
}

type IteratorAdvancement = IteratorAdvancementDone | IteratorAdvancementValue;

const AVAILABLE_OBSERVATION_KEYS = new Set(['drawKey', 'probabilityWeight', 'status', 'value']);
const UNAVAILABLE_OBSERVATION_KEYS = new Set([
  'drawKey',
  'probabilityWeight',
  'reasonCodes',
  'status',
]);

function isEcmaScriptObject(value: unknown): value is EcmaScriptObject {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function validateDrawCount(drawCount: number): void {
  if (
    !Number.isInteger(drawCount) ||
    drawCount < AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MIN_DRAW_COUNT ||
    drawCount > AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT
  ) {
    throw new AflTradeStructuralWeightedDistributionError({ code: 'INVALID_INPUT_HEADER' });
  }
}

function attemptAbnormalIteratorClose(iterator: EcmaScriptObject): boolean {
  let returnMethod: unknown;
  try {
    returnMethod = Reflect.get(iterator, 'return');
  } catch {
    return true;
  }

  if (returnMethod === null || returnMethod === undefined) return false;
  if (typeof returnMethod !== 'function') return true;

  try {
    Reflect.apply(returnMethod, iterator, []);
    return false;
  } catch {
    return true;
  }
}

function throwObservationSetError(
  descriptor: CloseableObservationSetErrorDescriptor,
  iteratorRecord: IteratorRecord | null,
  closeIterator: boolean
): never {
  const iteratorCloseFailed =
    iteratorRecord !== null && closeIterator
      ? attemptAbnormalIteratorClose(iteratorRecord.iterator)
      : false;
  throw new AflTradeStructuralWeightedDistributionError({
    ...descriptor,
    iteratorCloseFailed,
  });
}

function acquireIteratorRecord(observations: unknown): IteratorRecord {
  if (!isEcmaScriptObject(observations)) {
    throw new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'protocol',
    });
  }

  let iteratorFactory: unknown;
  try {
    iteratorFactory = Reflect.get(observations, Symbol.iterator);
  } catch {
    throw new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'acquisition',
    });
  }
  if (typeof iteratorFactory !== 'function') {
    throw new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'protocol',
    });
  }

  let iterator: unknown;
  try {
    iterator = Reflect.apply(iteratorFactory, observations, []);
  } catch {
    throw new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'acquisition',
    });
  }
  if (!isEcmaScriptObject(iterator)) {
    throw new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'protocol',
    });
  }

  let nextMethod: unknown;
  try {
    nextMethod = Reflect.get(iterator, 'next');
  } catch {
    throw new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'acquisition',
    });
  }
  if (typeof nextMethod !== 'function') {
    throw new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'protocol',
    });
  }

  return { iterator, next: nextMethod as Callable };
}

function advanceIterator(
  iteratorRecord: IteratorRecord,
  observationIndex: number,
  readValue: boolean
): IteratorAdvancement {
  let result: unknown;
  try {
    result = Reflect.apply(iteratorRecord.next, iteratorRecord.iterator, []);
  } catch {
    throwObservationSetError(
      {
        code: 'OBSERVATION_SOURCE_FAILURE',
        sourceFailureStage: 'advancement',
        observationIndex,
      },
      iteratorRecord,
      true
    );
  }

  if (!isEcmaScriptObject(result)) {
    throwObservationSetError(
      {
        code: 'OBSERVATION_SOURCE_FAILURE',
        sourceFailureStage: 'protocol',
        observationIndex,
      },
      iteratorRecord,
      true
    );
  }

  let doneValue: unknown;
  try {
    doneValue = Reflect.get(result, 'done');
  } catch {
    throwObservationSetError(
      {
        code: 'OBSERVATION_SOURCE_FAILURE',
        sourceFailureStage: 'advancement',
        observationIndex,
      },
      iteratorRecord,
      true
    );
  }
  if (doneValue) return { done: true };
  if (!readValue) return { done: false, value: undefined };

  let value: unknown;
  try {
    value = Reflect.get(result, 'value');
  } catch {
    throwObservationSetError(
      {
        code: 'OBSERVATION_SOURCE_FAILURE',
        sourceFailureStage: 'advancement',
        observationIndex,
      },
      iteratorRecord,
      true
    );
  }
  return { done: false, value };
}

function hasOnlyAllowedEnumerableKeys(
  value: EcmaScriptObject,
  allowedKeys: ReadonlySet<string>
): boolean {
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return false;
  }
  return keys.every((key) => allowedKeys.has(key));
}

function readObservationProperty(
  value: EcmaScriptObject,
  propertyKey: PropertyKey,
  iteratorRecord: IteratorRecord,
  observationIndex: number
): unknown {
  try {
    return Reflect.get(value, propertyKey);
  } catch {
    throwObservationSetError(
      { code: 'INVALID_OBSERVATION', observationIndex },
      iteratorRecord,
      true
    );
  }
}

function snapshotReasonCodes(
  reasonCodes: unknown,
  iteratorRecord: IteratorRecord,
  observationIndex: number
): unknown[] {
  if (!Array.isArray(reasonCodes)) {
    throwObservationSetError(
      { code: 'INVALID_OBSERVATION', observationIndex },
      iteratorRecord,
      true
    );
  }

  let length: number;
  try {
    length = reasonCodes.length;
  } catch {
    throwObservationSetError(
      { code: 'INVALID_OBSERVATION', observationIndex },
      iteratorRecord,
      true
    );
  }
  if (length > AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES) {
    throwObservationSetError(
      { code: 'INVALID_OBSERVATION', observationIndex },
      iteratorRecord,
      true
    );
  }

  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    try {
      snapshot[index] = Reflect.get(reasonCodes, index);
    } catch {
      throwObservationSetError(
        { code: 'INVALID_OBSERVATION', observationIndex },
        iteratorRecord,
        true
      );
    }
  }
  return snapshot;
}

function createBoundedObservationSnapshot(
  value: unknown,
  iteratorRecord: IteratorRecord,
  observationIndex: number
): unknown {
  if (!isEcmaScriptObject(value)) return value;

  const status = readObservationProperty(value, 'status', iteratorRecord, observationIndex);
  if (status === 'available') {
    if (!hasOnlyAllowedEnumerableKeys(value, AVAILABLE_OBSERVATION_KEYS)) {
      throwObservationSetError(
        { code: 'INVALID_OBSERVATION', observationIndex },
        iteratorRecord,
        true
      );
    }
    return {
      drawKey: readObservationProperty(value, 'drawKey', iteratorRecord, observationIndex),
      probabilityWeight: readObservationProperty(
        value,
        'probabilityWeight',
        iteratorRecord,
        observationIndex
      ),
      status,
      value: readObservationProperty(value, 'value', iteratorRecord, observationIndex),
    };
  }
  if (status === 'unavailable') {
    if (!hasOnlyAllowedEnumerableKeys(value, UNAVAILABLE_OBSERVATION_KEYS)) {
      throwObservationSetError(
        { code: 'INVALID_OBSERVATION', observationIndex },
        iteratorRecord,
        true
      );
    }
    const reasonCodes = readObservationProperty(
      value,
      'reasonCodes',
      iteratorRecord,
      observationIndex
    );
    return {
      drawKey: readObservationProperty(value, 'drawKey', iteratorRecord, observationIndex),
      probabilityWeight: readObservationProperty(
        value,
        'probabilityWeight',
        iteratorRecord,
        observationIndex
      ),
      reasonCodes: snapshotReasonCodes(reasonCodes, iteratorRecord, observationIndex),
      status,
    };
  }
  return { status };
}

function parseObservation(
  value: unknown,
  iteratorRecord: IteratorRecord,
  observationIndex: number
) {
  let snapshot: unknown;
  try {
    snapshot = createBoundedObservationSnapshot(value, iteratorRecord, observationIndex);
  } catch (error) {
    if (isAflTradeStructuralWeightedDistributionError(error)) throw error;
    throwObservationSetError(
      { code: 'INVALID_OBSERVATION', observationIndex },
      iteratorRecord,
      true
    );
  }

  let parsed: ReturnType<typeof aflTradeStructuralWeightedDistributionObservationSchema.safeParse>;
  try {
    parsed = aflTradeStructuralWeightedDistributionObservationSchema.safeParse(snapshot);
  } catch {
    throwObservationSetError(
      { code: 'INVALID_OBSERVATION', observationIndex },
      iteratorRecord,
      true
    );
  }
  if (!parsed.success) {
    throwObservationSetError(
      { code: 'INVALID_OBSERVATION', observationIndex },
      iteratorRecord,
      true
    );
  }
  return parsed.data;
}

export function materializeAflTradeStructuralWeightedDistributionObservationSet({
  drawCount,
  observations,
}: MaterializeAflTradeStructuralWeightedDistributionObservationSetInput): AflTradeStructuralWeightedDistributionObservationSet {
  validateDrawCount(drawCount);
  const iteratorRecord = acquireIteratorRecord(observations);
  const records: AflTradeCanonicalStructuralWeightedDistributionObservation[] = [];
  const seenDrawKeys = new Set<string>();
  const reasonCodeUnion = new Set<string>();
  let availableDrawCount = 0;
  let unavailableDrawCount = 0;

  for (let observationIndex = 0; observationIndex < drawCount; observationIndex += 1) {
    const advancement = advanceIterator(iteratorRecord, observationIndex, true);
    if (advancement.done) {
      throwObservationSetError(
        { code: 'OBSERVATION_COUNT_MISMATCH', observationIndex },
        iteratorRecord,
        false
      );
    }
    const parsed = parseObservation(advancement.value, iteratorRecord, observationIndex);

    if (seenDrawKeys.has(parsed.drawKey)) {
      throwObservationSetError(
        { code: 'DUPLICATE_DRAW_KEY', observationIndex },
        iteratorRecord,
        true
      );
    }
    seenDrawKeys.add(parsed.drawKey);

    if (parsed.status === 'available') {
      records.push({
        drawKey: parsed.drawKey,
        probabilityWeight: parsed.probabilityWeight,
        status: 'available',
        value: canonicalizeAflTradeZero(parsed.value),
      });
      availableDrawCount += 1;
      continue;
    }

    for (const reasonCode of parsed.reasonCodes) {
      reasonCodeUnion.add(reasonCode);
      if (reasonCodeUnion.size > AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES) {
        throwObservationSetError(
          { code: 'REASON_CODE_LIMIT_EXCEEDED', observationIndex },
          iteratorRecord,
          true
        );
      }
    }
    records.push({
      drawKey: parsed.drawKey,
      probabilityWeight: parsed.probabilityWeight,
      status: 'unavailable',
    });
    unavailableDrawCount += 1;
  }

  const lookahead = advanceIterator(iteratorRecord, drawCount, false);
  if (!lookahead.done) {
    throwObservationSetError(
      { code: 'OBSERVATION_COUNT_MISMATCH', observationIndex: drawCount },
      iteratorRecord,
      true
    );
  }

  records.sort((left, right) => compareAflTradeCodeUnits(left.drawKey, right.drawKey));
  const reasonCodes = [...reasonCodeUnion].sort(compareAflTradeCodeUnits);

  return {
    observations: records,
    availableDrawCount,
    unavailableDrawCount,
    reasonCodes,
  };
}
