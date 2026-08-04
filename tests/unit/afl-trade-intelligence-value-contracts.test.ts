import { describe, expect, it } from 'vitest';

import { aflTradeValueResultSchema } from '@/types/aflTradeIntelligence';

const excludedAssetId = 'fixture-unresolved-asset';

function uncertainty(median: number) {
  return {
    lower: median - 2,
    median,
    upper: median + 2,
    intervalLevel: 0.8,
    components: [
      {
        kind: 'outcome' as const,
        label: 'Outcome variation',
        description: 'Fabricated outcome variation for contract testing.',
      },
    ],
  };
}

function distribution(median: number) {
  return {
    downside: { quantile: 0.1 as const, value: median - 3 },
    upside: { quantile: 0.9 as const, value: median + 3 },
    lowReturn: { threshold: median - 2, probability: 0.2 },
    eliteOutcome: { threshold: median + 2, probability: 0.15 },
  };
}

function confidence() {
  return {
    level: 'moderate' as const,
    dimensions: [
      {
        kind: 'model_calibration' as const,
        level: 'high' as const,
        reasonCode: 'fixture-model-calibrated',
        explanation: 'Fabricated held-out calibration evidence supports this model component.',
      },
      {
        kind: 'lineage' as const,
        level: 'moderate' as const,
        reasonCode: 'fixture-lineage-moderate',
        explanation: 'Fabricated lineage evidence supports a moderate confidence classification.',
      },
    ],
  };
}

function numericCore() {
  return {
    view: 'current' as const,
    modelVintage: 'current' as const,
    temporalContext: {
      effectiveAt: '2025-12-31T00:00:00.000Z',
      knowledgeCutoffAt: '2025-12-31T23:59:59.000Z',
      valuationAsOf: '2026-01-01T00:00:00.000Z',
    },
    unit: {
      id: 'contribution-above-replacement-v1',
      label: 'Contribution above replacement',
      description: 'A fabricated football-contribution unit used only for contract tests.',
      direction: 'higher_is_better' as const,
    },
    clubValues: [
      {
        aflClubId: 'fixture-club-a',
        clubName: 'Fabricated Club A',
        estimate: 10,
        estimateStatistic: 'mean' as const,
        uncertainty: uncertainty(10),
        distribution: distribution(10),
        factors: [],
      },
      {
        aflClubId: 'fixture-club-b',
        clubName: 'Fabricated Club B',
        estimate: 8,
        estimateStatistic: 'mean' as const,
        uncertainty: uncertainty(8),
        distribution: distribution(8),
        factors: [],
      },
    ],
    comparison: {
      basis: 'complete_trade' as const,
      aflClubIds: ['fixture-club-a', 'fixture-club-b'],
      probabilities: [
        { aflClubId: 'fixture-club-a', finishesAhead: 0.55 },
        { aflClubId: 'fixture-club-b', finishesAhead: 0.35 },
      ],
      practicalEquivalenceProbability: 0.1,
    },
    assessment: {
      interpretation: 'leans_to_club' as const,
      favouredAflClubId: 'fixture-club-a',
      scope: 'complete_trade' as const,
    },
    confidence: confidence(),
    methodologyHref: '/afl-trades/methodology',
  };
}

function completeCoverage() {
  return {
    totalAssetCount: 2,
    valuedAssetCount: 2,
    excludedAssetCount: 0,
    coverageRatio: 1,
    excludedAssets: [],
  };
}

function partialCoverage() {
  return {
    totalAssetCount: 2,
    valuedAssetCount: 1,
    excludedAssetCount: 1,
    coverageRatio: 0.5,
    excludedAssets: [
      {
        assetId: excludedAssetId,
        reasonCode: 'identity-unresolved',
        message: 'The fabricated asset identity is unresolved.',
      },
    ],
  };
}

function available() {
  return {
    ...numericCore(),
    availability: 'available' as const,
    coverage: completeCoverage(),
    warnings: [],
  };
}

function partialWithIncludedAssetsOnly() {
  return {
    ...numericCore(),
    availability: 'available_partial' as const,
    comparison: {
      ...numericCore().comparison,
      basis: 'included_assets_only' as const,
      excludedAssetIds: [excludedAssetId],
    },
    assessment: { ...numericCore().assessment, scope: 'included_assets_only' as const },
    coverage: partialCoverage(),
    reasonCode: 'partial-asset-coverage',
    message: 'The result compares only the included fabricated assets.',
    nextAction: null,
    warnings: [
      {
        code: 'partial-result',
        severity: 'warning' as const,
        message: 'One fabricated asset is excluded.',
      },
    ],
  };
}

function partialWithAdjustment() {
  const partial = partialWithIncludedAssetsOnly();
  return {
    ...partial,
    comparison: {
      ...partial.comparison,
      basis: 'model_adjusted_for_exclusions' as const,
      adjustmentMethodCode: 'missing-asset-adjustment-v1',
      adjustmentExplanation:
        'The approved model estimates the omitted fabricated asset contribution.',
    },
    assessment: { ...partial.assessment, scope: 'complete_trade' as const },
  };
}

describe('AFL trade-intelligence numerical contracts', () => {
  it('requires coherent downside, upside, low-return and elite-outcome summaries', () => {
    const value = available();
    expect(
      aflTradeValueResultSchema.safeParse({
        ...value,
        clubValues: [
          {
            ...value.clubValues[0],
            distribution: {
              ...value.clubValues[0].distribution,
              downside: { quantile: 0.1, value: 11 },
            },
          },
          value.clubValues[1],
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradeValueResultSchema.safeParse({
        ...value,
        clubValues: [
          {
            ...value.clubValues[0],
            distribution: {
              ...value.clubValues[0].distribution,
              lowReturn: { threshold: 8, probability: 0.7 },
              eliteOutcome: { threshold: 12, probability: 0.4 },
            },
          },
          value.clubValues[1],
        ],
      }).success
    ).toBe(false);
  });

  it('requires overall confidence to equal the weakest unique confidence dimension', () => {
    expect(aflTradeValueResultSchema.safeParse(available()).success).toBe(true);
    expect(
      aflTradeValueResultSchema.safeParse({
        ...available(),
        confidence: { ...confidence(), level: 'high' },
      }).success
    ).toBe(false);
    expect(
      aflTradeValueResultSchema.safeParse({
        ...available(),
        confidence: {
          level: 'high',
          dimensions: [confidence().dimensions[0], confidence().dimensions[0]],
        },
      }).success
    ).toBe(false);
  });

  it('accepts a complete-trade result only with complete coverage', () => {
    expect(aflTradeValueResultSchema.safeParse(available()).success).toBe(true);
    expect(
      aflTradeValueResultSchema.safeParse({ ...available(), coverage: partialCoverage() }).success
    ).toBe(false);
  });

  it('accepts an explicitly scoped included-assets-only result', () => {
    expect(aflTradeValueResultSchema.safeParse(partialWithIncludedAssetsOnly()).success).toBe(true);
  });

  it('accepts an explained model adjustment as a complete-trade assessment', () => {
    expect(aflTradeValueResultSchema.safeParse(partialWithAdjustment()).success).toBe(true);
  });

  it('requires comparison exclusions to exactly match coverage exclusions', () => {
    const value = partialWithIncludedAssetsOnly();
    value.comparison.excludedAssetIds = ['different-excluded-asset'];
    expect(aflTradeValueResultSchema.safeParse(value).success).toBe(false);
  });

  it('rejects duplicate comparison exclusions', () => {
    const value = partialWithIncludedAssetsOnly();
    value.comparison.excludedAssetIds = [excludedAssetId, excludedAssetId];
    expect(aflTradeValueResultSchema.safeParse(value).success).toBe(false);
  });

  it('does not let included-assets-only probabilities claim a complete-trade assessment', () => {
    const value = partialWithIncludedAssetsOnly();
    expect(
      aflTradeValueResultSchema.safeParse({
        ...value,
        assessment: { ...value.assessment, scope: 'complete_trade' },
      }).success
    ).toBe(false);
  });

  it('requires model-adjusted probabilities to claim their supported complete-trade scope', () => {
    const value = partialWithAdjustment();
    expect(
      aflTradeValueResultSchema.safeParse({
        ...value,
        assessment: { ...value.assessment, scope: 'included_assets_only' },
      }).success
    ).toBe(false);
  });

  it('requires an approved adjustment code and public explanation', () => {
    const { adjustmentMethodCode: _method, ...withoutMethod } = partialWithAdjustment().comparison;
    expect(
      aflTradeValueResultSchema.safeParse({
        ...partialWithAdjustment(),
        comparison: withoutMethod,
      }).success
    ).toBe(false);

    const { adjustmentExplanation: _explanation, ...withoutExplanation } =
      partialWithAdjustment().comparison;
    expect(
      aflTradeValueResultSchema.safeParse({
        ...partialWithAdjustment(),
        comparison: withoutExplanation,
      }).success
    ).toBe(false);
  });

  it('requires partial coverage to reconcile counts, ratio, and public reasons', () => {
    expect(
      aflTradeValueResultSchema.safeParse({
        ...partialWithIncludedAssetsOnly(),
        coverage: { ...partialCoverage(), coverageRatio: 0.75 },
      }).success
    ).toBe(false);
    expect(
      aflTradeValueResultSchema.safeParse({
        ...partialWithIncludedAssetsOnly(),
        coverage: { ...partialCoverage(), excludedAssets: [] },
      }).success
    ).toBe(false);
  });

  it('requires uncertainty bounds in ascending order', () => {
    const value = available();
    value.clubValues[0].uncertainty = { ...uncertainty(10), lower: 12 };
    expect(aflTradeValueResultSchema.safeParse(value).success).toBe(false);
  });

  it('declares estimates as means without conflating them with interval medians', () => {
    const value = available();
    value.clubValues[0].estimate = 20;
    expect(aflTradeValueResultSchema.safeParse(value).success).toBe(true);
    expect(
      aflTradeValueResultSchema.safeParse({
        ...available(),
        clubValues: available().clubValues.map((club, index) =>
          index === 0 ? { ...club, estimateStatistic: 'median' } : club
        ),
      }).success
    ).toBe(false);
  });

  it('requires club and practical-equivalence probabilities to sum to one', () => {
    const value = available();
    value.comparison = { ...value.comparison, practicalEquivalenceProbability: 0.2 };
    expect(aflTradeValueResultSchema.safeParse(value).success).toBe(false);
  });

  it('requires the comparison set to match valued AFL clubs', () => {
    const value = available();
    value.comparison = {
      ...value.comparison,
      aflClubIds: ['fixture-club-a', 'fixture-club-c'],
      probabilities: [
        { aflClubId: 'fixture-club-a', finishesAhead: 0.55 },
        { aflClubId: 'fixture-club-c', finishesAhead: 0.35 },
      ],
    };
    expect(aflTradeValueResultSchema.safeParse(value).success).toBe(false);
  });

  it('keeps balanced and favoured-club semantics honest', () => {
    const balanced = available();
    expect(
      aflTradeValueResultSchema.safeParse({
        ...balanced,
        assessment: {
          ...balanced.assessment,
          interpretation: 'balanced_within_uncertainty',
        },
      }).success
    ).toBe(false);

    const wrongFavourite = available();
    wrongFavourite.assessment = {
      ...wrongFavourite.assessment,
      favouredAflClubId: 'fixture-club-b',
    };
    expect(aflTradeValueResultSchema.safeParse(wrongFavourite).success).toBe(false);
  });

  it('keeps at-trade model vintages distinct from current views', () => {
    expect(
      aflTradeValueResultSchema.safeParse({
        ...available(),
        view: 'at_trade',
        modelVintage: 'current',
      }).success
    ).toBe(false);
    expect(
      aflTradeValueResultSchema.safeParse({
        ...available(),
        view: 'at_trade',
        modelVintage: 'historical_restatement',
      }).success
    ).toBe(true);
  });

  it('preserves ordered numerical-contract issues when independent rules fail together', () => {
    const value = partialWithIncludedAssetsOnly();
    value.clubValues.push({
      ...value.clubValues[0],
      aflClubId: value.clubValues[0].aflClubId,
      clubName: 'Duplicate Fabricated Club A',
    });
    value.comparison.excludedAssetIds = ['different-excluded-asset'];
    const result = aflTradeValueResultSchema.safeParse({
      ...value,
      view: 'at_trade',
      modelVintage: 'current',
      assessment: {
        interpretation: 'balanced_within_uncertainty',
        favouredAflClubId: 'fixture-club-a',
        scope: 'complete_trade',
      },
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected the composite value fixture to be invalid.');
    expect(
      result.error.issues.map(({ code, path, message }) => ({ code, path, message }))
    ).toEqual([
      {
        code: 'custom',
        path: ['modelVintage'],
        message:
          'At-trade values must be original-vintage assessments or historical restatements.',
      },
      {
        code: 'custom',
        path: ['clubValues'],
        message: 'AFL clubs must not be duplicated.',
      },
      {
        code: 'custom',
        path: ['comparison'],
        message: 'The comparison set must contain every and only valued AFL clubs.',
      },
      {
        code: 'custom',
        path: ['comparison'],
        message: 'The comparison basis must identify exactly the assets excluded from coverage.',
      },
      {
        code: 'custom',
        path: ['assessment', 'scope'],
        message: 'Included-assets-only comparisons cannot support a complete-trade assessment.',
      },
      {
        code: 'custom',
        path: ['assessment', 'favouredAflClubId'],
        message: 'Balanced results must not declare a favoured AFL club.',
      },
    ]);
  });

  it('rejects temporal contexts that use future evidence', () => {
    const value = available();
    value.temporalContext = {
      ...value.temporalContext,
      knowledgeCutoffAt: '2026-01-02T00:00:00.000Z',
    };
    expect(aflTradeValueResultSchema.safeParse(value).success).toBe(false);
  });
});
