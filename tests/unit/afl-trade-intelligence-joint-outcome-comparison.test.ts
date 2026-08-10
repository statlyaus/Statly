// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
  AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
  AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
  AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
  calculateAflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparison,
  type AflTradeJointOutcomeComparisonInput,
} from '@/server/aflTradeIntelligence/valuation/jointOutcomeComparison';

type FixtureObservation = number | { reasonCodes: string[] };
interface FixtureDraw {
  drawKey: string;
  probabilityWeight: number;
  observations: FixtureObservation[];
}

function comparisonInput({
  aflClubIds,
  clearLeaderToleranceQuanta,
  draws,
}: {
  aflClubIds: readonly string[];
  clearLeaderToleranceQuanta: number;
  draws: readonly FixtureDraw[];
}): AflTradeJointOutcomeComparisonInput {
  return {
    inputSchemaVersion: AFL_TRADE_JOINT_OUTCOME_INPUT_SCHEMA_VERSION,
    publicAssetBoundary: AFL_TRADE_JOINT_OUTCOME_PUBLIC_ASSET_BOUNDARY,
    comparisonValueScope: AFL_TRADE_JOINT_OUTCOME_COMPARISON_VALUE_SCOPE,
    outcomeDefinitionVersion: AFL_TRADE_JOINT_OUTCOME_DEFINITION_VERSION,
    valueUnitId: 'fixture-contribution-unit',
    valueScale: {
      definitionVersion: AFL_TRADE_JOINT_OUTCOME_VALUE_SCALE_DEFINITION_VERSION,
      decimalPlaces: 2,
    },
    aflClubIds: [...aflClubIds],
    clearLeaderToleranceQuanta,
    draws: draws.map((draw) => ({
      drawKey: draw.drawKey,
      probabilityWeight: draw.probabilityWeight,
      parties: aflClubIds.map((aflClubId, index) => {
        const observation = draw.observations[index];
        if (observation === undefined) {
          throw new Error(`Missing fixture observation for ${aflClubId}.`);
        }
        return {
          aflClubId,
          observation:
            typeof observation === 'number'
              ? { status: 'available' as const, valueQuanta: observation }
              : {
                  status: 'unavailable' as const,
                  reasonCodes: [...observation.reasonCodes],
                },
        };
      }),
    })),
  };
}

function availableProbabilityProjection(result: AflTradeJointOutcomeComparison) {
  if (result.status !== 'available') throw new Error('Expected an available comparison.');
  return {
    clubClearLeaderProbabilities: Object.fromEntries(
      result.probabilities.clubClearLeaderProbabilities.map(({ aflClubId, probability }) => [
        aflClubId,
        probability,
      ])
    ),
    noClearLeaderProbability: result.probabilities.noClearLeaderProbability,
  };
}

function outcomeMeasureProjection(result: AflTradeJointOutcomeComparison) {
  return {
    status: result.status,
    availableProbabilityMass: result.availableProbabilityMass,
    unavailableProbabilityMass: result.unavailableProbabilityMass,
    probabilities: result.probabilities,
    conditionalOnAvailableProbabilities: result.conditionalOnAvailableProbabilities,
    unconditionalBounds: result.unconditionalBounds,
    reasonCodes: result.reasonCodes,
  };
}

type ReferenceOutcome =
  { kind: 'club_clear_leader'; aflClubId: string } | { kind: 'no_clear_leader' };

function referenceOutcome(
  aflClubIds: readonly string[],
  values: readonly number[],
  clearLeaderToleranceQuanta: number
): ReferenceOutcome {
  const maximum = Math.max(...values);
  const leaderIndexes = values.flatMap((value, index) => (value === maximum ? [index] : []));
  if (leaderIndexes.length !== 1) return { kind: 'no_clear_leader' };

  const leaderIndex = leaderIndexes[0];
  const runnerUp = Math.max(...values.filter((_, index) => index !== leaderIndex));
  return BigInt(maximum) - BigInt(runnerUp) > BigInt(clearLeaderToleranceQuanta)
    ? { kind: 'club_clear_leader', aflClubId: aflClubIds[leaderIndex] }
    : { kind: 'no_clear_leader' };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

function expectUnavailableBoundsAlgebra(result: AflTradeJointOutcomeComparison): void {
  if (result.status !== 'unavailable') throw new Error('Expected an unavailable comparison.');
  const conditionalClubProbabilities = new Map(
    result.conditionalOnAvailableProbabilities?.clubClearLeaderProbabilities.map(
      ({ aflClubId, probability }) => [aflClubId, probability]
    ) ?? result.aflClubIds.map((aflClubId) => [aflClubId, 0])
  );
  const conditionalNoClearLeaderProbability =
    result.conditionalOnAvailableProbabilities?.noClearLeaderProbability ?? 0;

  for (const bound of result.unconditionalBounds.clubClearLeaderBounds) {
    const expectedLower =
      (conditionalClubProbabilities.get(bound.aflClubId) ?? 0) * result.availableProbabilityMass;
    expect(bound.lower).toBeCloseTo(expectedLower, 14);
    expect(bound.upper).toBeCloseTo(
      Math.min(1, expectedLower + result.unavailableProbabilityMass),
      14
    );
  }

  const expectedNoClearLower =
    conditionalNoClearLeaderProbability * result.availableProbabilityMass;
  expect(result.unconditionalBounds.noClearLeaderBounds.lower).toBeCloseTo(
    expectedNoClearLower,
    14
  );
  expect(result.unconditionalBounds.noClearLeaderBounds.upper).toBeCloseTo(
    Math.min(1, expectedNoClearLower + result.unavailableProbabilityMass),
    14
  );

  const lowerMass =
    result.unconditionalBounds.clubClearLeaderBounds.reduce((sum, bound) => sum + bound.lower, 0) +
    result.unconditionalBounds.noClearLeaderBounds.lower;
  expect(lowerMass).toBeCloseTo(result.availableProbabilityMass, 14);
}

describe('AFL trade-intelligence joint-outcome comparison behavior', () => {
  it('matches a literal two-club clear-leader anchor', () => {
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b'],
        clearLeaderToleranceQuanta: 10,
        draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: [100, 89] }],
      })
    );

    expect(availableProbabilityProjection(result)).toEqual({
      clubClearLeaderProbabilities: { 'club-a': 1, 'club-b': 0 },
      noClearLeaderProbability: 0,
    });
  });

  it.each([
    {
      name: 'an exact two-club tie',
      aflClubIds: ['club-a', 'club-b'],
      tolerance: 0,
      values: [50, 50],
      expectedLeader: null,
    },
    {
      name: 'a three-club unique leader',
      aflClubIds: ['club-a', 'club-b', 'club-c'],
      tolerance: 10,
      values: [100, 89, 0],
      expectedLeader: 'club-a',
    },
    {
      name: 'close top clubs with a distant third club',
      aflClubIds: ['club-a', 'club-b', 'club-c'],
      tolerance: 10,
      values: [100, 95, 0],
      expectedLeader: null,
    },
    {
      name: 'an exact top tie with a lower third club',
      aflClubIds: ['club-a', 'club-b', 'club-c'],
      tolerance: 0,
      values: [100, 100, 0],
      expectedLeader: null,
    },
    {
      name: 'an irrelevant tie among lower clubs',
      aflClubIds: ['club-a', 'club-b', 'club-c'],
      tolerance: 10,
      values: [100, 0, 0],
      expectedLeader: 'club-a',
    },
    {
      name: 'all clubs exactly equal',
      aflClubIds: ['club-a', 'club-b', 'club-c'],
      tolerance: 0,
      values: [7, 7, 7],
      expectedLeader: null,
    },
    {
      name: 'a unique leader when every value is negative',
      aflClubIds: ['club-a', 'club-b', 'club-c'],
      tolerance: 10,
      values: [-10, -21, -21],
      expectedLeader: 'club-a',
    },
    {
      name: 'the maximum eighteen-club party set',
      aflClubIds: Array.from(
        { length: 18 },
        (_, index) => `club-${String(index).padStart(2, '0')}`
      ),
      tolerance: 0,
      values: Array.from({ length: 18 }, (_, index) => index),
      expectedLeader: 'club-17',
    },
  ])(
    'classifies $name without relabelling no-clear-leader as equivalence',
    ({ aflClubIds, tolerance, values, expectedLeader }) => {
      const result = calculateAflTradeJointOutcomeComparison(
        comparisonInput({
          aflClubIds,
          clearLeaderToleranceQuanta: tolerance,
          draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: values }],
        })
      );

      expect(availableProbabilityProjection(result)).toEqual({
        clubClearLeaderProbabilities: Object.fromEntries(
          aflClubIds.map((aflClubId) => [aflClubId, aflClubId === expectedLeader ? 1 : 0])
        ),
        noClearLeaderProbability: expectedLeader === null ? 1 : 0,
      });
    }
  );

  it('reports no clear leader for close top clubs without implying a distant third is equivalent', () => {
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 10,
        draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: [100, 95, 0] }],
      })
    );

    expect(availableProbabilityProjection(result)).toEqual({
      clubClearLeaderProbabilities: { 'club-a': 0, 'club-b': 0, 'club-c': 0 },
      noClearLeaderProbability: 1,
    });
  });

  it('matches an independent reference definition across a bounded three-club state space', () => {
    const aflClubIds = ['club-a', 'club-b', 'club-c'];
    const support = [-2, -1, 0, 1, 2];
    const tolerances = [0, 1, 2];
    let evaluatedCaseCount = 0;

    for (const first of support) {
      for (const second of support) {
        for (const third of support) {
          for (const tolerance of tolerances) {
            const values = [first, second, third];
            const expected = referenceOutcome(aflClubIds, values, tolerance);
            const result = calculateAflTradeJointOutcomeComparison(
              comparisonInput({
                aflClubIds,
                clearLeaderToleranceQuanta: tolerance,
                draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: values }],
              })
            );
            const expectedLeader =
              expected.kind === 'club_clear_leader' ? expected.aflClubId : null;

            expect(
              availableProbabilityProjection(result),
              `values=${values.join(',')} tolerance=${tolerance}`
            ).toEqual({
              clubClearLeaderProbabilities: Object.fromEntries(
                aflClubIds.map((aflClubId) => [aflClubId, aflClubId === expectedLeader ? 1 : 0])
              ),
              noClearLeaderProbability: expectedLeader === null ? 1 : 0,
            });
            evaluatedCaseCount += 1;
          }
        }
      }
    }

    expect(evaluatedCaseCount).toBe(375);
  });

  it.each([
    { name: 'zero tolerance', values: [1, 0], tolerance: 0, expectedLeader: 'club-a' },
    { name: 'tolerance equality', values: [10, 0], tolerance: 10, expectedLeader: null },
    {
      name: 'one quantum above tolerance',
      values: [11, 0],
      tolerance: 10,
      expectedLeader: 'club-a',
    },
    {
      name: 'negative-value tolerance equality',
      values: [-10, -20],
      tolerance: 10,
      expectedLeader: null,
    },
    {
      name: 'a safe-integer-range difference led by the first club',
      values: [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
      tolerance: Number.MAX_SAFE_INTEGER,
      expectedLeader: 'club-a',
    },
    {
      name: 'a safe-integer-range difference led by the second club',
      values: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      tolerance: Number.MAX_SAFE_INTEGER,
      expectedLeader: 'club-b',
    },
  ])('classifies the exact integer boundary for $name', ({ values, tolerance, expectedLeader }) => {
    const aflClubIds = ['club-a', 'club-b'];
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds,
        clearLeaderToleranceQuanta: tolerance,
        draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: values }],
      })
    );

    expect(result.clearLeaderToleranceQuanta).toBe(tolerance);
    expect(availableProbabilityProjection(result)).toEqual({
      clubClearLeaderProbabilities: {
        'club-a': expectedLeader === 'club-a' ? 1 : 0,
        'club-b': expectedLeader === 'club-b' ? 1 : 0,
      },
      noClearLeaderProbability: expectedLeader === null ? 1 : 0,
    });
  });

  it('cannot create a clear leader by increasing the tolerance', () => {
    const aflClubIds = ['club-a', 'club-b', 'club-c'];
    const draws: FixtureDraw[] = [
      { drawKey: 'draw-a', probabilityWeight: 0.25, observations: [100, 99, 0] },
      { drawKey: 'draw-b', probabilityWeight: 0.25, observations: [100, 94, 0] },
      { drawKey: 'draw-c', probabilityWeight: 0.25, observations: [0, 100, 89] },
      { drawKey: 'draw-d', probabilityWeight: 0.25, observations: [0, 0, 100] },
    ];
    const projections = [0, 5, 10, 100].map((tolerance) =>
      availableProbabilityProjection(
        calculateAflTradeJointOutcomeComparison(
          comparisonInput({ aflClubIds, clearLeaderToleranceQuanta: tolerance, draws })
        )
      )
    );

    for (let index = 1; index < projections.length; index += 1) {
      const previous = projections[index - 1]!;
      const current = projections[index]!;
      for (const aflClubId of aflClubIds) {
        expect(current.clubClearLeaderProbabilities[aflClubId]).toBeLessThanOrEqual(
          previous.clubClearLeaderProbabilities[aflClubId]
        );
      }
      expect(current.noClearLeaderProbability).toBeGreaterThanOrEqual(
        previous.noClearLeaderProbability
      );
    }
  });

  it.each([
    { name: 'slightly above one', secondWeight: 0.500000009 },
    { name: 'slightly below one', secondWeight: 0.499999991 },
  ])('normalizes an accepted total draw weight $name', ({ secondWeight }) => {
    const totalWeight = 0.5 + secondWeight;
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b'],
        clearLeaderToleranceQuanta: 0,
        draws: [
          { drawKey: 'draw-a', probabilityWeight: 0.5, observations: [1, 0] },
          { drawKey: 'draw-b', probabilityWeight: secondWeight, observations: [0, 1] },
        ],
      })
    );
    const probabilities = availableProbabilityProjection(result);

    expect(probabilities.clubClearLeaderProbabilities['club-a']).toBeCloseTo(0.5 / totalWeight, 12);
    expect(probabilities.clubClearLeaderProbabilities['club-b']).toBeCloseTo(
      secondWeight / totalWeight,
      12
    );
    expect(probabilities.noClearLeaderProbability).toBe(0);
  });

  it('aggregates unequal weights into exhaustive mutually exclusive outcomes and degenerate bounds', () => {
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 10,
        draws: [
          { drawKey: 'draw-a', probabilityWeight: 0.2, observations: [100, 0, 0] },
          { drawKey: 'draw-b', probabilityWeight: 0.3, observations: [0, 100, 0] },
          { drawKey: 'draw-no-clear', probabilityWeight: 0.5, observations: [100, 95, 0] },
        ],
      })
    );
    if (result.status !== 'available') throw new Error('Expected an available comparison.');

    expect(result.probabilities).toEqual({
      clubClearLeaderProbabilities: [
        { aflClubId: 'club-a', probability: 0.2 },
        { aflClubId: 'club-b', probability: 0.3 },
        { aflClubId: 'club-c', probability: 0 },
      ],
      noClearLeaderProbability: 0.5,
    });
    expect(
      result.probabilities.clubClearLeaderProbabilities.reduce(
        (sum, probability) => sum + probability.probability,
        result.probabilities.noClearLeaderProbability
      )
    ).toBe(1);
    expect(result.unconditionalBounds).toEqual({
      clubClearLeaderBounds: [
        { aflClubId: 'club-a', lower: 0.2, upper: 0.2 },
        { aflClubId: 'club-b', lower: 0.3, upper: 0.3 },
        { aflClubId: 'club-c', lower: 0, upper: 0 },
      ],
      noClearLeaderBounds: { lower: 0.5, upper: 0.5 },
    });
  });

  it('retains an extreme positive outcome weight through compensated accumulation', () => {
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 10,
        draws: [
          { drawKey: 'draw-a-tiny', probabilityWeight: 1e-16, observations: [100, 0, 0] },
          { drawKey: 'draw-b', probabilityWeight: 0.5, observations: [0, 100, 0] },
          {
            drawKey: 'draw-no-clear',
            probabilityWeight: 0.4999999999999999,
            observations: [100, 95, 0],
          },
        ],
      })
    );
    const probabilities = availableProbabilityProjection(result);
    const total =
      Object.values(probabilities.clubClearLeaderProbabilities).reduce(
        (sum, probability) => sum + probability,
        0
      ) + probabilities.noClearLeaderProbability;

    expect(probabilities.clubClearLeaderProbabilities['club-a']).toBeGreaterThan(0);
    expect(probabilities.clubClearLeaderProbabilities['club-a']).toBeCloseTo(1e-16, 20);
    expect(total).toBeCloseTo(1, 15);
  });

  it('preserves outcome measures when an equivalent draw is split while retaining honest counts', () => {
    const baseInput = comparisonInput({
      aflClubIds: ['club-a', 'club-b'],
      clearLeaderToleranceQuanta: 0,
      draws: [
        { drawKey: 'draw-a', probabilityWeight: 0.4, observations: [1, 0] },
        { drawKey: 'draw-b', probabilityWeight: 0.6, observations: [0, 1] },
      ],
    });
    const splitInput = comparisonInput({
      aflClubIds: ['club-a', 'club-b'],
      clearLeaderToleranceQuanta: 0,
      draws: [
        { drawKey: 'draw-a-1', probabilityWeight: 0.1, observations: [1, 0] },
        { drawKey: 'draw-a-2', probabilityWeight: 0.3, observations: [1, 0] },
        { drawKey: 'draw-b', probabilityWeight: 0.6, observations: [0, 1] },
      ],
    });
    const base = calculateAflTradeJointOutcomeComparison(baseInput);
    const split = calculateAflTradeJointOutcomeComparison(splitInput);

    expect(outcomeMeasureProjection(split)).toEqual(outcomeMeasureProjection(base));
    expect(base.drawCount).toBe(2);
    expect(split.drawCount).toBe(3);
  });

  it('treats tiny positive missing mass from a distant lower party as structurally unavailable', () => {
    const missingMass = 1e-12;
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 10,
        draws: [
          {
            drawKey: 'draw-available',
            probabilityWeight: 1 - missingMass,
            observations: [100, 89, 0],
          },
          {
            drawKey: 'draw-missing-lower-party',
            probabilityWeight: missingMass,
            observations: [100, 89, { reasonCodes: ['lower-party-source-missing'] }],
          },
        ],
      })
    );
    if (result.status !== 'unavailable') throw new Error('Expected structural unavailability.');

    expect(result.availableProbabilityMass).toBeCloseTo(1 - missingMass, 14);
    expect(result.unavailableProbabilityMass).toBeCloseTo(missingMass, 18);
    expect(result.conditionalOnAvailableProbabilities).toEqual({
      clubClearLeaderProbabilities: [
        { aflClubId: 'club-a', probability: 1 },
        { aflClubId: 'club-b', probability: 0 },
        { aflClubId: 'club-c', probability: 0 },
      ],
      noClearLeaderProbability: 0,
    });
    expect(result.reasonCodes).toEqual(['lower-party-source-missing']);
    expectUnavailableBoundsAlgebra(result);
  });

  it('derives conditional probabilities and unconditional bounds from partial probability mass', () => {
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 10,
        draws: [
          { drawKey: 'draw-a', probabilityWeight: 0.3, observations: [100, 0, 0] },
          { drawKey: 'draw-no-clear', probabilityWeight: 0.2, observations: [100, 95, 0] },
          {
            drawKey: 'draw-unavailable',
            probabilityWeight: 0.5,
            observations: [100, 0, { reasonCodes: ['source-missing'] }],
          },
        ],
      })
    );
    if (result.status !== 'unavailable') throw new Error('Expected structural unavailability.');

    expect(result.availableProbabilityMass).toBe(0.5);
    expect(result.unavailableProbabilityMass).toBe(0.5);
    expect(result.conditionalOnAvailableProbabilities).toEqual({
      clubClearLeaderProbabilities: [
        { aflClubId: 'club-a', probability: 0.6 },
        { aflClubId: 'club-b', probability: 0 },
        { aflClubId: 'club-c', probability: 0 },
      ],
      noClearLeaderProbability: 0.4,
    });
    expectUnavailableBoundsAlgebra(result);

    const upperMass =
      result.unconditionalBounds.clubClearLeaderBounds.reduce(
        (sum, bound) => sum + bound.upper,
        0
      ) + result.unconditionalBounds.noClearLeaderBounds.upper;
    expect(upperMass).toBeCloseTo(2.5, 14);
    expect(upperMass).not.toBeCloseTo(1, 14);
  });

  it('represents wholly unavailable probability mass without conditional probabilities', () => {
    const result = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 10,
        draws: [
          {
            drawKey: 'draw-unavailable',
            probabilityWeight: 1,
            observations: [
              { reasonCodes: ['reason-b', 'reason-d'] },
              { reasonCodes: ['reason-a', 'reason-c'] },
              0,
            ],
          },
        ],
      })
    );
    if (result.status !== 'unavailable') throw new Error('Expected structural unavailability.');

    expect(result.availableProbabilityMass).toBe(0);
    expect(result.unavailableProbabilityMass).toBe(1);
    expect(result.conditionalOnAvailableProbabilities).toBeNull();
    expect(result.reasonCodes).toEqual(['reason-a', 'reason-b', 'reason-c', 'reason-d']);
    expect(result.unconditionalBounds.clubClearLeaderBounds).toEqual([
      { aflClubId: 'club-a', lower: 0, upper: 1 },
      { aflClubId: 'club-b', lower: 0, upper: 1 },
      { aflClubId: 'club-c', lower: 0, upper: 1 },
    ]);
    expect(result.unconditionalBounds.noClearLeaderBounds).toEqual({ lower: 0, upper: 1 });
    expectUnavailableBoundsAlgebra(result);
  });

  it('fails closed when the aggregated unavailable reason union exceeds its output ceiling', () => {
    const firstReasons = Array.from(
      { length: 100 },
      (_, index) => `reason-${String(index).padStart(3, '0')}`
    );
    const input = comparisonInput({
      aflClubIds: ['club-a', 'club-b'],
      clearLeaderToleranceQuanta: 0,
      draws: [
        {
          drawKey: 'draw-unavailable',
          probabilityWeight: 1,
          observations: [{ reasonCodes: firstReasons }, { reasonCodes: ['reason-100'] }],
        },
      ],
    });

    expect(() => calculateAflTradeJointOutcomeComparison(input)).toThrow(
      'Joint outcome unavailable reason-code union exceeds 100.'
    );
  });

  it('is deterministic across mixed code-unit identifiers, draw permutations, and repeated runs', () => {
    const aflClubIds = ['club-10', 'club-2', 'club-A', 'club-a'];
    const draws: FixtureDraw[] = [
      { drawKey: 'draw-a', probabilityWeight: 0.1, observations: [100, 0, 0, 0] },
      { drawKey: 'draw-2', probabilityWeight: 0.2, observations: [0, 100, 0, 0] },
      { drawKey: 'draw-A', probabilityWeight: 0.3, observations: [0, 0, 100, 0] },
      { drawKey: 'draw-10', probabilityWeight: 0.4, observations: [0, 0, 0, 100] },
    ];
    const forwardInput = comparisonInput({
      aflClubIds,
      clearLeaderToleranceQuanta: 0,
      draws,
    });
    const reverseInput = comparisonInput({
      aflClubIds,
      clearLeaderToleranceQuanta: 0,
      draws: [...draws].reverse(),
    });

    const first = calculateAflTradeJointOutcomeComparison(forwardInput);
    const repeated = calculateAflTradeJointOutcomeComparison(forwardInput);
    const reversed = calculateAflTradeJointOutcomeComparison(reverseInput);

    expect(repeated).toEqual(first);
    expect(reversed).toEqual(first);
    expect(availableProbabilityProjection(first)).toEqual({
      clubClearLeaderProbabilities: {
        'club-10': 0.1,
        'club-2': 0.2,
        'club-A': 0.3,
        'club-a': 0.4,
      },
      noClearLeaderProbability: 0,
    });
  });

  it('does not mutate deeply frozen input', () => {
    const input = comparisonInput({
      aflClubIds: ['club-a', 'club-b', 'club-c'],
      clearLeaderToleranceQuanta: 10,
      draws: [
        { drawKey: 'draw-a', probabilityWeight: 0.4, observations: [100, 0, 0] },
        { drawKey: 'draw-b', probabilityWeight: 0.6, observations: [0, 100, 0] },
      ],
    });
    const before = structuredClone(input);
    deepFreeze(input);

    expect(() => calculateAflTradeJointOutcomeComparison(input)).not.toThrow();
    expect(input).toEqual(before);
  });

  it('maps outcome probabilities equivariantly when AFL club identifiers are relabelled', () => {
    const original = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 10,
        draws: [
          { drawKey: 'draw-a', probabilityWeight: 0.4, observations: [100, 0, 0] },
          { drawKey: 'draw-b', probabilityWeight: 0.3, observations: [0, 100, 0] },
          { drawKey: 'draw-no-clear', probabilityWeight: 0.3, observations: [100, 95, 0] },
        ],
      })
    );
    const relabelled = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-x', 'club-y', 'club-z'],
        clearLeaderToleranceQuanta: 10,
        draws: [
          { drawKey: 'draw-a', probabilityWeight: 0.4, observations: [0, 0, 100] },
          { drawKey: 'draw-b', probabilityWeight: 0.3, observations: [100, 0, 0] },
          { drawKey: 'draw-no-clear', probabilityWeight: 0.3, observations: [95, 0, 100] },
        ],
      })
    );

    expect(availableProbabilityProjection(original)).toEqual({
      clubClearLeaderProbabilities: { 'club-a': 0.4, 'club-b': 0.3, 'club-c': 0 },
      noClearLeaderProbability: 0.3,
    });
    expect(availableProbabilityProjection(relabelled)).toEqual({
      clubClearLeaderProbabilities: { 'club-x': 0.3, 'club-y': 0, 'club-z': 0.4 },
      noClearLeaderProbability: 0.3,
    });
  });

  it('preserves outcomes under bounded translation and positive integer scaling', () => {
    const base = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 20,
        draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: [-100, 0, 50] }],
      })
    );
    const translated = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 20,
        draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: [900, 1000, 1050] }],
      })
    );
    const scaled = calculateAflTradeJointOutcomeComparison(
      comparisonInput({
        aflClubIds: ['club-a', 'club-b', 'club-c'],
        clearLeaderToleranceQuanta: 60,
        draws: [{ drawKey: 'draw-a', probabilityWeight: 1, observations: [-300, 0, 150] }],
      })
    );

    expect(translated).toEqual(base);
    expect(outcomeMeasureProjection(scaled)).toEqual(outcomeMeasureProjection(base));
  });
});
