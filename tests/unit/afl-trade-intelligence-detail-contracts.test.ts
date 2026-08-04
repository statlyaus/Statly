import { describe, expect, it } from 'vitest';

import {
  aflTradeAssetBreakdownSchema,
  aflTradeLineageSummarySchema,
} from '@/types/aflTradeIntelligence';

function asset() {
  return {
    assetId: 'fixture-asset-a',
    assetKind: 'player' as const,
    label: 'Fabricated player A',
    receivedByAflClubId: 'fixture-club-a',
    lineage: {
      status: 'resolved' as const,
      rootAssetId: 'fixture-asset-a',
      creditedAssetIds: ['fixture-asset-a'],
      summary: 'Fabricated resolved player lineage.',
    },
    values: [
      {
        status: 'valued' as const,
        view: 'current' as const,
        estimate: 10,
        estimateStatistic: 'mean' as const,
        uncertainty: {
          lower: 7,
          median: 10,
          upper: 13,
          intervalLevel: 0.8,
          components: [
            {
              kind: 'outcome' as const,
              label: 'Outcome variation',
              description: 'Fabricated outcome variation for asset contract testing.',
            },
          ],
        },
        distribution: {
          downside: { quantile: 0.1 as const, value: 6 },
          upside: { quantile: 0.9 as const, value: 14 },
          lowReturn: { threshold: 8, probability: 0.2 },
          eliteOutcome: { threshold: 12, probability: 0.15 },
        },
        factors: [],
        currentComponents: { realizedValue: 6, remainingValue: 4 },
      },
    ],
  };
}

describe('AFL trade-intelligence asset detail contracts', () => {
  it('accepts public AFL asset attribution without fantasy ownership', () => {
    expect(aflTradeAssetBreakdownSchema.safeParse(asset()).success).toBe(true);
    expect(
      aflTradeAssetBreakdownSchema.safeParse({
        ...asset(),
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
        rosterId: 'fixture-roster',
        ownerId: 'fixture-owner',
      }).success
    ).toBe(false);
  });

  it('requires current value to equal realized plus remaining value', () => {
    const value = asset();
    expect(
      aflTradeAssetBreakdownSchema.safeParse({
        ...value,
        values: [
          { ...value.values[0], currentComponents: { realizedValue: 6, remainingValue: 5 } },
        ],
      }).success
    ).toBe(false);
  });

  it('prevents current components from leaking into another temporal view', () => {
    const value = asset();
    expect(
      aflTradeAssetBreakdownSchema.safeParse({
        ...value,
        values: [{ ...value.values[0], view: 'realized' }],
      }).success
    ).toBe(false);
    expect(
      aflTradeAssetBreakdownSchema.safeParse({
        ...value,
        values: [{ ...value.values[0], view: 'realized', currentComponents: null }],
      }).success
    ).toBe(true);
  });

  it('requires the traded asset as lineage root and unique credited assets', () => {
    const value = asset();
    expect(
      aflTradeAssetBreakdownSchema.safeParse({
        ...value,
        lineage: { ...value.lineage, rootAssetId: 'fixture-other-root' },
      }).success
    ).toBe(false);
    expect(
      aflTradeAssetBreakdownSchema.safeParse({
        ...value,
        lineage: {
          ...value.lineage,
          creditedAssetIds: ['fixture-asset-a', 'fixture-asset-a'],
        },
      }).success
    ).toBe(false);
  });

  it('represents unavailable lineage counts as unknown rather than zero', () => {
    const unavailable = {
      status: 'unavailable' as const,
      totalAssetCount: null,
      resolvedAssetCount: null,
      unresolvedAssetCount: null,
      lineageEdgeCount: null,
      maximumDepth: null,
    };
    expect(aflTradeLineageSummarySchema.safeParse(unavailable).success).toBe(true);
    expect(
      aflTradeLineageSummarySchema.safeParse({ ...unavailable, unresolvedAssetCount: 0 }).success
    ).toBe(false);
  });

  it('reconciles partial lineage counts to the total asset count', () => {
    const partial = {
      status: 'partial' as const,
      totalAssetCount: 3,
      resolvedAssetCount: 2,
      unresolvedAssetCount: 1,
      lineageEdgeCount: 2,
      maximumDepth: 2,
    };
    expect(aflTradeLineageSummarySchema.safeParse(partial).success).toBe(true);
    expect(
      aflTradeLineageSummarySchema.safeParse({ ...partial, resolvedAssetCount: 1 }).success
    ).toBe(false);
  });
});
