import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGovernedPrivateEvaluationGeneration } from '@/server/aflTradeIntelligence/valuation/governedPrivateEvaluationGeneration';
import { createGovernedPrivateEvaluationNarrativeFixture } from '../testUtils/governedPrivateEvaluationFixture';

const { loadTradeMock, notFoundMock } = vi.hoisted(() => ({
  loadTradeMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/server/aflTradeIntelligence/development/privateLocalWorkbookReads', () => ({
  privateLocalWorkbookReads: { loadTrade: loadTradeMock },
}));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

import LocalWorkbookTradeEvaluationPage from '../../src/app/dev/afl-trade-evaluation/[tradeId]/page';

const FLANDERS_TRADE_ID = 'workbook-2025-c64962fd1891b951';

function distribution(mean: number) {
  return { mean, median: mean, p10: mean - 1, p90: mean + 1 };
}

function explanationView(
  view: 'at_trade' | 'realized' | 'remaining' | 'current',
  flandersValue: number,
  pickValue: number
) {
  const asset = (
    assetId: string,
    label: string,
    assetKind: 'player' | 'future_pick',
    fromClubId: string,
    toClubId: string,
    additiveMean: number
  ) => ({
    assetId,
    assetKind,
    label,
    fromClubId,
    toClubId,
    additiveMean,
    distribution: distribution(additiveMean),
    currentComponents:
      view === 'current'
        ? {
            realizedMean: assetKind === 'player' ? 2 : 1,
            remainingMean: additiveMean - (assetKind === 'player' ? 2 : 1),
          }
        : null,
    layers: {
      grossMean: additiveMean,
      listSpotAdjustedMean: additiveMean,
      scarcityAdjustedMean: additiveMean,
      listSpotDelta: 0,
      scarcityDelta: 0,
    },
    evidenceState: 'complete' as const,
  });
  const flanders = asset(
    'asset:flanders',
    'Sam Flanders',
    'player',
    'afl-club:gold-coast',
    'afl-club:st-kilda',
    flandersValue
  );
  const futurePick = asset(
    'asset:future-pick',
    '2026 second-round pick',
    'future_pick',
    'afl-club:st-kilda',
    'afl-club:gold-coast',
    pickValue
  );
  const net = flandersValue - pickValue;
  return {
    view,
    practicalEquivalenceProbability: 0,
    verdict: { kind: 'favours_club' as const, aflClubIds: ['afl-club:st-kilda'] },
    clubs: [
      {
        aflClubId: 'afl-club:st-kilda',
        clubName: 'St Kilda',
        received: {
          assets: [flanders],
          additiveMean: flandersValue,
          distribution: distribution(flandersValue),
        },
        givenUp: {
          assets: [futurePick],
          additiveMean: pickValue,
          distribution: distribution(pickValue),
        },
        net: { additiveMean: net, distribution: distribution(net) },
        finishAheadProbability: 1,
        grade: {
          grade: 'A+' as const,
          state: 'provisional' as const,
          reasonCode: 'development_preview',
        },
      },
      {
        aflClubId: 'afl-club:gold-coast',
        clubName: 'Gold Coast',
        received: {
          assets: [futurePick],
          additiveMean: pickValue,
          distribution: distribution(pickValue),
        },
        givenUp: {
          assets: [flanders],
          additiveMean: flandersValue,
          distribution: distribution(flandersValue),
        },
        net: { additiveMean: -net, distribution: distribution(-net) },
        finishAheadProbability: 0,
        grade: {
          grade: 'D' as const,
          state: 'provisional' as const,
          reasonCode: 'development_preview',
        },
      },
    ],
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
    scenario: {
      state: 'ready',
      tradeId: FLANDERS_TRADE_ID,
      publicationEligible: false,
      explanation: {
        state: 'available',
        document: {
          explanationId: 'valuation-explanation:fixture',
          schemaVersion: 'afl-trade-valuation-explanation/v1',
          tradeId: FLANDERS_TRADE_ID,
          defaultView: 'current',
          authority: {
            kind: 'private_synthetic',
            assumptionSetId: `artifact:${'d'.repeat(64)}`,
            publicationProhibited: true,
            warning: 'Fabricated rank-based test values — not real AFL data.',
          },
          valueUnitId: 'fabricated-football-contribution-above-replacement-v1',
          valuationBundleId: `valuation-bundle:${'a'.repeat(64)}`,
          valuationCaseId: `valuation-case:${'b'.repeat(64)}`,
          valuationCalculationId: `valuation-calculation:${'c'.repeat(64)}`,
          effectiveAt: '2025-10-01T00:00:00.000Z',
          effectiveThrough: '2026-08-01T00:00:00.000Z',
          coverage: { status: 'complete', ratio: 1 },
          confidenceLevel: 'high',
          selectedLayer: 'scarcityAdjusted',
          views: [
            explanationView('at_trade', 10.4, 5.2),
            explanationView('realized', 2, 1),
            explanationView('remaining', 5.2, 2.6),
            explanationView('current', 7.2, 3.6),
          ],
          methodology: {
            additiveStatistic: 'probability_weighted_mean',
            uncertaintyStatistic: 'joint_draw_weighted_quantiles',
            packageMedianIsAdditive: false,
            assetGradeTreatment: 'prohibited',
            currentIdentity: 'realized_plus_remaining',
            practicalEquivalenceBasis:
              'Synthetic fixture assumes no practical-equivalence band; grades are provisional.',
          },
        },
      },
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
    numericalEvaluation: {
      state: 'blocked',
      readiness: {
        state: 'blocked',
        numericalCalculationsAvailable: false,
        qualificationReportCreated: true,
        qualificationReportId: `valuation-source-qualification:${'b'.repeat(64)}`,
        factualReleaseId: `outcome-release:${'c'.repeat(64)}`,
        qualificationEvaluatedAt: '2026-08-15T02:00:00.000Z',
        privateEvaluationAuthorityState: 'not_authorized',
        privateEvaluationDecisionId: null,
        privateEvaluationDecidedAt: null,
        preparedInputSetCreated: true,
        preparedInputSetCount: 1,
        preparedInputSetIds: [`prepared-valuation-input-set:${'a'.repeat(64)}`],
        scopeKey: 'afl-men:2025-trades',
        blockerCodes: ['source_blocked', 'private_evaluation_not_authorized'],
        sources: ['afl-tables-five-season', 'official-afl-2026'],
        requiredNextAuthority: 'private_nonproduction_derived_calculation_authority',
        explanation: 'Private non-production derived calculation authority has not been recorded.',
      },
    },
  };
}

function governedEvaluationFixture() {
  const narrative = createGovernedPrivateEvaluationNarrativeFixture();
  const selector = {
    valuationScopeKey: 'afl-men:2025-trades',
    tradeId: narrative.content.tradeId,
  };
  const materialization = createGovernedPrivateEvaluationGeneration({
    selector,
    transitionIntentId: `private-evaluation-transition-intent:${'e'.repeat(64)}`,
    generatedAt: '2026-08-19T00:00:00.000Z',
    narrative,
  });
  const detailArtifact = materialization.artifacts.find(({ kind }) => kind === 'detail')!;
  const evaluation = evaluationFixture();
  return {
    ...evaluation,
    detail: {
      ...evaluation.detail,
      trade: {
        ...evaluation.detail.trade,
        tradeId: selector.tradeId,
        title: 'Adelaide and St Kilda package evaluation',
        clubNames: ['Adelaide', 'St Kilda'],
      },
    },
    governedEvaluation: {
      state: 'available' as const,
      selector,
      selection: { kind: 'current' as const },
      generationId: materialization.generation.generationId,
      projectionManifestId: materialization.projectionManifest.projectionManifestId,
      lifecycle: { status: 'active' as const, current: true as const },
      document: { kind: 'detail' as const, artifact: detailArtifact.reference },
      bytes: detailArtifact.bytes,
    },
  };
}

describe('private local workbook trade evaluation page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTradeMock.mockResolvedValue(evaluationFixture());
  });

  it('shows reconciled asset scores and an overall provisional grade in the isolated synthetic scenario', async () => {
    render(
      await LocalWorkbookTradeEvaluationPage({
        params: Promise.resolve({ tradeId: FLANDERS_TRADE_ID }),
      })
    );

    expect(
      screen.getByRole('heading', { level: 1, name: '2025 Trade for Sam Flanders' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Numerical valuation preparation is blocked' })
    ).toBeVisible();
    expect(
      screen.getByText(`afl-men:2025-trades · retained for outcome-release:${'c'.repeat(64)}`)
    ).toBeVisible();
    expect(screen.getByText('Private non-production calculation authority')).toBeVisible();
    expect(screen.getByText('Not authorized')).toBeVisible();
    expect(screen.getByText('Private local calculation')).toBeVisible();
    const scenario = screen.getByRole('region', { name: 'Synthetic calculation scenario' });
    expect(
      within(scenario).getByText('Fabricated test evidence — not real AFL data')
    ).toBeVisible();
    expect(within(scenario).getByText('Publication prohibited')).toBeVisible();
    expect(
      within(scenario).getByLabelText('St Kilda provisional synthetic grade A+')
    ).toBeVisible();
    expect(within(scenario).getAllByText('Sam Flanders')).toHaveLength(2);
    expect(within(scenario).getAllByLabelText('Sam Flanders contribution +7.20')).toHaveLength(2);
    expect(within(scenario).getByText('Received subtotal +7.20')).toBeVisible();
    expect(within(scenario).getByText('Expected net +3.60')).toBeVisible();
    expect(within(scenario).getByText('100% chance to finish ahead')).toBeVisible();
    expect(within(scenario).getByText('Package median +3.60')).toBeVisible();
    expect(
      within(scenario).getByText(
        /Asset contributions and package subtotals use the probability-weighted mean/i
      )
    ).toBeInTheDocument();
    const viewSelector = within(scenario).getByRole('combobox', { name: 'Valuation view' });
    expect(viewSelector).toHaveValue('current');
    expect(within(scenario).getByRole('button', { name: 'Current' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.change(viewSelector, { target: { value: 'at_trade' } });
    expect(within(scenario).getByRole('button', { name: 'At trade' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(scenario).getAllByLabelText('Sam Flanders contribution +10.40')).toHaveLength(2);
    expect(within(scenario).getByText('Expected net +5.20')).toBeVisible();
    expect(
      within(scenario).getByText(/sender is inferred as the other participating club/i)
    ).toBeVisible();
    const workbookRecord = screen.getByText('Workbook trade record').parentElement;
    expect(workbookRecord).not.toBeNull();
    expect(within(workbookRecord!).getByText('Flanders (0 games)')).toBeVisible();
    expect(screen.getByText('Governed numerical evidence')).toBeVisible();
    expect(screen.getByText('Unavailable at this gate')).toBeVisible();
    expect(
      screen.getByText(
        'No factual calculation, dataset, or model identity is claimed while numerical evaluation remains blocked.'
      )
    ).toBeVisible();
    expect(screen.getByText('Production authority: none')).toBeVisible();
    expect(screen.getByText('Publication authority: none')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to private archive' })).toHaveAttribute(
      'href',
      '/dev/afl-trade-evaluation?year=2025'
    );
    expect(screen.queryByRole('link', { name: /export/i })).not.toBeInTheDocument();
    const governed = screen.getByRole('region', {
      name: 'Automatic governed package calculation',
    });
    expect(within(governed).getByText('Current package grade: —')).toBeVisible();
    expect(within(governed).queryByText(/no grade/iu)).not.toBeInTheDocument();
    expect(
      within(governed).queryByText(/not found|withdrawn|authentication|projection/iu)
    ).not.toBeInTheDocument();
    expect(loadTradeMock).toHaveBeenCalledWith(FLANDERS_TRADE_ID);
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

  it('renders the authenticated package calculation and exact evidence export as one transaction', async () => {
    const evaluation = governedEvaluationFixture();
    loadTradeMock.mockResolvedValueOnce(evaluation);

    render(
      await LocalWorkbookTradeEvaluationPage({
        params: Promise.resolve({ tradeId: evaluation.detail.trade.tradeId }),
      })
    );

    const governed = screen.getByRole('region', {
      name: 'Automatic governed package calculation',
    });
    expect(within(governed).getAllByRole('article')).toHaveLength(2);
    expect(within(governed).getByRole('article', { name: 'Adelaide package' })).toBeVisible();
    expect(within(governed).getByRole('article', { name: 'St Kilda package' })).toBeVisible();
    expect(within(governed).getByText(/92 - 70 = \+22 fixed_horizon_pav/u)).toBeVisible();
    fireEvent.click(within(governed).getAllByText('Pick 14 calculation and lineage')[0]!);
    expect(
      within(governed).getAllByText(/48 observations across 12 draft classes/u)
    ).not.toHaveLength(0);
    expect(
      within(governed).getByRole('link', { name: 'Download exact JSON evidence' })
    ).toHaveAttribute(
      'href',
      `/api/dev/afl-trade-evaluation/${encodeURIComponent(evaluation.detail.trade.tradeId)}/export`
    );
    expect(within(governed).queryByText(/asset grade/iu)).not.toBeInTheDocument();
  });
});
