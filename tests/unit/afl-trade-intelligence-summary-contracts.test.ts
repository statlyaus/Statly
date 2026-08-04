import { describe, expect, it } from 'vitest';

import { aflTradeValueSummarySchema } from '@/types/aflTradeIntelligence';

function summary() {
  return {
    availability: 'available' as const,
    view: 'current' as const,
    modelVintage: 'current' as const,
    unit: {
      id: 'fixture-value-unit',
      label: 'Fixture value',
      description: 'A fabricated football-contribution unit used only for summary tests.',
      direction: 'higher_is_better' as const,
    },
    clubValues: [
      {
        aflClubId: 'fixture-club-a',
        clubName: 'Fabricated Club A',
        expectedValue: 10,
        medianValue: 9,
        interval: { lower: 6, upper: 14, level: 0.8 },
        finishesAheadProbability: 0.55,
      },
      {
        aflClubId: 'fixture-club-b',
        clubName: 'Fabricated Club B',
        expectedValue: 8,
        medianValue: 8,
        interval: { lower: 5, upper: 12, level: 0.8 },
        finishesAheadProbability: 0.35,
      },
    ],
    practicalEquivalenceProbability: 0.1,
    comparisonBasis: 'complete_trade' as const,
    assessment: {
      interpretation: 'leans_to_club' as const,
      favouredAflClubId: 'fixture-club-a',
      scope: 'complete_trade' as const,
    },
    confidence: {
      level: 'moderate' as const,
      dimensions: [
        {
          kind: 'model_calibration' as const,
          level: 'high' as const,
          reasonCode: 'fixture-model-calibrated',
          explanation: 'Fabricated held-out calibration supports this summary.',
        },
        {
          kind: 'data_coverage' as const,
          level: 'moderate' as const,
          reasonCode: 'fixture-coverage-moderate',
          explanation: 'Fabricated coverage supports moderate overall confidence.',
        },
      ],
    },
    coverage: { status: 'complete' as const, coverageRatio: 1 as const, excludedAssetCount: 0 as const },
    methodologyHref: '/draft/trades/methodology/publication-fixture',
    warnings: [],
  };
}

describe('AFL trade-intelligence list summary contracts', () => {
  it('accepts the decision-useful lightweight numerical shape', () => {
    expect(aflTradeValueSummarySchema.safeParse(summary()).success).toBe(true);
  });

  it('requires intervals to contain their median and probabilities to sum to one', () => {
    const value = summary();
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        clubValues: [
          { ...value.clubValues[0], interval: { lower: 10, upper: 14, level: 0.8 } },
          value.clubValues[1],
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        practicalEquivalenceProbability: 0.2,
      }).success
    ).toBe(false);
  });

  it('requires unique clubs and the highest-probability club for a leaning verdict', () => {
    const value = summary();
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        clubValues: [value.clubValues[0], { ...value.clubValues[1], aflClubId: 'fixture-club-a' }],
      }).success
    ).toBe(false);
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        assessment: { ...value.assessment, favouredAflClubId: 'fixture-club-b' },
      }).success
    ).toBe(false);
  });

  it('does not force a winner for a balanced result', () => {
    const value = summary();
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        assessment: {
          ...value.assessment,
          interpretation: 'balanced_within_uncertainty',
          favouredAflClubId: null,
        },
      }).success
    ).toBe(true);
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        assessment: { ...value.assessment, interpretation: 'balanced_within_uncertainty' },
      }).success
    ).toBe(false);
  });

  it('enforces model vintage by view', () => {
    const value = summary();
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        view: 'at_trade',
        modelVintage: 'current',
      }).success
    ).toBe(false);
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        view: 'at_trade',
        modelVintage: 'historical_restatement',
      }).success
    ).toBe(true);
  });

  it('aligns coverage and assessment scope with the comparison basis', () => {
    const value = summary();
    const partialCoverage = {
      status: 'partial' as const,
      coverageRatio: 0.5,
      excludedAssetCount: 1,
    };
    expect(
      aflTradeValueSummarySchema.safeParse({ ...value, coverage: partialCoverage }).success
    ).toBe(false);
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        availability: 'available_partial',
        comparisonBasis: 'included_assets_only',
        assessment: { ...value.assessment, scope: 'included_assets_only' },
        coverage: partialCoverage,
        reasonCode: 'fixture-partial',
        message: 'One fabricated asset is excluded.',
        nextAction: null,
        warnings: [
          {
            code: 'fixture-partial',
            severity: 'warning',
            message: 'One fabricated asset is excluded.',
          },
        ],
      }).success
    ).toBe(true);
  });

  it('rejects detail-only factors and uncertainty components', () => {
    const value = summary();
    expect(
      aflTradeValueSummarySchema.safeParse({
        ...value,
        clubValues: [
          {
            ...value.clubValues[0],
            factors: [],
            uncertainty: {
              lower: 6,
              median: 9,
              upper: 14,
              intervalLevel: 0.8,
              components: [],
            },
          },
          value.clubValues[1],
        ],
      }).success
    ).toBe(false);
  });
});
