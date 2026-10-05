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
  allocationIds: [],
};

const calculation: LocalPrivateReviewedTradeCalculation = {
  projectionId: `local-private-trade-calculation:${'3'.repeat(64)}`,
  tradeId: 'workbook-2024-example',
  workbookSha256: '4'.repeat(64),
  methodId: `private-reviewed-hpn-method:${'5'.repeat(64)}`,
  valueUnit: 'season_pav',
  policy: {
    atTrade: 'unavailable_without_authorized_historical_value_model',
    realized: 'reviewed_seasons_after_trade_year_at_receiving_club',
    remaining: 'unavailable_without_authorized_predictive_model',
    current: 'unavailable_without_authorized_predictive_model',
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
        effectiveThroughSeason: 2025,
        source: 'reconciled_acquisition_spell',
        rightCensored: true,
      },
      atTrade: { state: 'unavailable', reason: 'historical_value_model_not_authorized' },
      realized: available,
      remaining: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
      current: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
    },
    {
      asset: {
        ...asset,
        id: 'asset-pick',
        assetType: 'pick',
        assetText: '#7 (#12 - Pickett - 0 games)',
        playerName: null,
        pick: { ...asset.pick, code: '7', numberGiven: 7, numberActual: 12 },
        draftedPlayer: 'Pickett',
      },
      state: 'calculated',
      canonicalPlayerId: 'local-afl-player:2',
      identityDecisionIds: ['identity-review:2'],
      reviewedSeasonIds: [`hpn-reviewed-season:${'7'.repeat(64)}`],
      selectionLineageDecisionId: `local-workbook-selection-lineage:${'8'.repeat(64)}`,
      postTradeGames: {
        state: 'unavailable',
        reason: 'reviewed_acquisition_outcome_unavailable',
      },
      atTrade: {
        state: 'unavailable',
        reason: 'selection_value_model_not_authorized',
      },
      realized: available,
      remaining: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
      current: { state: 'unavailable', reason: 'predictive_model_not_authorized' },
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
      screen.getByRole('heading', { name: 'Confirmed realized asset calculation' })
    ).toBeVisible();
    const player = screen.getByRole('heading', { name: 'Player One' }).closest('li');
    expect(player).not.toBeNull();
    expect(within(player!).getAllByText('12.50')).toHaveLength(1);
    expect(within(player!).getAllByText('Offence')).not.toHaveLength(0);
    expect(within(player!).getAllByText('Midfield')).not.toHaveLength(0);
    expect(within(player!).getAllByText('Defence')).not.toHaveLength(0);
    expect(within(player!).getAllByText('11 games · season 2025')).not.toHaveLength(0);
    expect(
      within(player!).getByText('1 authenticated calculation artifact')
    ).toBeInTheDocument();
    expect(within(player!).queryByText(/0 allocations/i)).not.toBeInTheDocument();
    expect(within(player!).getByText('12 confirmed post-trade games')).toBeVisible();
    expect(
      within(player!).getByText('Reviewed through 2025 season · active spell, later games not included')
    ).toBeVisible();
    expect(within(player!).queryByText(/Through 2026-08-15/i)).not.toBeInTheDocument();
    expect(screen.getByText('Overall trade grade: unavailable')).toBeVisible();
    const pick = screen
      .getByRole('heading', { name: '#7 (#12 - Pickett - 0 games)' })
      .closest('li');
    expect(pick).not.toBeNull();
    expect(within(pick!).getByText(/Selection #12 · Pickett/i)).toBeVisible();
    expect(within(pick!).getByText('Selected player PAV')).toBeVisible();
    expect(
      within(pick!).getByText(/Expected selection value requires an authorized pick model/i)
    ).toBeVisible();
  });
});
