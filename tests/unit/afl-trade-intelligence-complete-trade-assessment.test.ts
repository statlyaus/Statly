import { describe, expect, it } from 'vitest';

import { assessCompleteAflTrade } from '@/server/aflTradeIntelligence/valuation/completeTradeAssessment';

const base = {
  tradeId: 'trade-2025-1',
  valueUnit: {
    valueUnitId: 'statly-fixed-horizon-contribution/v1',
    shortLabel: 'contribution value',
    explanation:
      'Estimated fixed-horizon AFL contribution in one common unit; higher means more expected on-field contribution.',
  },
  modelVersion: 'statly-trade-model/1.0.0',
  sampleCount: 4,
  assessedAt: '2026-08-09T07:00:00.000Z',
} as const;

describe('complete AFL trade assessment', () => {
  it('explains received, given up and net advantage across the complete exchange', () => {
    const result = assessCompleteAflTrade({
      ...base,
      parties: [
        { clubId: 'club-gws', clubName: 'GWS' },
        { clubId: 'club-western-bulldogs', clubName: 'Western Bulldogs' },
      ],
      transfers: [
        {
          transferId: 'transfer-pick-14',
          fromClubId: 'club-gws',
          toClubId: 'club-western-bulldogs',
          assetId: 'pick-2025-14',
          assetKind: 'pick',
          displayLabel: 'Pick 14 → Harry Kyle',
          resolution: 'linked_to_final_selection',
          atTradeSamples: [60, 70, 80, 90],
          currentSamples: [55, 65, 75, 85],
        },
        {
          transferId: 'transfer-pick-19',
          fromClubId: 'club-western-bulldogs',
          toClubId: 'club-gws',
          assetId: 'pick-2025-19',
          assetKind: 'pick',
          displayLabel: 'Pick 19 → Josh Lindsay',
          resolution: 'linked_to_final_selection',
          atTradeSamples: [30, 40, 50, 60],
          currentSamples: [25, 35, 45, 55],
        },
      ],
    });

    const bulldogs = result.content.partyAssessments.find(
      ({ clubId }) => clubId === 'club-western-bulldogs'
    )!;
    expect(bulldogs.atTrade).toMatchObject({
      received: { median: 75 },
      givenUp: { median: 45 },
      netAdvantage: { median: 30 },
      finishAheadProbability: 1,
    });
    expect(bulldogs.calculationSummary).toBe(
      'Received value minus given-up value equals net advantage; finish-ahead probability compares that net result with every other party in the same simulated outcome.'
    );
    expect(bulldogs.receivedAssets[0].displayLabel).toBe('Pick 14 → Harry Kyle');
    expect(result.content.definitions.netAdvantage).toMatch(/received minus given-up/i);
  });

  it('handles multi-party ties without inventing a single winner and is order independent', () => {
    const input = {
      ...base,
      parties: [
        { clubId: 'club-a', clubName: 'A' },
        { clubId: 'club-b', clubName: 'B' },
        { clubId: 'club-c', clubName: 'C' },
      ],
      transfers: [
        {
          transferId: 't1',
          fromClubId: 'club-c',
          toClubId: 'club-a',
          assetId: 'a1',
          assetKind: 'player' as const,
          displayLabel: 'Player A',
          resolution: 'resolved' as const,
          atTradeSamples: [100, 100, 100, 100],
          currentSamples: [100, 100, 100, 100],
        },
        {
          transferId: 't2',
          fromClubId: 'club-c',
          toClubId: 'club-b',
          assetId: 'b1',
          assetKind: 'player' as const,
          displayLabel: 'Player B',
          resolution: 'resolved' as const,
          atTradeSamples: [100, 100, 100, 100],
          currentSamples: [100, 100, 100, 100],
        },
      ],
    };
    const first = assessCompleteAflTrade(input);
    const reordered = assessCompleteAflTrade({
      ...input,
      parties: [...input.parties].reverse(),
      transfers: [...input.transfers].reverse(),
    });

    expect(first).toEqual(reordered);
    expect(first.content.verdict).toEqual({ kind: 'shared_lead', clubIds: ['club-a', 'club-b'] });
    expect(
      first.content.partyAssessments.find(({ clubId }) => clubId === 'club-a')?.atTrade
        .finishAheadProbability
    ).toBe(0.5);
    expect(
      first.content.partyAssessments.find(({ clubId }) => clubId === 'club-b')?.atTrade
        .finishAheadProbability
    ).toBe(0.5);
  });

  it('fails closed when an asset is unresolved or uses incompatible samples', () => {
    expect(() =>
      assessCompleteAflTrade({
        ...base,
        parties: [
          { clubId: 'club-a', clubName: 'A' },
          { clubId: 'club-b', clubName: 'B' },
        ],
        transfers: [
          {
            transferId: 't1',
            fromClubId: 'club-a',
            toClubId: 'club-b',
            assetId: 'pick-unresolved',
            assetKind: 'pick',
            displayLabel: 'Future first-round pick',
            resolution: 'unresolved',
            atTradeSamples: [1, 2, 3, 4],
            currentSamples: [1, 2, 3, 4],
          },
        ],
      })
    ).toThrow(/unresolved/i);
  });
});
