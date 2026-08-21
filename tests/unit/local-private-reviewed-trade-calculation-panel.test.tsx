import { render, screen, within } from '@testing-library/react';

import { LocalPrivateReviewedTradeCalculationPanel } from '@/app/dev/afl-trade-evaluation/[tradeId]/LocalPrivateReviewedTradeCalculationPanel';
import type { LocalPrivateReviewedTradeCalculation } from '@/server/aflTradeIntelligence/development/localPrivateReviewedTradeCalculation';

const asset = {
  id: 'asset-player',
  tradeId: 'workbook-2024-example',
  year: 2024,
  clubSlug: 'st-kilda',
  clubName: 'St Kilda',
  assetIndex: 1,
  assetType: 'player' as const,
  assetText: 'Player One',
  playerName: 'Player One',
  pick: {
    code: null,
    numberGiven: null,
    year: null,
    round: null,
    originalClub: null,
    numberActual: null,
  },
  draftedPlayer: null,
  games: null,
  note: null,
};

const available = {
  state: 'available' as const,
  score: 12.5,
  gamesPlayed: 11,
  seasons: [2025],
  components: {
    offensiveScore: 100,
    midfieldScore: 200,
    defensiveScore: 300,
    offensivePav: 3.5,
    midfieldPav: 4,
    defensivePav: 5,
  },
  calculationIds: [`private-reviewed-hpn-calculation:${'1'.repeat(64)}`],
  allocationIds: [`private-hpn-allocation:${'2'.repeat(64)}`],
};

const calculation: LocalPrivateReviewedTradeCalculation = {
  projectionId: `local-private-trade-calculation:${'3'.repeat(64)}`,
  tradeId: 'workbook-2024-example',
  workbookSha256: '4'.repeat(64),
  methodId: `private-reviewed-hpn-method:${'5'.repeat(64)}`,
  valueUnit: 'season_pav',
  policy: {
    atTrade: 'latest_reviewed_season_at_or_before_trade_year',
    realized: 'reviewed_seasons_after_trade_year_at_receiving_club',
    remaining: 'unavailable_without_authorized_predictive_model',
    current: 'latest_reviewed_post_trade_season_at_receiving_club',
  },
  assets: [
    {
      asset,
      state: 'calculated',
      canonicalPlayerId: 'local-afl-player:1',
      identityDecisionIds: ['identity-review:1'],
      reviewedSeasonIds: [`hpn-reviewed-season:${'6'.repeat(64)}`],
      postTradeGames: {
        state: 'partial',
        gamesPlayed: 12,
        effectiveThrough: '2026-08-15T00:00:00.000Z',
        source: 'reconciled_acquisition_spell',
        rightCensored: true,
      },
      atTrade: available,
      realized: available,
      remaining: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
      current: available,
    },
    {
      asset: {
        ...asset,
        id: 'asset-pick',
        assetType: 'pick',
        assetText: '#18',
        playerName: null,
      },
      state: 'unavailable',
      reason: 'selection_lineage_not_reviewed',
    },
  ],
  clubTotals: null,
  overallGrade: {
    state: 'unavailable',
    reason: 'asset_values_incomplete_and_distribution_unavailable',
  },
  limitation:
    'Private reviewed historical season PAV only; prediction and publication are unavailable.',
  publicationEligible: false,
  publicationProhibited: true,
};

describe('local private reviewed trade calculation panel', () => {
  it('puts the player score beside the asset and exposes the component explanation', () => {
    render(<LocalPrivateReviewedTradeCalculationPanel calculation={calculation} />);

    expect(
      screen.getByRole('heading', { name: 'Confirmed historical player calculation' })
    ).toBeVisible();
    const player = screen.getByRole('heading', { name: 'Player One' }).closest('li');
    expect(player).not.toBeNull();
    expect(within(player!).getAllByText('12.50')).toHaveLength(3);
    expect(within(player!).getAllByText('Offence')).not.toHaveLength(0);
    expect(within(player!).getAllByText('Midfield')).not.toHaveLength(0);
    expect(within(player!).getAllByText('Defence')).not.toHaveLength(0);
    expect(within(player!).getAllByText('11 games · season 2025')).not.toHaveLength(0);
    expect(within(player!).getByText('12 confirmed post-trade games')).toBeVisible();
    expect(screen.getByText('Overall trade grade: —')).toBeVisible();
    expect(screen.queryByText(/no grade/iu)).not.toBeInTheDocument();
    expect(screen.getByText(/Pick selection lineage has not been reviewed/i)).toBeVisible();
  });
});
