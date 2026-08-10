// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES,
  aflTradeStructuralWeightedDistributionObservationSchema,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_ERROR_CODES,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SOURCE_FAILURE_STAGES,
  AflTradeStructuralWeightedDistributionError,
  isAflTradeStructuralWeightedDistributionError,
  type AflTradeStructuralWeightedDistributionErrorDescriptor,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionErrors';
import { materializeAflTradeStructuralWeightedDistributionObservationSet } from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionObservationSet';

function availableObservation(
  drawKey: string,
  probabilityWeight = 1,
  value = 5
): Record<string, unknown> {
  return { drawKey, probabilityWeight, status: 'available', value };
}

function unavailableObservation(
  drawKey: string,
  reasonCodes: unknown = ['source-missing'],
  probabilityWeight = 1
): Record<string, unknown> {
  return { drawKey, probabilityWeight, reasonCodes, status: 'unavailable' };
}

function captureStructuralError(run: () => unknown): AflTradeStructuralWeightedDistributionError {
  try {
    run();
  } catch (error) {
    expect(isAflTradeStructuralWeightedDistributionError(error)).toBe(true);
    return error as AflTradeStructuralWeightedDistributionError;
  }
  throw new Error('Expected a structural weighted-distribution error.');
}

type ReturnBehavior =
  'absent' | 'success' | 'getter_throw' | 'noncallable' | 'call_throw' | 'primitive_result';

interface InstrumentedIterableOptions {
  iteratorFactoryThrows?: boolean;
  primitiveIterator?: boolean;
  nextGetterThrows?: boolean;
  nonCallableNext?: boolean;
  nextThrowsAt?: number;
  primitiveResultAt?: number;
  functionResultAt?: number;
  doneThrowsAt?: number;
  valueThrowsAt?: number;
  infiniteValue?: unknown;
  infiniteValueFactory?: (callIndex: number) => unknown;
  returnBehavior?: ReturnBehavior;
}

interface IteratorCounters {
  iteratorGetterCalls: number;
  iteratorFactoryCalls: number;
  nextGetterCalls: number;
  nextCalls: number;
  doneReads: number;
  valueReads: number;
  returnGetterCalls: number;
  returnCalls: number;
  iteratorFactoryReceiver: unknown;
  nextReceivers: unknown[];
  returnReceiver: unknown;
}

interface InstrumentedIterable {
  source: object;
  iterator: object;
  counters: IteratorCounters;
}

function createInstrumentedIterable(
  values: readonly unknown[],
  options: InstrumentedIterableOptions = {}
): InstrumentedIterable {
  const counters: IteratorCounters = {
    iteratorGetterCalls: 0,
    iteratorFactoryCalls: 0,
    nextGetterCalls: 0,
    nextCalls: 0,
    doneReads: 0,
    valueReads: 0,
    returnGetterCalls: 0,
    returnCalls: 0,
    iteratorFactoryReceiver: null,
    nextReceivers: [],
    returnReceiver: null,
  };
  let position = 0;

  function iteratorResult(done: boolean, value: unknown, callIndex: number): object {
    const result =
      options.functionResultAt === callIndex ? function iteratorResultFunction() {} : {};
    Object.defineProperties(result, {
      done: {
        configurable: true,
        enumerable: true,
        get() {
          counters.doneReads += 1;
          if (options.doneThrowsAt === callIndex) throw new Error('hostile-done-secret');
          return done;
        },
      },
      value: {
        configurable: true,
        enumerable: true,
        get() {
          counters.valueReads += 1;
          if (options.valueThrowsAt === callIndex) throw new Error('hostile-value-secret');
          return value;
        },
      },
    });
    return result;
  }

  const iterator = {
    get next(): unknown {
      counters.nextGetterCalls += 1;
      if (options.nextGetterThrows) throw new Error('hostile-next-getter-secret');
      if (options.nonCallableNext) return 7;
      return function next(this: unknown) {
        counters.nextReceivers.push(this);
        const callIndex = counters.nextCalls;
        counters.nextCalls += 1;
        if (options.nextThrowsAt === callIndex) throw new Error('hostile-next-secret');
        if (options.primitiveResultAt === callIndex) return 5;
        if (position < values.length) {
          const value = values[position];
          position += 1;
          return iteratorResult(false, value, callIndex);
        }
        if (options.infiniteValue !== undefined) {
          return iteratorResult(false, options.infiniteValue, callIndex);
        }
        if (options.infiniteValueFactory !== undefined) {
          return iteratorResult(false, options.infiniteValueFactory(callIndex), callIndex);
        }
        return iteratorResult(true, undefined, callIndex);
      };
    },
    get return(): unknown {
      counters.returnGetterCalls += 1;
      const behavior = options.returnBehavior ?? 'success';
      if (behavior === 'getter_throw') throw new Error('hostile-return-getter-secret');
      if (behavior === 'absent') return undefined;
      if (behavior === 'noncallable') return 9;
      return function close(this: unknown) {
        counters.returnReceiver = this;
        counters.returnCalls += 1;
        if (behavior === 'call_throw') throw new Error('hostile-return-call-secret');
        if (behavior === 'primitive_result') return 3;
        return {};
      };
    },
  };

  const source = {
    get [Symbol.iterator](): unknown {
      counters.iteratorGetterCalls += 1;
      return function iteratorFactory(this: unknown) {
        counters.iteratorFactoryReceiver = this;
        counters.iteratorFactoryCalls += 1;
        if (options.iteratorFactoryThrows) throw new Error('hostile-factory-secret');
        if (options.primitiveIterator) return 4;
        return iterator;
      };
    },
  };

  return { source, iterator, counters };
}

const ERROR_CASES: readonly [AflTradeStructuralWeightedDistributionErrorDescriptor, string][] = [
  [
    { code: 'INVALID_INPUT_HEADER' },
    'The structural weighted-distribution input header is invalid.',
  ],
  [
    { code: 'OBSERVATION_SOURCE_FAILURE', sourceFailureStage: 'acquisition' },
    'The structural weighted-distribution observation source could not be consumed.',
  ],
  [
    { code: 'OBSERVATION_COUNT_MISMATCH', observationIndex: 0 },
    'The observation source cardinality does not match the declared draw count.',
  ],
  [
    { code: 'INVALID_OBSERVATION', observationIndex: 0 },
    'A structural weighted-distribution observation is invalid.',
  ],
  [
    { code: 'DUPLICATE_DRAW_KEY', observationIndex: 1 },
    'The structural weighted-distribution contains a duplicate draw key.',
  ],
  [
    { code: 'REASON_CODE_LIMIT_EXCEEDED', observationIndex: 1 },
    'The structural weighted-distribution unavailable-reason limit was exceeded.',
  ],
  [
    { code: 'INVALID_TOTAL_WEIGHT' },
    'The compensated structural weighted-distribution probability-weight total is invalid.',
  ],
  [
    { code: 'INCONSISTENT_PROBABILITY_MASS' },
    'Derived structural weighted-distribution probability masses are inconsistent.',
  ],
  [
    { code: 'NON_FINITE_DERIVATION' },
    'Structural weighted-distribution arithmetic produced a non-finite result.',
  ],
  [
    { code: 'INTERNAL_RESULT_CONTRACT_VIOLATION' },
    'The structural weighted-distribution result violated its internal contract.',
  ],
];

describe('AFL trade structural weighted-distribution sanitized errors', () => {
  it('freezes the public error codes and source-failure stages', () => {
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_ERROR_CODES).toEqual([
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
    ]);
    expect(AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SOURCE_FAILURE_STAGES).toEqual([
      'acquisition',
      'protocol',
      'advancement',
    ]);
  });

  it.each(ERROR_CASES)('serializes fixed sanitized metadata for $0.code', (descriptor, message) => {
    const error = new AflTradeStructuralWeightedDistributionError(descriptor);
    const serialized = JSON.parse(JSON.stringify(error));

    expect(error).toBeInstanceOf(Error);
    expect(isAflTradeStructuralWeightedDistributionError(error)).toBe(true);
    expect(error.message).toBe(message);
    expect(serialized).toEqual({
      name: 'AflTradeStructuralWeightedDistributionError',
      code: descriptor.code,
      message,
      sourceFailureStage:
        descriptor.code === 'OBSERVATION_SOURCE_FAILURE' ? descriptor.sourceFailureStage : null,
      observationIndex: 'observationIndex' in descriptor ? descriptor.observationIndex : null,
      iteratorCloseFailed:
        'iteratorCloseFailed' in descriptor ? descriptor.iteratorCloseFailed === true : false,
    });
    expect('cause' in error).toBe(false);
    expect(JSON.stringify(error)).not.toContain('ownership');
    expect(JSON.stringify(error)).not.toContain('fantasy');
  });

  it('retains only safe source metadata and recognizes unrelated values', () => {
    const error = new AflTradeStructuralWeightedDistributionError({
      code: 'OBSERVATION_SOURCE_FAILURE',
      sourceFailureStage: 'advancement',
      observationIndex: 4,
      iteratorCloseFailed: true,
    });
    expect(error.sourceFailureStage).toBe('advancement');
    expect(error.observationIndex).toBe(4);
    expect(error.iteratorCloseFailed).toBe(true);
    expect(isAflTradeStructuralWeightedDistributionError(new Error('ordinary'))).toBe(false);
    expect(isAflTradeStructuralWeightedDistributionError(null)).toBe(false);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid observation index %s',
    (observationIndex) => {
      expect(
        () =>
          new AflTradeStructuralWeightedDistributionError({
            code: 'INVALID_OBSERVATION',
            observationIndex,
          })
      ).toThrow(TypeError);
    }
  );
});

describe('AFL trade structural weighted-distribution observation materialization', () => {
  it('canonicalizes order, identifiers, reasons, counts, and signed zero', () => {
    const result = materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: 3,
      observations: [
        unavailableObservation(' draw-c ', ['reason-a'], 0.2),
        availableObservation('draw-b', 0.3, -0),
        unavailableObservation('draw-A', ['reason-Z'], 0.5),
      ],
    });

    expect(result).toEqual({
      observations: [
        { drawKey: 'draw-A', probabilityWeight: 0.5, status: 'unavailable' },
        { drawKey: 'draw-b', probabilityWeight: 0.3, status: 'available', value: 0 },
        { drawKey: 'draw-c', probabilityWeight: 0.2, status: 'unavailable' },
      ],
      availableDrawCount: 1,
      unavailableDrawCount: 2,
      reasonCodes: ['reason-Z', 'reason-a'],
    });
    const available = result.observations.find((observation) => observation.status === 'available');
    expect(available?.status).toBe('available');
    if (available?.status === 'available') expect(Object.is(available.value, -0)).toBe(false);
  });

  it('does not retain or mutate caller-owned objects or arrays', () => {
    const reasons = Object.freeze(['source-missing']);
    const sourceObservation = Object.freeze(unavailableObservation('draw-a', reasons));
    const observations = Object.freeze([sourceObservation]);
    const before = structuredClone(sourceObservation);

    const result = materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: 1,
      observations,
    });

    expect(sourceObservation).toEqual(before);
    expect(result.observations[0]).not.toBe(sourceObservation);
    expect(result.reasonCodes).not.toBe(reasons);
    expect(result.observations[0]).not.toHaveProperty('reasonCodes');
  });

  it('produces identical sets for every source permutation', () => {
    const observations = [
      availableObservation('draw-c', 0.2, 3),
      unavailableObservation('draw-a', ['source-a'], 0.3),
      availableObservation('draw-b', 0.5, 1),
    ];
    const expected = materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: 3,
      observations,
    });
    for (const permutation of [
      [observations[2], observations[1], observations[0]],
      [observations[1], observations[0], observations[2]],
    ]) {
      expect(
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 3,
          observations: permutation,
        })
      ).toEqual(expected);
    }
  });

  it('accepts sets, generators, and function-valued iterable sources', () => {
    function* generator() {
      yield availableObservation('draw-a');
    }
    const functionSource = Object.assign(function sourceFunction() {}, {
      *[Symbol.iterator]() {
        yield availableObservation('draw-a');
      },
    });
    for (const observations of [
      new Set([availableObservation('draw-a')]),
      generator(),
      functionSource,
    ]) {
      expect(
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 1,
          observations,
        }).availableDrawCount
      ).toBe(1);
    }
  });

  it.each([0, 1.5, AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT + 1])(
    'rejects invalid draw count %s before touching the source',
    (drawCount) => {
      const instrumented = createInstrumentedIterable([availableObservation('draw-a')]);
      const error = captureStructuralError(() =>
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount,
          observations: instrumented.source,
        })
      );
      expect(error.code).toBe('INVALID_INPUT_HEADER');
      expect(instrumented.counters.iteratorGetterCalls).toBe(0);
    }
  );

  it('invokes the iterator factory and captured next method once with correct receivers', () => {
    const instrumented = createInstrumentedIterable([availableObservation('draw-a')]);
    materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: 1,
      observations: instrumented.source,
    });
    expect(instrumented.counters.iteratorGetterCalls).toBe(1);
    expect(instrumented.counters.iteratorFactoryCalls).toBe(1);
    expect(instrumented.counters.iteratorFactoryReceiver).toBe(instrumented.source);
    expect(instrumented.counters.nextGetterCalls).toBe(1);
    expect(instrumented.counters.nextReceivers).toEqual([
      instrumented.iterator,
      instrumented.iterator,
    ]);
  });

  it.each([
    ['primitive source', 3, 'protocol'],
    ['null source', null, 'protocol'],
  ] as const)('rejects %s without retaining raw input', (_label, observations, stage) => {
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations,
      })
    );
    expect(error.code).toBe('OBSERVATION_SOURCE_FAILURE');
    expect(error.sourceFailureStage).toBe(stage);
  });

  it('maps iterator getter and factory exceptions to sanitized acquisition failures', () => {
    const throwingGetter = Object.defineProperty({}, Symbol.iterator, {
      get() {
        throw new Error('secret-iterator-getter');
      },
    });
    const getterError = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: throwingGetter,
      })
    );
    expect(getterError.sourceFailureStage).toBe('acquisition');
    expect(JSON.stringify(getterError)).not.toContain('secret');

    const instrumented = createInstrumentedIterable([], { iteratorFactoryThrows: true });
    const factoryError = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: instrumented.source,
      })
    );
    expect(factoryError.sourceFailureStage).toBe('acquisition');
    expect(instrumented.counters.iteratorFactoryCalls).toBe(1);
    expect(instrumented.counters.returnGetterCalls).toBe(0);
  });

  it('rejects a noncallable iterator factory as a protocol failure', () => {
    const source = { [Symbol.iterator]: 7 };
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: source,
      })
    );
    expect(error.code).toBe('OBSERVATION_SOURCE_FAILURE');
    expect(error.sourceFailureStage).toBe('protocol');
  });

  it.each([
    ['primitive iterator', { primitiveIterator: true }],
    ['noncallable next', { nonCallableNext: true }],
  ] as const)(
    'rejects %s as a protocol failure before iterator-record completion',
    (_label, options) => {
      const instrumented = createInstrumentedIterable([], options);
      const error = captureStructuralError(() =>
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 1,
          observations: instrumented.source,
        })
      );
      expect(error.code).toBe('OBSERVATION_SOURCE_FAILURE');
      expect(error.sourceFailureStage).toBe('protocol');
      expect(instrumented.counters.returnGetterCalls).toBe(0);
    }
  );

  it('does not close when capturing next throws before an iterator record exists', () => {
    const instrumented = createInstrumentedIterable([], { nextGetterThrows: true });
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: instrumented.source,
      })
    );
    expect(error.sourceFailureStage).toBe('acquisition');
    expect(instrumented.counters.returnGetterCalls).toBe(0);
  });

  it('accepts function-valued iterator results and rejects primitive results after closing', () => {
    const functionResult = createInstrumentedIterable([availableObservation('draw-a')], {
      functionResultAt: 0,
    });
    expect(
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: functionResult.source,
      }).availableDrawCount
    ).toBe(1);

    const primitiveResult = createInstrumentedIterable([], { primitiveResultAt: 0 });
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: primitiveResult.source,
      })
    );
    expect(error.sourceFailureStage).toBe('protocol');
    expect(primitiveResult.counters.returnGetterCalls).toBe(1);
    expect(primitiveResult.counters.returnCalls).toBe(1);
  });

  it.each([
    ['next', { nextThrowsAt: 0 }],
    ['done', { doneThrowsAt: 0 }],
    ['value', { valueThrowsAt: 0 }],
  ] as const)(
    'maps throwing %s behavior to one sanitized advancement failure and close',
    (_label, options) => {
      const instrumented = createInstrumentedIterable([availableObservation('draw-a')], options);
      const error = captureStructuralError(() =>
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 1,
          observations: instrumented.source,
        })
      );
      expect(error.code).toBe('OBSERVATION_SOURCE_FAILURE');
      expect(error.sourceFailureStage).toBe('advancement');
      expect(error.observationIndex).toBe(0);
      expect(error.iteratorCloseFailed).toBe(false);
      expect(instrumented.counters.returnGetterCalls).toBe(1);
      expect(instrumented.counters.returnCalls).toBe(1);
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  );

  it.each([
    ['getter failure', 'getter_throw', true, 0],
    ['noncallable return', 'noncallable', true, 0],
    ['call failure', 'call_throw', true, 1],
    ['primitive successful result', 'primitive_result', false, 1],
    ['absent return', 'absent', false, 0],
  ] as const)(
    'preserves the primary error across return %s',
    (_label, returnBehavior, closeFailed, returnCalls) => {
      const instrumented = createInstrumentedIterable([{ status: 'invalid' }], {
        returnBehavior,
      });
      const error = captureStructuralError(() =>
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 1,
          observations: instrumented.source,
        })
      );
      expect(error.code).toBe('INVALID_OBSERVATION');
      expect(error.iteratorCloseFailed).toBe(closeFailed);
      expect(instrumented.counters.returnGetterCalls).toBe(1);
      expect(instrumented.counters.returnCalls).toBe(returnCalls);
      if (returnCalls === 1)
        expect(instrumented.counters.returnReceiver).toBe(instrumented.iterator);
    }
  );

  it('rejects throwing observation getters and forbidden fields without exposing them', () => {
    const throwingObservation = Object.defineProperty({}, 'status', {
      enumerable: true,
      get() {
        throw new Error('secret-observation-getter');
      },
    });
    for (const observation of [
      throwingObservation,
      { ...availableObservation('draw-a'), fantasyOwnerId: 'secret-owner' },
    ]) {
      const error = captureStructuralError(() =>
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 1,
          observations: [observation],
        })
      );
      expect(error.code).toBe('INVALID_OBSERVATION');
      expect(JSON.stringify(error)).not.toContain('secret');
      expect(JSON.stringify(error)).not.toContain('fantasy');
    }
  });

  it('rejects hostile key enumeration and unavailable extra fields', () => {
    const hostileKeys = new Proxy(availableObservation('draw-a'), {
      ownKeys() {
        throw new Error('secret-own-keys');
      },
    });
    for (const observation of [
      hostileKeys,
      { ...unavailableObservation('draw-a'), ownerId: 'secret-owner' },
    ]) {
      const error = captureStructuralError(() =>
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 1,
          observations: [observation],
        })
      );
      expect(error.code).toBe('INVALID_OBSERVATION');
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });

  it.each([
    ['non-array', 'source-missing'],
    [
      'throwing length',
      new Proxy([], {
        get(target, property, receiver) {
          if (property === 'length') throw new Error('secret-length');
          return Reflect.get(target, property, receiver);
        },
      }),
    ],
    [
      'throwing element',
      new Proxy(['source-missing'], {
        get(target, property, receiver) {
          if (property === '0') throw new Error('secret-element');
          return Reflect.get(target, property, receiver);
        },
      }),
    ],
  ])('rejects %s unavailable reasons through the bounded snapshot', (_label, reasonCodes) => {
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: [unavailableObservation('draw-a', reasonCodes)],
      })
    );
    expect(error.code).toBe('INVALID_OBSERVATION');
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('sanitizes an unexpected observation-schema exception', () => {
    const safeParse = vi
      .spyOn(aflTradeStructuralWeightedDistributionObservationSchema, 'safeParse')
      .mockImplementationOnce(() => {
        throw new Error('secret-schema-failure');
      });
    try {
      const error = captureStructuralError(() =>
        materializeAflTradeStructuralWeightedDistributionObservationSet({
          drawCount: 1,
          observations: [availableObservation('draw-a')],
        })
      );
      expect(error.code).toBe('INVALID_OBSERVATION');
      expect(JSON.stringify(error)).not.toContain('secret');
    } finally {
      safeParse.mockRestore();
    }
  });

  it('rejects an oversized reason array before reading any reason element', () => {
    let reasonElementReads = 0;
    const reasons = new Proxy(
      Array.from(
        { length: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES + 1 },
        (_, index) => `reason-${index}`
      ),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) reasonElementReads += 1;
          return Reflect.get(target, property, receiver);
        },
      }
    );
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: [unavailableObservation('draw-a', reasons)],
      })
    );
    expect(error.code).toBe('INVALID_OBSERVATION');
    expect(reasonElementReads).toBe(0);
  });

  it('detects duplicate draw keys after trimming', () => {
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 2,
        observations: [availableObservation(' draw-a ', 0.5), availableObservation('draw-a', 0.5)],
      })
    );
    expect(error.code).toBe('DUPLICATE_DRAW_KEY');
    expect(error.observationIndex).toBe(1);
  });

  it('unions normalized reasons and fails at the 101st unique normalized reason', () => {
    const firstReasons = Array.from(
      { length: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES },
      (_, index) => `reason-${String(index).padStart(3, '0')}`
    );
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 2,
        observations: [
          unavailableObservation('draw-a', firstReasons, 0.5),
          unavailableObservation('draw-b', ['reason-overflow'], 0.5),
        ],
      })
    );
    expect(error.code).toBe('REASON_CODE_LIMIT_EXCEEDED');
    expect(error.observationIndex).toBe(1);

    const normalized = materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: 2,
      observations: [
        unavailableObservation('draw-a', [' reason-a '], 0.5),
        unavailableObservation('draw-b', ['reason-a'], 0.5),
      ],
    });
    expect(normalized.reasonCodes).toEqual(['reason-a']);
  });

  it('uses exactly drawCount plus one advances and never reads the lookahead value', () => {
    const instrumented = createInstrumentedIterable([
      availableObservation('draw-a', 0.5),
      availableObservation('draw-b', 0.5),
    ]);
    materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: 2,
      observations: instrumented.source,
    });
    expect(instrumented.counters.nextCalls).toBe(3);
    expect(instrumented.counters.doneReads).toBe(3);
    expect(instrumented.counters.valueReads).toBe(2);
    expect(instrumented.counters.returnGetterCalls).toBe(0);
  });

  it('reports early natural completion without reading value or closing', () => {
    const instrumented = createInstrumentedIterable([availableObservation('draw-a')]);
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 2,
        observations: instrumented.source,
      })
    );
    expect(error.code).toBe('OBSERVATION_COUNT_MISMATCH');
    expect(error.observationIndex).toBe(1);
    expect(instrumented.counters.nextCalls).toBe(2);
    expect(instrumented.counters.valueReads).toBe(1);
    expect(instrumented.counters.returnGetterCalls).toBe(0);
  });

  it('detects excess input without reading the excess value and closes once', () => {
    const instrumented = createInstrumentedIterable([
      availableObservation('draw-a'),
      availableObservation('draw-b'),
    ]);
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 1,
        observations: instrumented.source,
      })
    );
    expect(error.code).toBe('OBSERVATION_COUNT_MISMATCH');
    expect(error.observationIndex).toBe(1);
    expect(instrumented.counters.nextCalls).toBe(2);
    expect(instrumented.counters.doneReads).toBe(2);
    expect(instrumented.counters.valueReads).toBe(1);
    expect(instrumented.counters.returnCalls).toBe(1);
  });

  it('bounds an infinite source at drawCount plus one advances', () => {
    const instrumented = createInstrumentedIterable([], {
      infiniteValueFactory: (callIndex) => availableObservation(`draw-${callIndex}`),
    });
    const error = captureStructuralError(() =>
      materializeAflTradeStructuralWeightedDistributionObservationSet({
        drawCount: 2,
        observations: instrumented.source,
      })
    );
    expect(error.code).toBe('OBSERVATION_COUNT_MISMATCH');
    expect(error.observationIndex).toBe(2);
    expect(instrumented.counters.nextCalls).toBe(3);
    expect(instrumented.counters.valueReads).toBe(2);
    expect(instrumented.counters.returnCalls).toBe(1);
  });

  it('supports and canonically sorts the maximum declared draw count', () => {
    function* maximumDraws() {
      for (
        let index = AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT - 1;
        index >= 0;
        index -= 1
      ) {
        yield availableObservation(`draw-${String(index).padStart(6, '0')}`, 1e-5, index);
      }
    }
    const result = materializeAflTradeStructuralWeightedDistributionObservationSet({
      drawCount: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT,
      observations: maximumDraws(),
    });
    expect(result.observations).toHaveLength(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT
    );
    expect(result.availableDrawCount).toBe(
      AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_DRAW_COUNT
    );
    expect(result.observations[0]?.drawKey).toBe('draw-000000');
    expect(result.observations.at(-1)?.drawKey).toBe('draw-099999');
  });
});
