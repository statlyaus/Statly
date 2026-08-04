import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AflTradeValueSummaryCard } from '@/components/draft/AflTradeValueSummaryCard';
import { createAflTradePrePublicationAvailability } from '@/server/aflTradeIntelligence/publication/prePublicationAvailability';
import type { AflTradeValueBearingSummary } from '@/types/aflTradeIntelligence';

function numericalSummary(): AflTradeValueBearingSummary {
  return {
    availability: 'available',
    view: 'current',
    modelVintage: 'current',
    unit: {
      id: 'fixture-value-unit',
      label: 'Fixture value',
      description: 'Fabricated unit for component tests.',
      direction: 'higher_is_better',
    },
    clubValues: [
      {
        aflClubId: 'club-a',
        clubName: 'Fabricated Club A',
        expectedValue: 10,
        medianValue: 9,
        interval: { lower: 6, upper: 14, level: 0.8 },
        finishesAheadProbability: 0.55,
      },
      {
        aflClubId: 'club-b',
        clubName: 'Fabricated Club B',
        expectedValue: 8,
        medianValue: 8,
        interval: { lower: 5, upper: 12, level: 0.8 },
        finishesAheadProbability: 0.35,
      },
    ],
    practicalEquivalenceProbability: 0.1,
    comparisonBasis: 'complete_trade',
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
    coverage: { status: 'complete', coverageRatio: 1, excludedAssetCount: 0 },
    methodologyHref: '/draft/trades/methodology/publication-fixture',
    warnings: [],
  };
}

describe('AFL trade value summary card', () => {
  it('presents verdict, side values, probability, confidence, date, and methodology', () => {
    render(
      <AflTradeValueSummaryCard
        valuation={numericalSummary()}
        calculationAsOf="2026-08-05T03:00:00.000Z"
      />
    );

    expect(screen.getByRole('region', { name: 'Outcome today trade value summary' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Leans Fabricated Club A' })).toBeVisible();
    expect(screen.getByText('Moderate confidence')).toBeVisible();
    expect(screen.getByText(/55% chance to finish ahead/)).toBeVisible();
    expect(screen.getByText(/10% practical-equivalence chance/)).toBeVisible();
    expect(screen.getByText(/Calculated 5 Aug 2026/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Methodology' })).toHaveAttribute(
      'href',
      '/draft/trades/methodology/publication-fixture'
    );
  });

  it('does not force a winner for a balanced result', () => {
    const valuation = numericalSummary();
    valuation.assessment = {
      interpretation: 'balanced_within_uncertainty',
      favouredAflClubId: null,
      scope: 'complete_trade',
    };
    render(<AflTradeValueSummaryCard valuation={valuation} calculationAsOf={null} />);

    expect(screen.getByRole('heading', { name: 'Too close to call' })).toBeVisible();
  });

  it('shows the verified unavailable state without numerical claims', () => {
    render(
      <AflTradeValueSummaryCard
        valuation={createAflTradePrePublicationAvailability('current')}
        calculationAsOf={null}
      />
    );

    expect(screen.getByText('Trade value unavailable')).toBeVisible();
    expect(screen.getByText('No numerical result')).toBeVisible();
    expect(screen.queryByText(/chance to finish ahead/)).not.toBeInTheDocument();
  });

  it('surfaces the caveat for partial numerical output', () => {
    const valuation = {
      ...numericalSummary(),
      availability: 'available_partial' as const,
      comparisonBasis: 'included_assets_only' as const,
      assessment: {
        interpretation: 'leans_to_club' as const,
        favouredAflClubId: 'club-a',
        scope: 'included_assets_only' as const,
      },
      coverage: { status: 'partial' as const, coverageRatio: 0.5, excludedAssetCount: 1 },
      reasonCode: 'fixture-partial',
      message: 'One fabricated asset is excluded.',
      nextAction: null,
      warnings: [
        {
          code: 'fixture-partial',
          severity: 'warning' as const,
          message: 'One fabricated asset is excluded.',
        },
      ],
    };
    render(<AflTradeValueSummaryCard valuation={valuation} calculationAsOf={null} />);

    expect(screen.getByText('One fabricated asset is excluded.')).toBeVisible();
  });
});
