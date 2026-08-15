import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadTradeMock, notFoundMock } = vi.hoisted(() => ({
  loadTradeMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/server/aflTradeIntelligence/development/localWorkbookEvaluation', () => ({
  localWorkbookEvaluationService: { loadTrade: loadTradeMock },
}));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

import LocalWorkbookTradeEvaluationPage from '../../src/app/dev/afl-trade-evaluation/[tradeId]/page';

const FLANDERS_TRADE_ID = 'workbook-2025-c64962fd1891b951';

function summary(view: 'at_trade' | 'realized' | 'remaining' | 'current') {
  return {
    availability: 'available' as const,
    view,
    modelVintage: view === 'at_trade' ? ('historical_restatement' as const) : ('current' as const),
    unit: {
      id: 'fixture-unit',
      label: 'Fixture value',
      description: 'Fixture-only value for component tests.',
      direction: 'higher_is_better' as const,
    },
    clubValues: [
      {
        aflClubId: 'afl-club:gold-coast',
        clubName: 'Gold Coast',
        expectedValue: 100,
        medianValue: 98,
        interval: { lower: 80, upper: 120, level: 0.8 },
        finishesAheadProbability: 0.7,
      },
      {
        aflClubId: 'afl-club:st-kilda',
        clubName: 'St Kilda',
        expectedValue: 80,
        medianValue: 78,
        interval: { lower: 60, upper: 100, level: 0.8 },
        finishesAheadProbability: 0.2,
      },
    ],
    practicalEquivalenceProbability: 0.1,
    comparisonBasis: 'complete_trade' as const,
    assessment: {
      interpretation: 'leans_to_club' as const,
      favouredAflClubId: 'afl-club:gold-coast',
      scope: 'complete_trade' as const,
    },
    confidence: {
      level: 'moderate' as const,
      dimensions: [
        {
          kind: 'model_calibration' as const,
          level: 'moderate' as const,
          reasonCode: 'fixture-model-moderate',
          explanation: 'Fixture-only model evidence for the development page test.',
        },
      ],
    },
    coverage: { status: 'complete' as const, coverageRatio: 1, excludedAssetCount: 0 },
    methodologyHref: '/draft/trades/methodology',
    warnings: [],
  };
}

function evaluationFixture() {
  return {
    input: {
      originalFilename: 'AFL Drafts Trades.xlsx',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      productionAuthority: 'none',
      publicationAuthority: 'none',
    },
    detail: {
      trade: {
        tradeId: FLANDERS_TRADE_ID,
        year: 2025,
        seqInYear: 1,
        title: '2025 Trade for Sam Flanders',
        clubSlugs: ['gold-coast', 'st-kilda'],
        clubNames: ['Gold Coast', 'St Kilda'],
        partyCount: 2,
        assetCount: 1,
        hasPlayers: true,
        hasPicks: false,
        hasFuturePicks: false,
        receivesByClub: [],
      },
      parties: [
        {
          id: 'party:1',
          tradeId: FLANDERS_TRADE_ID,
          year: 2025,
          seqInYear: 1,
          tradeTitle: '2025 Trade for Sam Flanders',
          clubSlug: 'st-kilda',
          clubName: 'St Kilda',
          rowOrder: 1,
          assetsRaw: 'Flanders (0 games)',
          expected: null,
          actual: null,
        },
      ],
      assets: [
        {
          id: 'asset:1',
          tradeId: FLANDERS_TRADE_ID,
          year: 2025,
          clubSlug: 'st-kilda',
          clubName: 'St Kilda',
          assetIndex: 1,
          assetType: 'player',
          assetText: 'Flanders (0 games)',
          playerName: 'Flanders',
          pick: {
            code: null,
            numberGiven: null,
            year: null,
            round: null,
            originalClub: null,
            numberActual: null,
          },
          draftedPlayer: null,
          games: 0,
          note: null,
        },
      ],
    },
    calculation: {
      calculationId: 'development-trade-value:123',
      tradeId: FLANDERS_TRADE_ID,
      datasetId: 'development-grade-dataset:123',
      modelId: 'development-grade-model:456',
      summaries: {
        at_trade: summary('at_trade'),
        realized: summary('realized'),
        remaining: summary('remaining'),
        current: summary('current'),
      },
      assets: [
        {
          assetId: 'asset:1',
          state: 'valued',
          featureProviders: ['afl_tables'],
          atTradeSampleCount: 40,
        },
      ],
      publicationEligible: false,
    },
    links: [
      {
        assetId: 'asset:1',
        state: 'linked',
        acquisitionId: '2025_0016',
        method: 'player_club_year',
        outcomeEvidence: {
          state: 'unavailable',
          reason: 'no_reconciled_acquisition_spell',
        },
      },
    ],
    model: {
      modelId: 'development-grade-model:456',
      content: {
        schemaVersion: 'afl-trade-development-grade-model/v1',
        datasetId: 'development-grade-dataset:123',
        createdAt: '2026-08-06T08:37:32.121Z',
        minimumCohortSize: 20,
        practicalEquivalenceTolerance: 10,
        outcomeWeights: { games: 1, goals: 0.5, coachesVotes: 1.5, brownlowVotes: 2 },
        providerFeatureTreatment:
          'reconciled_point_in_time_when_available_else_selection_demographic',
        historicalEligibility: 'fixed_horizon_matured_strictly_before_prediction',
        sourceRecordedGradeTreatment: 'prohibited',
        publicationEligible: false,
      },
    },
    scenario: {
      state: 'ready',
      tradeId: FLANDERS_TRADE_ID,
      publicationEligible: false,
      summary: {
        scenarioId: 'artifact:scenario-fixture',
        calculationId: 'valuation-calculation:scenario-fixture',
        valueUnitId: 'synthetic-pav',
        views: (['at_trade', 'realized', 'remaining', 'current'] as const).map(
          (view, viewIndex) => ({
            view,
            parties: [
              {
                aflClubId: 'afl-club:gold-coast',
                clubName: 'Gold Coast',
                received: 10 + viewIndex,
                givenUp: 20 + viewIndex,
                netAdvantage: -10,
              },
              {
                aflClubId: 'afl-club:st-kilda',
                clubName: 'St Kilda',
                received: 20 + viewIndex,
                givenUp: 10 + viewIndex,
                netAdvantage: 10,
              },
            ],
          })
        ),
      },
      scenario: {
        authority: {
          kind: 'private_scenario',
          publicationEligible: false,
          publicationProhibited: true,
        },
        evidenceClassification: 'fabricated_test_evidence_not_real_afl_data',
        assumptionSet: {
          assumptionSetId: 'artifact:assumption-fixture',
          content: {
            transferDirections: [{ directionBasis: 'two_party_other_club_assumption' }],
          },
        },
      },
    },
    publicationEligible: false,
  };
}

describe('private local workbook trade evaluation page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTradeMock.mockResolvedValue(evaluationFixture());
  });

  it('shows four calculation views and asset-level evidence without publication controls', async () => {
    render(
      await LocalWorkbookTradeEvaluationPage({
        params: Promise.resolve({ tradeId: FLANDERS_TRADE_ID }),
      })
    );

    expect(
      screen.getByRole('heading', { level: 1, name: '2025 Trade for Sam Flanders' })
    ).toBeVisible();
    expect(screen.getByText('Private local calculation')).toBeVisible();
    expect(screen.getAllByRole('region', { name: /trade value summary$/ })).toHaveLength(4);
    const scenario = screen.getByRole('region', { name: 'Synthetic calculation scenario' });
    expect(
      within(scenario).getByText('Fabricated test evidence — not real AFL data')
    ).toBeVisible();
    expect(within(scenario).getByText('Publication prohibited')).toBeVisible();
    expect(within(scenario).getAllByText('10.00').length).toBeGreaterThan(0);
    expect(
      within(scenario).getByText(/sender is inferred as the other participating club/i)
    ).toBeVisible();
    const workbookRecord = screen.getByText('Workbook trade record').parentElement;
    const verifiedGames = screen.getByText('Verified post-trade games').parentElement;
    expect(workbookRecord).not.toBeNull();
    expect(verifiedGames).not.toBeNull();
    expect(within(workbookRecord!).getByText('Flanders (0 games)')).toBeVisible();
    expect(
      within(verifiedGames!).getByText('Unavailable — no reconciled acquisition-spell fact')
    ).toBeVisible();
    expect(screen.getByText('Valued')).toBeVisible();
    expect(screen.getByText('40 historical samples')).toBeVisible();
    expect(screen.getByText('Production authority: none')).toBeVisible();
    expect(screen.getByText('Publication authority: none')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to private archive' })).toHaveAttribute(
      'href',
      '/dev/afl-trade-evaluation?year=2025'
    );
    expect(screen.queryByRole('link', { name: /export/i })).not.toBeInTheDocument();
    expect(loadTradeMock).toHaveBeenCalledWith(FLANDERS_TRADE_ID);
  });

  it('renders reconciled games with their effective-through date', async () => {
    const fixture = evaluationFixture();
    fixture.links[0]!.outcomeEvidence = {
      state: 'reconciled',
      effectiveThrough: '2026-08-09T09:20:00.000Z',
      games: {
        state: 'partial',
        observedValue: 12,
        reason: 'active_career_right_censored',
      },
    };
    loadTradeMock.mockResolvedValueOnce(fixture);

    render(
      await LocalWorkbookTradeEvaluationPage({
        params: Promise.resolve({ tradeId: FLANDERS_TRADE_ID }),
      })
    );

    const verifiedGames = screen.getByText('Verified post-trade games').parentElement;
    expect(verifiedGames).not.toBeNull();
    expect(within(verifiedGames!).getByText('12 games (right-censored)')).toBeVisible();
    expect(within(verifiedGames!).getByText('Effective through 2026-08-09')).toBeVisible();
    expect(screen.getByText('2025_0016')).toBeVisible();
  });

  it('returns not found when the trade is unavailable or evaluation is disabled', async () => {
    loadTradeMock.mockResolvedValueOnce(null);

    await expect(
      LocalWorkbookTradeEvaluationPage({
        params: Promise.resolve({ tradeId: FLANDERS_TRADE_ID }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
