import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AflTradeValueDetailPanel } from '@/components/draft/AflTradeValueDetailPanel';
import { aflTradePrePublicationValueReadService } from '@/server/aflTradeIntelligence/publication/prePublicationValueReadService';
import {
  aflTradeValueDetailResponseSchema,
  type AflTradeValueBearing,
  type AflTradeValueDetailResponse,
} from '@/types/aflTradeIntelligence';

const uncertainty = {
  lower: 6,
  median: 9,
  upper: 14,
  intervalLevel: 0.8,
  components: [
    {
      kind: 'outcome' as const,
      label: 'Outcome variation',
      description: 'Fabricated outcome variation for component testing.',
    },
  ],
};

const distribution = {
  downside: { quantile: 0.1 as const, value: 5 },
  upside: { quantile: 0.9 as const, value: 15 },
  lowReturn: { threshold: 6, probability: 0.2 },
  eliteOutcome: { threshold: 14, probability: 0.15 },
};

function numericalResponse(): AflTradeValueDetailResponse {
  const valuation: AflTradeValueBearing = {
    availability: 'available',
    view: 'current',
    modelVintage: 'current',
    temporalContext: {
      effectiveAt: '2025-12-31T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-05T01:00:00.000Z',
      valuationAsOf: '2026-08-05T03:00:00.000Z',
    },
    unit: {
      id: 'fixture-value-unit',
      label: 'Fixture contribution above replacement',
      description: 'Fabricated football-contribution unit for component testing.',
      direction: 'higher_is_better',
    },
    clubValues: [
      {
        aflClubId: 'club-a',
        clubName: 'Fabricated Club A',
        estimate: 10,
        estimateStatistic: 'mean',
        uncertainty: { ...uncertainty, median: 10 },
        distribution,
        factors: [
          {
            kind: 'positive',
            code: 'fixture-durable-return',
            label: 'Durable return',
            explanation: 'The fabricated current projection retains more future value.',
          },
        ],
        packageValue: {
          received: { median: 120, interval: { lower: 95, upper: 145 } },
          givenUp: { median: 90, interval: { lower: 72, upper: 110 } },
          net: { median: 30, interval: { lower: 8, upper: 55 } },
        },
      },
      {
        aflClubId: 'club-b',
        clubName: 'Fabricated Club B',
        estimate: 8,
        estimateStatistic: 'mean',
        uncertainty: { ...uncertainty, lower: 5, median: 8, upper: 12 },
        distribution: {
          ...distribution,
          downside: { quantile: 0.1, value: 4 },
          upside: { quantile: 0.9, value: 13 },
          lowReturn: { threshold: 5, probability: 0.25 },
          eliteOutcome: { threshold: 12, probability: 0.1 },
        },
        factors: [],
        packageValue: {
          received: { median: 90, interval: { lower: 72, upper: 110 } },
          givenUp: { median: 120, interval: { lower: 95, upper: 145 } },
          net: { median: -30, interval: { lower: -55, upper: -8 } },
        },
      },
    ],
    comparison: {
      basis: 'complete_trade',
      aflClubIds: ['club-a', 'club-b'],
      probabilities: [
        { aflClubId: 'club-a', finishesAhead: 0.55 },
        { aflClubId: 'club-b', finishesAhead: 0.35 },
      ],
      practicalEquivalenceProbability: 0.1,
    },
    assessment: {
      interpretation: 'leans_to_club',
      favouredAflClubId: 'club-a',
      scope: 'complete_trade',
    },
    confidence: {
      level: 'moderate',
      dimensions: [
        {
          kind: 'model_calibration',
          level: 'high',
          reasonCode: 'fixture-model-high',
          explanation: 'Fabricated strong model evidence.',
        },
        {
          kind: 'lineage',
          level: 'moderate',
          reasonCode: 'fixture-lineage-moderate',
          explanation: 'Fabricated moderate lineage evidence.',
        },
      ],
    },
    methodologyHref: '/draft/trades/methodology/publication-fixture',
    coverage: {
      totalAssetCount: 2,
      valuedAssetCount: 2,
      excludedAssetCount: 0,
      coverageRatio: 1,
      excludedAssets: [],
    },
    warnings: [],
  };

  return aflTradeValueDetailResponseSchema.parse({
    consistency: {
      contractVersion: 'afl-trade-value/v2',
      selection: 'active',
      publication: {
        publicationId: `publication:${'a'.repeat(64)}`,
        state: 'published',
        valuationBundleId: `valuation-bundle:${'b'.repeat(64)}`,
        valueUnitId: 'fixture-value-unit',
        publishedAt: '2026-08-05T02:00:00.000Z',
      },
      registryRevision: 1,
      projectionBuildId: `projection:${'c'.repeat(64)}`,
      servedAt: '2026-08-05T04:00:00.000Z',
      calculationAsOf: '2026-08-05T03:00:00.000Z',
      knowledgeCutoffAt: '2026-08-05T01:00:00.000Z',
      freshness: 'current',
      supportedScope: ['Fabricated resolved AFL trades'],
      excludedScope: [],
      warnings: [],
    },
    tradeId: 'fixture-trade',
    valuations: [valuation],
    assets: [
      {
        assetId: 'fixture-player-a',
        assetKind: 'player',
        label: 'Fabricated player A',
        receivedByAflClubId: 'club-a',
        lineage: {
          status: 'resolved',
          rootAssetId: 'fixture-player-a',
          creditedAssetIds: ['fixture-player-a'],
          summary: 'Fabricated player lineage is resolved.',
        },
        values: [
          {
            status: 'valued',
            view: 'current',
            estimate: 10,
            estimateStatistic: 'mean',
            uncertainty: { ...uncertainty, median: 10 },
            distribution,
            factors: [],
            currentComponents: { realizedValue: 6, remainingValue: 4 },
          },
        ],
      },
      {
        assetId: 'fixture-pick-b',
        assetKind: 'draft_selection',
        label: 'Fabricated selection B',
        receivedByAflClubId: 'club-b',
        lineage: {
          status: 'resolved',
          rootAssetId: 'fixture-pick-b',
          creditedAssetIds: ['fixture-selection-b'],
          summary: 'Fabricated selection-to-player lineage is resolved.',
        },
        values: [
          {
            status: 'valued',
            view: 'current',
            estimate: 8,
            estimateStatistic: 'mean',
            uncertainty: { ...uncertainty, lower: 5, median: 8, upper: 12 },
            distribution: {
              ...distribution,
              downside: { quantile: 0.1, value: 4 },
              upside: { quantile: 0.9, value: 13 },
              lowReturn: { threshold: 5, probability: 0.25 },
              eliteOutcome: { threshold: 12, probability: 0.1 },
            },
            factors: [],
            currentComponents: { realizedValue: 5, remainingValue: 3 },
          },
        ],
      },
    ],
    lineageSummary: {
      status: 'resolved',
      totalAssetCount: 2,
      resolvedAssetCount: 2,
      unresolvedAssetCount: 0,
      lineageEdgeCount: 1,
      maximumDepth: 1,
    },
  });
}

describe('AFL trade value detail panel', () => {
  it('presents the full numerical decision and audit hierarchy', () => {
    render(<AflTradeValueDetailPanel analysis={numericalResponse()} />);

    expect(screen.getByRole('heading', { name: 'Leans Fabricated Club A' })).toBeVisible();
    expect(screen.getByText(/moderate confidence · 2 of 2 assets valued/i)).toBeVisible();
    expect(screen.getByText('Calculated as at 5 Aug 2026')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Value by AFL club' })).toBeVisible();
    const clubValue = screen.getByRole('heading', { name: 'Fabricated Club A' }).closest('article');
    expect(screen.getByLabelText('Fabricated Club A Statly grade B+')).toBeVisible();
    expect(screen.getByLabelText('Fabricated Club B Statly grade C+')).toBeVisible();
    expect(clubValue).toHaveTextContent('Net +30');
    expect(clubValue).toHaveTextContent('120 received − 90 given up');
    expect(clubValue).toHaveTextContent('Received value');
    expect(clubValue).toHaveTextContent('95–145');
    expect(clubValue).toHaveTextContent('Given-up value');
    expect(clubValue).toHaveTextContent('72–110');
    expect(clubValue).toHaveTextContent('Net advantage');
    expect(clubValue).toHaveTextContent('+8–+55');
    expect(clubValue).toHaveTextContent('55% chance to finish ahead');
    expect(clubValue).not.toHaveTextContent('20% low-return · 15% elite outcome');
    expect(screen.getByRole('heading', { name: 'Club-by-club asset breakdown' })).toBeVisible();
    expect(screen.getByText(/player · received by Fabricated Club A/i)).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Fabricated player A' }).closest('article')
    ).toHaveTextContent('6 realized + 4 remaining');
    expect(screen.getByRole('heading', { name: 'Why the model says this' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Methodology and limits' })).toHaveAttribute(
      'href',
      '/draft/trades/methodology/publication-fixture'
    );
  });

  it('does not force a winner for a balanced numerical result', () => {
    const analysis = numericalResponse();
    const valuation = analysis.valuations[0];
    if ('clubValues' in valuation) {
      valuation.assessment = {
        interpretation: 'balanced_within_uncertainty',
        favouredAflClubId: null,
        scope: 'complete_trade',
      };
    }

    render(<AflTradeValueDetailPanel analysis={analysis} />);

    expect(
      screen.getByRole('heading', { name: 'Too close to call within the model uncertainty' })
    ).toBeVisible();
  });

  it('shows the no-publication state without numerical claims', async () => {
    const analysis = await aflTradePrePublicationValueReadService.detail({
      scopeKey: 'public-afl-trades-current',
      tradeId: 'fixture-trade',
      requestedViews: ['at_trade', 'realized', 'remaining', 'current'],
    });

    render(<AflTradeValueDetailPanel analysis={analysis} />);

    expect(screen.getByText('Trade value not calculated')).toBeVisible();
    expect(screen.getByText('No numerical result')).toBeVisible();
    expect(screen.queryByText(/chance to finish ahead/)).not.toBeInTheDocument();
  });
});
