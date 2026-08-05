import { describe, expect, it } from 'vitest';

import {
  fitAflTradeWeightedNonIncreasingIsotonic,
  type AflTradeWeightedIsotonicPoint,
} from '@/server/aflTradeIntelligence/modeling/weightedIsotonic';

describe('AFL trade-intelligence weighted non-increasing isotonic regression', () => {
  it('solves a known adjacent violation exactly', () => {
    const fit = fitAflTradeWeightedNonIncreasingIsotonic([
      { pointId: 'pick-1', x: 1, value: 3, weight: 1 },
      { pointId: 'pick-2', x: 2, value: 1, weight: 1 },
      { pointId: 'pick-3', x: 3, value: 2, weight: 1 },
    ]);

    expect(fit.blocks).toEqual([
      {
        blockIndex: 0,
        minimumX: 1,
        maximumX: 1,
        fittedValue: 3,
        totalWeight: 1,
        sourcePointCount: 1,
        pointIds: ['pick-1'],
      },
      {
        blockIndex: 1,
        minimumX: 2,
        maximumX: 3,
        fittedValue: 1.5,
        totalWeight: 2,
        sourcePointCount: 2,
        pointIds: ['pick-2', 'pick-3'],
      },
    ]);
    expect(fit.fittedPoints.map(({ fittedValue }) => fittedValue)).toEqual([3, 1.5, 1.5]);
  });

  it('uses information weights when aggregating duplicate coordinates and pooling', () => {
    const fit = fitAflTradeWeightedNonIncreasingIsotonic([
      { pointId: 'pick-1-a', x: 1, value: 4, weight: 1 },
      { pointId: 'pick-1-b', x: 1, value: 2, weight: 3 },
      { pointId: 'pick-2', x: 2, value: 3, weight: 1 },
    ]);

    expect(fit.blocks).toEqual([
      {
        blockIndex: 0,
        minimumX: 1,
        maximumX: 2,
        fittedValue: 2.6,
        totalWeight: 5,
        sourcePointCount: 3,
        pointIds: ['pick-1-a', 'pick-1-b', 'pick-2'],
      },
    ]);
  });

  it('is input-order invariant and leaves already monotonic values unchanged', () => {
    const points: AflTradeWeightedIsotonicPoint[] = [
      { pointId: 'one', x: 1, value: 5, weight: 1 },
      { pointId: 'two', x: 2, value: 4, weight: 2 },
      { pointId: 'three', x: 3, value: 4, weight: 3 },
      { pointId: 'four', x: 4, value: -1, weight: 1 },
    ];

    const forward = fitAflTradeWeightedNonIncreasingIsotonic(points);
    const reverse = fitAflTradeWeightedNonIncreasingIsotonic([...points].reverse());

    expect(forward).toEqual(reverse);
    expect(forward.blocks.map(({ fittedValue }) => fittedValue)).toEqual([5, 4, 4, -1]);
  });

  it('pools a fully increasing sequence into its weighted mean', () => {
    const fit = fitAflTradeWeightedNonIncreasingIsotonic([
      { pointId: 'one', x: 1, value: 1, weight: 1 },
      { pointId: 'two', x: 2, value: 2, weight: 2 },
      { pointId: 'three', x: 3, value: 3, weight: 1 },
    ]);

    expect(fit.blocks).toHaveLength(1);
    expect(fit.blocks[0]).toMatchObject({
      minimumX: 1,
      maximumX: 3,
      fittedValue: 2,
      totalWeight: 4,
    });
  });

  it('does not mutate inputs and normalizes negative zero outputs', () => {
    const points: AflTradeWeightedIsotonicPoint[] = [
      { pointId: 'one', x: 1, value: -0, weight: 1 },
      { pointId: 'two', x: 2, value: -0, weight: 1 },
    ];
    const before = structuredClone(points);

    const fit = fitAflTradeWeightedNonIncreasingIsotonic(points);

    expect(points).toEqual(before);
    expect(Object.is(fit.blocks[0].fittedValue, -0)).toBe(false);
    expect(Object.is(fit.fittedPoints[0].observedValue, -0)).toBe(false);
  });

  it('rejects empty, non-finite, non-positive, and duplicate-identity inputs', () => {
    expect(() => fitAflTradeWeightedNonIncreasingIsotonic([])).toThrow(/at least one/i);
    expect(() =>
      fitAflTradeWeightedNonIncreasingIsotonic([
        { pointId: 'bad', x: Number.NaN, value: 1, weight: 1 },
      ])
    ).toThrow(/finite/i);
    expect(() =>
      fitAflTradeWeightedNonIncreasingIsotonic([{ pointId: 'bad', x: 1, value: 1, weight: 0 }])
    ).toThrow(/positive weight/i);
    expect(() =>
      fitAflTradeWeightedNonIncreasingIsotonic([
        { pointId: 'duplicate', x: 1, value: 1, weight: 1 },
        { pointId: 'duplicate', x: 2, value: 2, weight: 1 },
      ])
    ).toThrow(/unique/i);
  });
});
