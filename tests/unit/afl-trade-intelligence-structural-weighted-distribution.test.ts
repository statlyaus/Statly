// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { AFL_TRADE_PROBABILITY_MEASURE_DEFINITION_VERSION } from '@/server/aflTradeIntelligence/valuation/deterministicProbabilityMeasure';
import { calculateAflTradeStructuralWeightedDistribution } from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistribution';
import {
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_BOUNDS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_COMPLETENESS_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_MEASURE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_DISPERSION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_EVENT_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MEASURE_SCOPE,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_NORMALIZATION_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_QUANTILE_DEFINITION_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
  AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_STATISTICS_ARITHMETIC_DEFINITION_VERSION,
  aflTradeStructuralWeightedDistributionSchema,
  type AflTradeStructuralWeightedDistribution,
  type AflTradeStructuralWeightedDistributionPolicy,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionContracts';
import {
  AflTradeStructuralWeightedDistributionError,
  isAflTradeStructuralWeightedDistributionError,
} from '@/server/aflTradeIntelligence/valuation/structuralWeightedDistributionErrors';

const INPUT_KEYS = [
  'inputSchemaVersion',
  'publicAssetBoundary',
  'valueScope',
  'valueUnitId',
  'policy',
  'drawCount',
  'observations',
] as const;

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

function available(
  drawKey: string,
  probabilityWeight: number,
  value: number
): Record<string, unknown> {
  return { drawKey, probabilityWeight, status: 'available', value };
}

function unavailable(
  drawKey: string,
  probabilityWeight: number,
  reasonCodes: string[] = ['source-missing']
): Record<string, unknown> {
  return { drawKey, probabilityWeight, reasonCodes, status: 'unavailable' };
}

function input(
  observations: unknown = [available('draw-a', 1, 5)],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const drawCount = Array.isArray(observations) ? observations.length : 1;
  return {
    inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
    valueScope: 'universal_football_value_cross_club_comparable',
    valueUnitId: 'fixture-contribution-unit',
    policy: policy(),
    drawCount,
    observations,
    ...overrides,
  };
}

function captureStructuralError(
  operation: () => unknown
): AflTradeStructuralWeightedDistributionError {
  try {
    operation();
  } catch (error) {
    expect(isAflTradeStructuralWeightedDistributionError(error)).toBe(true);
    return error as AflTradeStructuralWeightedDistributionError;
  }
  throw new Error('Expected a structural weighted-distribution error.');
}

function expectErrorMetadata(
  operation: () => unknown,
  expected: Partial<
    Pick<
      AflTradeStructuralWeightedDistributionError,
      'code' | 'sourceFailureStage' | 'observationIndex' | 'iteratorCloseFailed'
    >
  >
): AflTradeStructuralWeightedDistributionError {
  const error = captureStructuralError(operation);
  expect(error).toMatchObject(expected);
  return error;
}

interface IterableOptions {
  iteratorGetterThrows?: boolean;
  iteratorFactoryThrows?: boolean;
  primitiveIterator?: boolean;
  nextGetterThrows?: boolean;
  nonCallableNext?: boolean;
  nextThrowsAt?: number;
  returnThrows?: boolean;
}

interface IterableCounters {
  iteratorGetterCalls: number;
  iteratorFactoryCalls: number;
  nextGetterCalls: number;
  nextCalls: number;
  returnGetterCalls: number;
  returnCalls: number;
}

function instrumentedIterable(
  values: readonly unknown[],
  options: IterableOptions = {}
): { source: object; counters: IterableCounters } {
  const counters: IterableCounters = {
    iteratorGetterCalls: 0,
    iteratorFactoryCalls: 0,
    nextGetterCalls: 0,
    nextCalls: 0,
    returnGetterCalls: 0,
    returnCalls: 0,
  };
  let position = 0;
  const iterator = {
    get next(): unknown {
      counters.nextGetterCalls += 1;
      if (options.nextGetterThrows) throw new Error('secret-next-getter');
      if (options.nonCallableNext) return 7;
      return function next() {
        const callIndex = counters.nextCalls;
        counters.nextCalls += 1;
        if (options.nextThrowsAt === callIndex) throw new Error('secret-next-call');
        if (position >= values.length) return { done: true };
        const value = values[position];
        position += 1;
        return { done: false, value };
      };
    },
    get return(): unknown {
      counters.returnGetterCalls += 1;
      return function close() {
        counters.returnCalls += 1;
        if (options.returnThrows) throw new Error('secret-return-call');
        return {};
      };
    },
  };
  const source = {
    get [Symbol.iterator](): unknown {
      counters.iteratorGetterCalls += 1;
      if (options.iteratorGetterThrows) throw new Error('secret-iterator-getter');
      return function iteratorFactory() {
        counters.iteratorFactoryCalls += 1;
        if (options.iteratorFactoryThrows) throw new Error('secret-iterator-factory');
        if (options.primitiveIterator) return 5;
        return iterator;
      };
    },
  };
  return { source, counters };
}

function expectDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

function collectNegativeZeroPaths(value: unknown): string[] {
  const paths: string[] = [];
  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate === 'number' && Object.is(candidate, -0)) paths.push(path);
    if (candidate === null || typeof candidate !== 'object') return;
    for (const [key, child] of Object.entries(candidate)) visit(child, `${path}.${key}`);
  };
  visit(value, 'result');
  return paths;
}

describe('AFL trade structural weighted-distribution facade results', () => {
  it('assembles and validates complete, partial, and unavailable results', () => {
    const complete = calculateAflTradeStructuralWeightedDistribution(
      input([available('draw-a', 0.5, -5), available('draw-b', 0.5, 15)])
    );
    const partial = calculateAflTradeStructuralWeightedDistribution(
      input([available('draw-a', 0.6, -5), unavailable('draw-b', 0.4)])
    );
    const missing = calculateAflTradeStructuralWeightedDistribution(
      input([unavailable('draw-a', 0.5, ['source-b']), unavailable('draw-b', 0.5, ['source-a'])])
    );

    for (const result of [complete, partial, missing]) {
      expect(aflTradeStructuralWeightedDistributionSchema.safeParse(result).success).toBe(true);
      expect(result).toMatchObject({
        schemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_SCHEMA_VERSION,
        inputSchemaVersion: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_INPUT_SCHEMA_VERSION,
        publicAssetBoundary: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_PUBLIC_ASSET_BOUNDARY,
        valueScope: 'universal_football_value_cross_club_comparable',
        valueUnitId: 'fixture-contribution-unit',
        inputProbabilityWeightTotal: 1,
      });
    }

    expect(complete).toMatchObject({
      status: 'complete',
      availableDrawCount: 2,
      unavailableDrawCount: 0,
      conditionalOnAvailableScope: null,
      reasonCodes: [],
    });
    expect(partial).toMatchObject({
      status: 'partial',
      availableDrawCount: 1,
      unavailableDrawCount: 1,
      conditionalOnAvailableScope: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_CONDITIONAL_SCOPE,
      reasonCodes: ['source-missing'],
    });
    expect(missing).toMatchObject({
      status: 'unavailable',
      availableDrawCount: 0,
      unavailableDrawCount: 2,
      reasonCodes: ['source-a', 'source-b'],
    });
  });

  it('supports the explicitly non-comparable single-club utility scope', () => {
    const result = calculateAflTradeStructuralWeightedDistribution(
      input(undefined, {
        valueScope: 'single_afl_club_utility_not_cross_club_comparable',
        valueUnitId: 'club-utility-unit',
      })
    );

    expect(result.valueScope).toBe('single_afl_club_utility_not_cross_club_comparable');
    expect(result.valueUnitId).toBe('club-utility-unit');
  });
});

describe('AFL trade structural weighted-distribution hostile input boundary', () => {
  it('recognizes only privately branded errors without inspecting hostile prototypes', () => {
    const genuine = new AflTradeStructuralWeightedDistributionError({
      code: 'INVALID_INPUT_HEADER',
    });
    const prototypeSpoof = Object.create(AflTradeStructuralWeightedDistributionError.prototype);
    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('secret-prototype-trap');
        },
      }
    );
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(isAflTradeStructuralWeightedDistributionError(genuine)).toBe(true);
    expect(isAflTradeStructuralWeightedDistributionError({})).toBe(false);
    expect(isAflTradeStructuralWeightedDistributionError(prototypeSpoof)).toBe(false);
    expect(isAflTradeStructuralWeightedDistributionError(throwingPrototype)).toBe(false);
    expect(isAflTradeStructuralWeightedDistributionError(revocable.proxy)).toBe(false);
  });

  it.each([null, undefined, 'not-an-input', () => undefined])(
    'rejects non-record input %#',
    (candidate) => {
      expectErrorMetadata(() => calculateAflTradeStructuralWeightedDistribution(candidate), {
        code: 'INVALID_INPUT_HEADER',
      });
    }
  );

  it('enumerates the exact key set once and reads every top-level property once in order', () => {
    const gets: PropertyKey[] = [];
    let ownKeysCalls = 0;
    const target = input();
    const hostile = new Proxy(target, {
      ownKeys(value) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(value);
      },
      get(value, key, receiver) {
        gets.push(key);
        return Reflect.get(value, key, receiver);
      },
    });

    const result = calculateAflTradeStructuralWeightedDistribution(hostile);

    expect(result.status).toBe('complete');
    expect(ownKeysCalls).toBe(1);
    expect(gets).toEqual(INPUT_KEYS);
  });

  it('does not inspect the original iterator while rejecting invalid metadata', () => {
    const instrumented = instrumentedIterable([available('draw-a', 1, 5)]);
    const invalid = input(instrumented.source, { valueScope: 'fantasy_owned_player_value' });

    expectErrorMetadata(() => calculateAflTradeStructuralWeightedDistribution(invalid), {
      code: 'INVALID_INPUT_HEADER',
    });
    expect(instrumented.counters.iteratorGetterCalls).toBe(0);
    expect(instrumented.counters.nextCalls).toBe(0);
  });

  it('does not inspect the original iterator when a nested policy getter throws', () => {
    const instrumented = instrumentedIterable([available('draw-a', 1, 5)]);
    const hostilePolicy = new Proxy(policy(), {
      get(target, key, receiver) {
        if (key === 'quantiles') throw new Error('secret-policy-value');
        return Reflect.get(target, key, receiver);
      },
    });

    const error = expectErrorMetadata(
      () =>
        calculateAflTradeStructuralWeightedDistribution(
          input(instrumented.source, { policy: hostilePolicy })
        ),
      { code: 'INVALID_INPUT_HEADER' }
    );
    expect(instrumented.counters.iteratorGetterCalls).toBe(0);
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('accesses a valid source iterator once and advances no more than drawCount plus one times', () => {
    const instrumented = instrumentedIterable([
      available('draw-a', 0.5, -5),
      available('draw-b', 0.5, 15),
    ]);

    const result = calculateAflTradeStructuralWeightedDistribution(
      input(instrumented.source, { drawCount: 2 })
    );

    expect(result.status).toBe('complete');
    expect(instrumented.counters.iteratorGetterCalls).toBe(1);
    expect(instrumented.counters.iteratorFactoryCalls).toBe(1);
    expect(instrumented.counters.nextGetterCalls).toBe(1);
    expect(instrumented.counters.nextCalls).toBe(3);
    expect(instrumented.counters.nextCalls).toBeLessThanOrEqual(3);
  });

  it.each([
    [
      'missing key',
      () => {
        const candidate = input();
        delete candidate.valueUnitId;
        return candidate;
      },
    ],
    ['extra key', () => ({ ...input(), unexpected: true })],
    ['symbol key', () => Object.assign(input(), { [Symbol('owner')]: 'user-1' })],
    ['user ownership key', () => ({ ...input(), userId: 'user-1' })],
    ['fantasy ownership key', () => ({ ...input(), fantasyOwnerId: 'fantasy-team-1' })],
    [
      'non-enumerable extra key',
      () => {
        const candidate = input();
        Object.defineProperty(candidate, 'hiddenOwnerId', { value: 'user-1' });
        return candidate;
      },
    ],
  ])('rejects an input with a %s', (_label, createCandidate) => {
    expectErrorMetadata(() => calculateAflTradeStructuralWeightedDistribution(createCandidate()), {
      code: 'INVALID_INPUT_HEADER',
    });
  });

  it.each([
    ['user ownership field', { userId: 'user-1' }],
    ['fantasy ownership field', { fantasyOwnerId: 'fantasy-team-1' }],
  ])('rejects an observation with a %s', (_label, forbidden) => {
    const error = expectErrorMetadata(
      () =>
        calculateAflTradeStructuralWeightedDistribution(
          input([{ ...available('draw-a', 1, 5), ...forbidden }])
        ),
      { code: 'INVALID_OBSERVATION', observationIndex: 0 }
    );
    expect(JSON.stringify(error)).not.toContain('user-1');
    expect(JSON.stringify(error)).not.toContain('fantasy-team-1');
  });

  it('sanitizes hostile input key enumeration and property access', () => {
    const ownKeysFailure = new Proxy(input(), {
      ownKeys() {
        throw new Error('secret-own-keys');
      },
    });
    const getFailure = new Proxy(input(), {
      get(target, key, receiver) {
        if (key === 'drawCount') throw new Error('secret-draw-count');
        return Reflect.get(target, key, receiver);
      },
    });

    for (const candidate of [ownKeysFailure, getFailure]) {
      const error = expectErrorMetadata(
        () => calculateAflTradeStructuralWeightedDistribution(candidate),
        { code: 'INVALID_INPUT_HEADER' }
      );
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });
});

describe('AFL trade structural weighted-distribution error preservation', () => {
  it('maps a rejected assembled result to the internal result-contract code', () => {
    const safeParse = vi
      .spyOn(aflTradeStructuralWeightedDistributionSchema, 'safeParse')
      .mockReturnValueOnce({ success: false } as never);
    try {
      expectErrorMetadata(() => calculateAflTradeStructuralWeightedDistribution(input()), {
        code: 'INTERNAL_RESULT_CONTRACT_VIOLATION',
        sourceFailureStage: null,
        observationIndex: null,
        iteratorCloseFailed: false,
      });
    } finally {
      safeParse.mockRestore();
    }
  });

  it('sanitizes an unexpected result-validation exception as an internal violation', () => {
    const safeParse = vi
      .spyOn(aflTradeStructuralWeightedDistributionSchema, 'safeParse')
      .mockImplementationOnce(() => {
        throw new Error('secret-result-validation-failure');
      });
    try {
      const error = expectErrorMetadata(
        () => calculateAflTradeStructuralWeightedDistribution(input()),
        {
          code: 'INTERNAL_RESULT_CONTRACT_VIOLATION',
          sourceFailureStage: null,
          observationIndex: null,
          iteratorCloseFailed: false,
        }
      );
      expect(JSON.stringify(error)).not.toContain('secret');
    } finally {
      safeParse.mockRestore();
    }
  });

  it.each([
    [
      'iterator getter',
      { iteratorGetterThrows: true },
      { code: 'OBSERVATION_SOURCE_FAILURE', sourceFailureStage: 'acquisition' },
    ],
    [
      'iterator factory',
      { iteratorFactoryThrows: true },
      { code: 'OBSERVATION_SOURCE_FAILURE', sourceFailureStage: 'acquisition' },
    ],
    [
      'primitive iterator',
      { primitiveIterator: true },
      { code: 'OBSERVATION_SOURCE_FAILURE', sourceFailureStage: 'protocol' },
    ],
    [
      'next getter',
      { nextGetterThrows: true },
      { code: 'OBSERVATION_SOURCE_FAILURE', sourceFailureStage: 'acquisition' },
    ],
    [
      'non-callable next',
      { nonCallableNext: true },
      { code: 'OBSERVATION_SOURCE_FAILURE', sourceFailureStage: 'protocol' },
    ],
  ] as const)('preserves %s acquisition and protocol errors', (_label, options, expected) => {
    const instrumented = instrumentedIterable([available('draw-a', 1, 5)], options);
    const error = expectErrorMetadata(
      () =>
        calculateAflTradeStructuralWeightedDistribution(
          input(instrumented.source, { drawCount: 1 })
        ),
      {
        ...expected,
        observationIndex: null,
        iteratorCloseFailed: false,
      }
    );
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('preserves advancement index and failed-close metadata', () => {
    const instrumented = instrumentedIterable([available('draw-a', 1, 5)], {
      nextThrowsAt: 0,
      returnThrows: true,
    });
    const error = expectErrorMetadata(
      () => calculateAflTradeStructuralWeightedDistribution(input(instrumented.source)),
      {
        code: 'OBSERVATION_SOURCE_FAILURE',
        sourceFailureStage: 'advancement',
        observationIndex: 0,
        iteratorCloseFailed: true,
      }
    );

    expect(instrumented.counters.returnGetterCalls).toBe(1);
    expect(instrumented.counters.returnCalls).toBe(1);
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('preserves short and excess cardinality errors', () => {
    const short = instrumentedIterable([available('draw-a', 0.5, 5)]);
    expectErrorMetadata(
      () => calculateAflTradeStructuralWeightedDistribution(input(short.source, { drawCount: 2 })),
      {
        code: 'OBSERVATION_COUNT_MISMATCH',
        observationIndex: 1,
        iteratorCloseFailed: false,
      }
    );

    const excess = instrumentedIterable([available('draw-a', 1, 5), available('draw-b', 1, 6)], {
      returnThrows: true,
    });
    expectErrorMetadata(
      () => calculateAflTradeStructuralWeightedDistribution(input(excess.source, { drawCount: 1 })),
      {
        code: 'OBSERVATION_COUNT_MISMATCH',
        observationIndex: 1,
        iteratorCloseFailed: true,
      }
    );
  });

  it('preserves invalid-observation errors and iterator-close metadata', () => {
    const instrumented = instrumentedIterable(
      [{ ...available('draw-a', 1, 5), ownerId: 'secret-owner' }],
      { returnThrows: true }
    );
    const error = expectErrorMetadata(
      () => calculateAflTradeStructuralWeightedDistribution(input(instrumented.source)),
      {
        code: 'INVALID_OBSERVATION',
        observationIndex: 0,
        iteratorCloseFailed: true,
      }
    );
    expect(JSON.stringify(error)).not.toContain('secret-owner');
  });

  it('preserves duplicate-key and global reason-limit errors', () => {
    expectErrorMetadata(
      () =>
        calculateAflTradeStructuralWeightedDistribution(
          input([available(' draw-a ', 0.5, 5), available('draw-a', 0.5, 6)])
        ),
      {
        code: 'DUPLICATE_DRAW_KEY',
        observationIndex: 1,
        iteratorCloseFailed: false,
      }
    );

    const firstReasons = Array.from(
      { length: AFL_TRADE_STRUCTURAL_WEIGHTED_DISTRIBUTION_MAX_REASON_CODES },
      (_, index) => `reason-${String(index).padStart(3, '0')}`
    );
    expectErrorMetadata(
      () =>
        calculateAflTradeStructuralWeightedDistribution(
          input([
            unavailable('draw-a', 0.5, firstReasons),
            unavailable('draw-b', 0.5, ['reason-overflow']),
          ])
        ),
      {
        code: 'REASON_CODE_LIMIT_EXCEEDED',
        observationIndex: 1,
        iteratorCloseFailed: false,
      }
    );
  });
});

describe('AFL trade structural weighted-distribution isolation and determinism', () => {
  it('returns a deeply frozen result without retaining caller-owned policy or reason arrays', () => {
    const sourcePolicy = policy();
    const sourceReasons = ['source-missing'];
    const sourceObservations = [
      available('draw-a', 0.6, -5),
      unavailable('draw-b', 0.4, sourceReasons),
    ];
    const sourceInput = input(sourceObservations, { policy: sourcePolicy });

    const result = calculateAflTradeStructuralWeightedDistribution(sourceInput);

    expectDeeplyFrozen(result);
    expect(result.policy).not.toBe(sourcePolicy);
    expect(result.policy.quantiles).not.toBe(sourcePolicy.quantiles);
    expect(result.reasonCodes).not.toBe(sourceReasons);
    sourcePolicy.lowReturnEvent.threshold = -100;
    sourceReasons[0] = 'changed-after-calculation';
    sourceObservations.reverse();
    expect(result.policy.lowReturnEvent.threshold).toBe(0);
    expect(result.reasonCodes).toEqual(['source-missing']);
  });

  it('is identical across source permutations and canonicalizes every reported negative zero', () => {
    const records = [
      available('draw-c', 0.25, -0),
      available('draw-a', 0.25, 0),
      available('draw-b', 0.5, 10),
    ];
    const permutations = [records, [...records].reverse(), [records[1]!, records[2]!, records[0]!]];
    const results: AflTradeStructuralWeightedDistribution[] = permutations.map((observations) =>
      calculateAflTradeStructuralWeightedDistribution(input(observations))
    );

    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(collectNegativeZeroPaths(results[0])).toEqual([]);
    expect(results[0]!.status).toBe('complete');
    if (results[0]!.status !== 'complete') throw new Error('Expected a complete result.');
    expect(Object.is(results[0]!.statistics.minimum, 0)).toBe(true);
  });
});
