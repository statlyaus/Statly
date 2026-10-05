import { render, screen, within } from '@testing-library/react';

import { LocalPrivateTradeEvaluationGenerationPanel } from '@/app/dev/afl-trade-evaluation/[tradeId]/LocalPrivateTradeEvaluationGenerationPanel';
import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createLocalPrivateTradeEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationContracts';
import { createLocalPrivateTradeEvaluationGenerationV2 } from '@/server/aflTradeIntelligence/valuation/localPrivateTradeEvaluationGenerationV2';

const at = '2026-08-17T05:00:00.000Z';
const evidence = createAflTradeCanonicalJsonArtifactRef({ result: 'confirmed' }, at);
const unavailable = {
  state: 'unavailable' as const,
  reasons: ['predictive_model_not_authorized' as const],
  evidenceRefs: [],
};
const generation = createLocalPrivateTradeEvaluationGeneration({
  valuationScopeKey: 'afl-men:2021-trades',
  tradeId: 'workbook-2021-e7f7d1484744f855',
  workbookSha256: '1'.repeat(64),
  dependencyRefs: [evidence],
  confirmedResultArtifact: evidence,
  valueUnitId: 'hpn-season-pav/v1',
  assets: [
    {
      assetId: 'asset-dawson',
      assetKind: 'player',
      canonicalPlayerId: 'local-afl-player:afl-tables:12516',
      sendingClubId: 'local-afl-club:sydney',
      receivingClubId: 'local-afl-club:adelaide',
      label: 'Jordan Dawson',
      appearances: {
        state: 'observed',
        gamesPlayed: 92,
        coverage: 'right_censored',
        effectiveThroughSeason: 2025,
        evidenceRefs: [evidence],
      },
      views: {
        atTrade: {
          state: 'unavailable',
          reasons: ['source_rights_not_approved'],
          evidenceRefs: [],
        },
        realized: {
          state: 'calculated',
          score: 84.10058692299,
          gamesPlayed: 92,
          components: {
            offensiveScore: 1034,
            midfieldScore: 14676,
            defensiveScore: 7955,
            offensivePav: 24.604135356408,
            midfieldPav: 34.157864473676,
            defensivePav: 25.338587092906,
          },
          evidenceRefs: [evidence],
        },
        remaining: unavailable,
        current: unavailable,
      },
    },
    {
      assetId: 'asset-weddle-pick',
      assetKind: 'future_pick',
      canonicalPlayerId: null,
      sendingClubId: 'local-afl-club:adelaide',
      receivingClubId: 'local-afl-club:sydney',
      label: '#2022R1 (Melbourne) (#18 - Weddle - 60 games)',
      appearances: {
        state: 'unavailable',
        reasons: ['calculation_evidence_incomplete'],
        evidenceRefs: [],
      },
      views: {
        atTrade: {
          state: 'unavailable',
          reasons: ['source_rights_not_approved'],
          evidenceRefs: [],
        },
        realized: {
          state: 'unavailable',
          reasons: ['pick_selection_not_confirmed'],
          evidenceRefs: [],
        },
        remaining: unavailable,
        current: unavailable,
      },
    },
  ],
  clubTotals: null,
  overallGrade: { state: 'unavailable', reasons: ['asset_values_incomplete'], evidenceRefs: [] },
  generatedAt: at,
});

const v2Value = (score: number) => ({
  score,
  distribution: { mean: score, median: score, p10: score - 5, p90: score + 5 },
  evidenceRefs: [evidence],
});
const v2AssetView = (score: number) => ({
  state: 'calculated' as const,
  ...v2Value(score),
  components: [
    {
      componentId: 'hpn:total-pav',
      label: 'Total PAV',
      score,
      evidenceRefs: [evidence],
    },
  ],
  calculationRefs: [evidence],
});
const generationV2 = createLocalPrivateTradeEvaluationGenerationV2({
  valuationScopeKey: 'afl-men:2025-trades',
  tradeId: 'workbook-2025-governed-v2',
  workbookSha256: '2'.repeat(64),
  dependencyRefs: [evidence],
  confirmedResultArtifact: evidence,
  valueUnitId: 'season_pav',
  assets: [
    {
      assetId: 'asset-flanders',
      assetKind: 'player',
      canonicalPlayerId: 'local-afl-player:sam-flanders',
      sendingClubId: 'local-afl-club:gold-coast',
      receivingClubId: 'local-afl-club:st-kilda',
      label: 'Sam Flanders',
      evidenceHorizons: [
        {
          kind: 'current_season',
          season: 2026,
          gamesPlayed: 12,
          coverage: 'right_censored',
          effectiveThrough: '2026-08-05',
          evidenceRefs: [evidence],
        },
      ],
      views: {
        atTrade: v2AssetView(10),
        realized: v2AssetView(20),
        remaining: v2AssetView(5),
        current: v2AssetView(25),
      },
    },
  ],
  clubTotals: [
    {
      clubId: 'local-afl-club:gold-coast',
      views: {
        atTrade: { state: 'calculated', received: v2Value(0), givenUp: v2Value(10), net: v2Value(-10) },
        realized: { state: 'calculated', received: v2Value(0), givenUp: v2Value(20), net: v2Value(-20) },
        remaining: { state: 'calculated', received: v2Value(0), givenUp: v2Value(5), net: v2Value(-5) },
        current: { state: 'calculated', received: v2Value(0), givenUp: v2Value(25), net: v2Value(-25) },
      },
    },
    {
      clubId: 'local-afl-club:st-kilda',
      views: {
        atTrade: { state: 'calculated', received: v2Value(10), givenUp: v2Value(0), net: v2Value(10) },
        realized: { state: 'calculated', received: v2Value(20), givenUp: v2Value(0), net: v2Value(20) },
        remaining: { state: 'calculated', received: v2Value(5), givenUp: v2Value(0), net: v2Value(5) },
        current: { state: 'calculated', received: v2Value(25), givenUp: v2Value(0), net: v2Value(25) },
      },
    },
  ],
  overallGrades: [
    {
      clubId: 'local-afl-club:gold-coast',
      state: 'provisional',
      grade: 'D',
      normalizedPerformance: 0.1,
      finishesAheadProbability: 0.1,
      evidenceRefs: [evidence],
    },
    {
      clubId: 'local-afl-club:st-kilda',
      state: 'provisional',
      grade: 'A',
      normalizedPerformance: 0.8,
      finishesAheadProbability: 0.8,
      evidenceRefs: [evidence],
    },
  ],
  tradeVerdict: {
    state: 'calculated',
    kind: 'favours_club',
    clubIds: ['local-afl-club:st-kilda'],
    practicalEquivalenceProbability: 0.1,
    evidenceRefs: [evidence],
  },
  generatedAt: at,
});

describe('local private trade evaluation generation panel', () => {
  it('shows every asset and four views with scores and honest blockers', () => {
    render(<LocalPrivateTradeEvaluationGenerationPanel generation={generation} />);

    const dawson = screen.getByRole('heading', { name: 'Jordan Dawson' }).closest('li');
    expect(dawson).not.toBeNull();
    expect(within(dawson!).getByText('84.10')).toBeVisible();
    expect(within(dawson!).getByText('92 confirmed games')).toBeVisible();
    for (const view of ['At trade', 'Realized', 'Remaining', 'Current']) {
      expect(within(dawson!).getByRole('heading', { name: view })).toBeVisible();
    }

    const pick = screen
      .getByRole('heading', { name: '#2022R1 (Melbourne) (#18 - Weddle - 60 games)' })
      .closest('li');
    expect(pick).not.toBeNull();
    expect(
      within(pick!).getByText(/recorded pick settlement still requires canonical realization/i)
    ).toBeVisible();
    expect(screen.getByText('Overall trade grade: unavailable')).toBeVisible();
  });

  it('shows v2 uncertainty, right-censored evidence, per-club grades, and verdict', () => {
    render(<LocalPrivateTradeEvaluationGenerationPanel generation={generationV2} />);

    expect(screen.getByRole('heading', { name: 'Sam Flanders' })).toBeVisible();
    expect(screen.getByText(/12 confirmed appearances through 5 Aug 2026/i)).toBeVisible();
    expect(screen.getByText(/right-censored/i)).toBeVisible();
    expect(screen.getByText('20.00–30.00')).toBeVisible();
    expect(screen.getByText('St Kilda')).toBeVisible();
    expect(screen.getByText('Provisional A')).toBeVisible();
    expect(screen.getByText(/favours st kilda/i)).toBeVisible();
  });
});
