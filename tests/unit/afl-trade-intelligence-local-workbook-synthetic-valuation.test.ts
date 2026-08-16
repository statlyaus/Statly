import { describe, expect, it } from 'vitest';

import type { DraftTradeDetail } from '@/lib/draftTrades/firestore';
import { prepareLocalWorkbookSyntheticValuation } from '@/server/aflTradeIntelligence/development/localWorkbookSyntheticValuation';

const valuationBundleId = `valuation-bundle:${'c'.repeat(64)}`;
const workbookSha256 = 'd'.repeat(64);

function detail(
  clubs: readonly string[],
  assetTypes: readonly ('player' | 'pick' | 'future_pick' | 'unknown')[]
): DraftTradeDetail {
  const tradeId = `workbook-2025-${clubs.length}-party`;
  const slugs = clubs.map((club) => club.toLowerCase().replaceAll(' ', '-'));
  return {
    trade: {
      tradeId,
      year: 2025,
      seqInYear: 1,
      title: 'Private workbook test trade',
      clubSlugs: slugs,
      clubNames: [...clubs],
      partyCount: clubs.length,
      assetCount: assetTypes.length,
      hasPlayers: assetTypes.includes('player'),
      hasPicks: assetTypes.includes('pick') || assetTypes.includes('future_pick'),
      hasFuturePicks: assetTypes.includes('future_pick'),
      receivesByClub: [],
    },
    parties: clubs.map((clubName, index) => ({
      id: `${tradeId}-party-${index + 1}`,
      tradeId,
      year: 2025,
      seqInYear: 1,
      tradeTitle: 'Private workbook test trade',
      clubSlug: slugs[index]!,
      clubName,
      rowOrder: index + 1,
      assetsRaw: `Asset ${index + 1}`,
      expected: null,
      actual: null,
    })),
    assets: assetTypes.map((assetType, index) => ({
      id: `${tradeId}-asset-${index + 1}`,
      tradeId,
      year: 2025,
      clubSlug: slugs[index % slugs.length]!,
      clubName: clubs[index % clubs.length]!,
      assetIndex: index + 1,
      assetType,
      assetText: `Asset ${index + 1}`,
      playerName: assetType === 'player' ? `Player ${index + 1}` : null,
      pick: {
        code: assetType === 'player' || assetType === 'unknown' ? null : `${index + 1}`,
        numberGiven: assetType === 'pick' ? index + 1 : null,
        year: assetType === 'future_pick' ? 2026 : null,
        round: assetType === 'future_pick' ? 1 : null,
        originalClub: null,
        numberActual: null,
      },
      draftedPlayer: null,
      games: null,
      note: null,
    })),
  };
}

function prepare(trade: DraftTradeDetail) {
  return prepareLocalWorkbookSyntheticValuation({
    environment: 'test_fixture',
    trade,
    workbookSha256,
    valuationBundleId,
    scenario: 'baseline',
    assessedAt: '2026-08-05T04:30:00.000Z',
  });
}

describe('local workbook synthetic valuation adapter', () => {
  it('makes the missing sender in a two-party workbook trade an explicit assumption', () => {
    const prepared = prepare(detail(['Adelaide', 'St Kilda'], ['player', 'future_pick']));

    expect(prepared.state).toBe('ready');
    if (prepared.state !== 'ready') throw new Error('Expected the fixture to be ready.');
    expect(prepared.scenario.assumptionSet.content.transferDirections).toEqual([
      expect.objectContaining({
        fromClubId: 'afl-club:st-kilda',
        toClubId: 'afl-club:adelaide',
        directionBasis: 'two_party_other_club_assumption',
      }),
      expect.objectContaining({
        fromClubId: 'afl-club:adelaide',
        toClubId: 'afl-club:st-kilda',
        directionBasis: 'two_party_other_club_assumption',
      }),
    ]);
    expect(prepared.explanation.state).toBe('available');
    if (prepared.explanation.state !== 'available') {
      throw new Error('Expected the synthetic explanation to be available.');
    }
    expect(prepared.explanation.document).toMatchObject({
      schemaVersion: 'afl-trade-valuation-explanation/v1',
      defaultView: 'current',
      authority: {
        kind: 'private_synthetic',
        assumptionSetId: prepared.scenario.assumptionSet.assumptionSetId,
        publicationProhibited: true,
      },
      coverage: { status: 'complete', ratio: 1 },
      methodology: {
        additiveStatistic: 'probability_weighted_mean',
        packageMedianIsAdditive: false,
        assetGradeTreatment: 'prohibited',
      },
    });
    expect(prepared.explanation.document.views).toHaveLength(4);
    expect(
      prepared.explanation.document.views.every((view) =>
        view.clubs.every(
          ({ received, givenUp, net }) =>
            Number.isFinite(received.additiveMean) &&
            Number.isFinite(givenUp.additiveMean) &&
            Number.isFinite(net.additiveMean)
        )
      )
    ).toBe(true);
    expect(prepared.summary.views).toEqual(
      prepared.explanation.document.views.map(({ view, clubs }) => ({
        view,
        parties: clubs.map(({ aflClubId, clubName, received, givenUp, net }) => ({
          aflClubId,
          clubName,
          received: received.additiveMean,
          givenUp: givenUp.additiveMean,
          netAdvantage: net.additiveMean,
        })),
      }))
    );
  });

  it('uses a declared deterministic transfer map for multi-party workbook fixtures', () => {
    const prepared = prepare(
      detail(['Adelaide', 'Brisbane', 'Carlton'], ['player', 'pick', 'future_pick'])
    );

    expect(prepared.state).toBe('ready');
    if (prepared.state !== 'ready') throw new Error('Expected the fixture to be ready.');
    expect(
      prepared.scenario.assumptionSet.content.transferDirections.every(
        ({ directionBasis }) => directionBasis === 'deterministic_fixture_transfer_map_v1'
      )
    ).toBe(true);
    expect(prepared.scenario.valuationCase.content.parties).toHaveLength(3);
  });

  it('keeps malformed or unsupported workbook trades unavailable', () => {
    const prepared = prepare(detail(['Adelaide', 'St Kilda'], ['unknown', 'player']));

    expect(prepared).toEqual({
      state: 'unavailable',
      reason: 'unsupported_asset_kind',
      tradeId: 'workbook-2025-2-party',
      publicationEligible: false,
    });
  });

  it('rejects any attempt to prepare a workbook scenario outside test-fixture runtime', () => {
    expect(() =>
      prepareLocalWorkbookSyntheticValuation({
        environment: 'production' as never,
        trade: detail(['Adelaide', 'St Kilda'], ['player', 'player']),
        workbookSha256,
        valuationBundleId,
        scenario: 'baseline',
        assessedAt: '2026-08-05T04:30:00.000Z',
      })
    ).toThrow('restricted to test_fixture');
  });
});
