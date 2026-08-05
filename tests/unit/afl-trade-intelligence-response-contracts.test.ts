import { describe, expect, it } from 'vitest';

import {
  aflTradeConsistencyEnvelopeSchema,
  aflTradeValueDetailResponseSchema,
  aflTradeValueListResponseSchema,
  type AflTradeConsistencyEnvelope,
  type AflTradeValueResult,
  type AflTradeValueSummary,
} from '@/types/aflTradeIntelligence';

const publication = {
  publicationId: `publication:${'a'.repeat(64)}`,
  state: 'published' as const,
  valuationBundleId: `valuation-bundle:${'b'.repeat(64)}`,
  valueUnitId: 'contribution-above-replacement-v1',
  publishedAt: '2026-01-01T12:00:00.000Z',
};

type AvailableAflTradeValueResult = Extract<AflTradeValueResult, { availability: 'available' }>;

function consistency(): AflTradeConsistencyEnvelope {
  return {
    contractVersion: 'afl-trade-value/v2' as const,
    selection: 'active' as const,
    publication,
    registryRevision: 8,
    projectionBuildId: `projection:${'c'.repeat(64)}`,
    servedAt: '2026-01-02T00:00:00.000Z',
    calculationAsOf: '2026-01-01T13:00:00.000Z',
    knowledgeCutoffAt: '2026-01-01T11:00:00.000Z',
    freshness: 'current' as const,
    supportedScope: ['Fabricated AFL trades with resolved identities'],
    excludedScope: ['Unresolved fabricated trade assets'],
    warnings: [],
  };
}

function noPublicationConsistency(): AflTradeConsistencyEnvelope {
  return {
    contractVersion: 'afl-trade-value/v2' as const,
    selection: 'none' as const,
    publication: null,
    registryRevision: 0,
    projectionBuildId: null,
    servedAt: '2026-01-02T00:00:00.000Z',
    calculationAsOf: null,
    knowledgeCutoffAt: null,
    freshness: 'unavailable' as const,
    supportedScope: [],
    excludedScope: [],
    warnings: [],
  };
}

function available(): AvailableAflTradeValueResult {
  return {
    availability: 'available',
    view: 'current',
    modelVintage: 'current',
    temporalContext: {
      effectiveAt: '2025-12-31T00:00:00.000Z',
      knowledgeCutoffAt: '2025-12-31T23:59:59.000Z',
      valuationAsOf: '2026-01-01T00:00:00.000Z',
    },
    unit: {
      id: 'contribution-above-replacement-v1',
      label: 'Contribution above replacement',
      description: 'A fabricated football-contribution unit used only for contract tests.',
      direction: 'higher_is_better',
    },
    clubValues: [
      {
        aflClubId: 'fixture-club-a',
        clubName: 'Fabricated Club A',
        estimate: 10,
        estimateStatistic: 'mean',
        uncertainty: {
          lower: 8,
          median: 10,
          upper: 12,
          intervalLevel: 0.8,
          components: [
            {
              kind: 'outcome',
              label: 'Outcome variation',
              description: 'Fabricated outcome variation for contract testing.',
            },
          ],
        },
        distribution: {
          downside: { quantile: 0.1, value: 7 },
          upside: { quantile: 0.9, value: 13 },
          lowReturn: { threshold: 8, probability: 0.2 },
          eliteOutcome: { threshold: 12, probability: 0.15 },
        },
        factors: [],
      },
      {
        aflClubId: 'fixture-club-b',
        clubName: 'Fabricated Club B',
        estimate: 8,
        estimateStatistic: 'mean',
        uncertainty: {
          lower: 6,
          median: 8,
          upper: 10,
          intervalLevel: 0.8,
          components: [
            {
              kind: 'outcome',
              label: 'Outcome variation',
              description: 'Fabricated outcome variation for contract testing.',
            },
          ],
        },
        distribution: {
          downside: { quantile: 0.1, value: 5 },
          upside: { quantile: 0.9, value: 11 },
          lowReturn: { threshold: 6, probability: 0.25 },
          eliteOutcome: { threshold: 10, probability: 0.1 },
        },
        factors: [],
      },
    ],
    comparison: {
      basis: 'complete_trade',
      aflClubIds: ['fixture-club-a', 'fixture-club-b'],
      probabilities: [
        { aflClubId: 'fixture-club-a', finishesAhead: 0.55 },
        { aflClubId: 'fixture-club-b', finishesAhead: 0.35 },
      ],
      practicalEquivalenceProbability: 0.1,
    },
    assessment: {
      interpretation: 'leans_to_club',
      favouredAflClubId: 'fixture-club-a',
      scope: 'complete_trade',
    },
    confidence: {
      level: 'moderate',
      dimensions: [
        {
          kind: 'model_calibration',
          level: 'high',
          reasonCode: 'fixture-model-calibrated',
          explanation: 'Fabricated held-out calibration evidence supports this model component.',
        },
        {
          kind: 'lineage',
          level: 'moderate',
          reasonCode: 'fixture-lineage-moderate',
          explanation: 'Fabricated lineage evidence supports a moderate confidence classification.',
        },
      ],
    },
    methodologyHref: '/afl-trades/methodology',
    coverage: {
      totalAssetCount: 2,
      valuedAssetCount: 2,
      excludedAssetCount: 0,
      coverageRatio: 1,
      excludedAssets: [],
    },
    warnings: [],
  };
}

function availableSummary(): AflTradeValueSummary {
  return {
    availability: 'available',
    view: 'current',
    modelVintage: 'current',
    unit: available().unit,
    clubValues: [
      {
        aflClubId: 'fixture-club-a',
        clubName: 'Fabricated Club A',
        expectedValue: 10,
        medianValue: 10,
        interval: { lower: 8, upper: 12, level: 0.8 },
        finishesAheadProbability: 0.55,
      },
      {
        aflClubId: 'fixture-club-b',
        clubName: 'Fabricated Club B',
        expectedValue: 8,
        medianValue: 8,
        interval: { lower: 6, upper: 10, level: 0.8 },
        finishesAheadProbability: 0.35,
      },
    ],
    practicalEquivalenceProbability: 0.1,
    comparisonBasis: 'complete_trade',
    assessment: available().assessment,
    confidence: available().confidence,
    coverage: { status: 'complete', coverageRatio: 1, excludedAssetCount: 0 },
    methodologyHref: '/afl-trades/methodology',
    warnings: [],
  };
}

function assetBreakdowns() {
  return [
    {
      assetId: 'fixture-asset-a',
      assetKind: 'player' as const,
      label: 'Fabricated player A',
      receivedByAflClubId: 'fixture-club-a',
      lineage: {
        status: 'resolved' as const,
        rootAssetId: 'fixture-asset-a',
        creditedAssetIds: ['fixture-asset-a'],
        summary: 'Fabricated resolved player lineage.',
      },
      values: [
        {
          status: 'valued' as const,
          view: 'current' as const,
          estimate: 10,
          estimateStatistic: 'mean' as const,
          uncertainty: available().clubValues[0].uncertainty,
          distribution: available().clubValues[0].distribution,
          factors: [],
          currentComponents: { realizedValue: 6, remainingValue: 4 },
        },
      ],
    },
    {
      assetId: 'fixture-asset-b',
      assetKind: 'draft_selection' as const,
      label: 'Fabricated draft selection B',
      receivedByAflClubId: 'fixture-club-b',
      lineage: {
        status: 'resolved' as const,
        rootAssetId: 'fixture-asset-b',
        creditedAssetIds: ['fixture-asset-b', 'fixture-player-b'],
        summary: 'Fabricated selection-to-player lineage.',
      },
      values: [
        {
          status: 'valued' as const,
          view: 'current' as const,
          estimate: 8,
          estimateStatistic: 'mean' as const,
          uncertainty: available().clubValues[1].uncertainty,
          distribution: available().clubValues[1].distribution,
          factors: [],
          currentComponents: { realizedValue: 5, remainingValue: 3 },
        },
      ],
    },
  ];
}

function resolvedLineageSummary() {
  return {
    status: 'resolved' as const,
    totalAssetCount: 2,
    resolvedAssetCount: 2,
    unresolvedAssetCount: 0 as const,
    lineageEdgeCount: 1,
    maximumDepth: 1,
  };
}

function withdrawn(): AflTradeValueSummary {
  return {
    availability: 'withdrawn',
    view: 'current',
    modelVintage: null,
    temporalContext: null,
    reasonCode: 'publication-withdrawn',
    message: 'The fabricated publication was withdrawn.',
    nextAction: {
      kind: 'view_methodology',
      label: 'View methodology',
      href: '/afl-trades/methodology',
      expectedAfter: null,
    },
    warnings: [],
    methodologyHref: '/afl-trades/methodology',
  };
}

function listResponse(
  valuation: AflTradeValueSummary,
  envelope: AflTradeConsistencyEnvelope = consistency()
) {
  return {
    consistency: envelope,
    requestedView: valuation.view,
    items: [{ tradeId: 'fixture-trade-1', valuation }],
    page: { limit: 25, nextCursor: null, total: 1 },
  };
}

describe('AFL trade-intelligence response contracts', () => {
  it('accepts active and no-publication consistency envelopes from the public barrel', () => {
    expect(aflTradeConsistencyEnvelopeSchema.parse(consistency()).selection).toBe('active');
    expect(aflTradeConsistencyEnvelopeSchema.parse(noPublicationConsistency()).selection).toBe(
      'none'
    );
  });

  it('requires content-addressed projection build identities', () => {
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        projectionBuildId: 'projection:fixture-v1',
      }).success
    ).toBe(false);
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        projectionBuildId: `projection:${'A'.repeat(64)}`,
      }).success
    ).toBe(false);
  });

  it('requires the v2 bundle publication identity instead of legacy single-model metadata', () => {
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        contractVersion: 'afl-trade-value/v1',
      }).success
    ).toBe(false);

    const { valuationBundleId: _valuationBundleId, valueUnitId: _valueUnitId, ...legacyBase } =
      publication;
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        publication: {
          ...legacyBase,
          modelId: 'afl-contribution-model',
          modelVersion: '1.0.0',
          datasetId: `dataset:${'b'.repeat(64)}`,
        },
      }).success
    ).toBe(false);
  });

  it('requires active selection to reference a published publication', () => {
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        publication: { ...publication, state: 'superseded' },
      }).success
    ).toBe(false);
  });

  it('rejects calculation metadata when no publication is selected', () => {
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...noPublicationConsistency(),
        projectionBuildId: `projection:${'d'.repeat(64)}`,
      }).success
    ).toBe(false);
  });

  it('serves after calculation/publication and calculates after the knowledge cutoff', () => {
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        servedAt: '2025-12-01T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        knowledgeCutoffAt: '2026-01-01T14:00:00.000Z',
      }).success
    ).toBe(false);
  });

  it('rejects duplicate or overlapping public scope declarations', () => {
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        supportedScope: ['same-scope', 'same-scope'],
      }).success
    ).toBe(false);
    expect(
      aflTradeConsistencyEnvelopeSchema.safeParse({
        ...consistency(),
        supportedScope: ['same-scope'],
        excludedScope: ['same-scope'],
      }).success
    ).toBe(false);
  });

  it('requires one immutable publication for numerical list results', () => {
    expect(aflTradeValueListResponseSchema.safeParse(listResponse(availableSummary())).success).toBe(
      true
    );
    expect(
      aflTradeValueListResponseSchema.safeParse(
        listResponse(availableSummary(), noPublicationConsistency())
      ).success
    ).toBe(false);
  });

  it('rejects numerical results expressed in a different unit from the selected bundle', () => {
    expect(
      aflTradeValueListResponseSchema.safeParse(
        listResponse(availableSummary(), {
          ...consistency(),
          publication: { ...publication, valueUnitId: 'different-value-unit' },
        })
      ).success
    ).toBe(false);
  });

  it('prevents per-item publication overrides and mixed requested views', () => {
    expect(
      aflTradeValueListResponseSchema.safeParse(
        listResponse({
          ...availableSummary(),
          publication: {
            ...publication,
            publicationId: `publication:${'e'.repeat(64)}`,
          },
        } as unknown as AflTradeValueSummary)
      ).success
    ).toBe(false);
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...listResponse(availableSummary()),
        requestedView: 'at_trade',
      }).success
    ).toBe(false);
  });

  it('enforces pagination bounds and unique list trade identifiers', () => {
    const list = listResponse(availableSummary());
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...list,
        page: { ...list.page, limit: 101 },
      }).success
    ).toBe(false);
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...list,
        items: [...list.items, list.items[0]],
      }).success
    ).toBe(false);
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...list,
        page: { ...list.page, total: 0 },
      }).success
    ).toBe(false);
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...list,
        page: { ...list.page, limit: 1 },
        items: [
          ...list.items,
          { ...list.items[0], tradeId: 'fixture-trade-2' },
        ],
      }).success
    ).toBe(false);
  });

  it('requires unique detail views and reconciled lineage status', () => {
    const detail = {
      consistency: consistency(),
      tradeId: 'fixture-trade-1',
      valuations: [available(), available()],
      assets: assetBreakdowns(),
      lineageSummary: resolvedLineageSummary(),
    };
    expect(aflTradeValueDetailResponseSchema.safeParse(detail).success).toBe(false);
    expect(
      aflTradeValueDetailResponseSchema.safeParse({
        ...detail,
        valuations: [available()],
        lineageSummary: { ...resolvedLineageSummary(), resolvedAssetCount: 1 },
      }).success
    ).toBe(false);
    expect(
      aflTradeValueDetailResponseSchema.safeParse({
        ...detail,
        valuations: [available()],
        assets: assetBreakdowns(),
        lineageSummary: resolvedLineageSummary(),
      }).success
    ).toBe(true);
  });

  it('requires per-asset attribution to reconcile exactly to each receiving AFL club', () => {
    const detail = {
      consistency: consistency(),
      tradeId: 'fixture-trade-1',
      valuations: [available()],
      assets: assetBreakdowns(),
      lineageSummary: resolvedLineageSummary(),
    };
    expect(aflTradeValueDetailResponseSchema.safeParse(detail).success).toBe(true);

    const changedAssets = assetBreakdowns();
    changedAssets[0].values[0].estimate = 9;
    changedAssets[0].values[0].currentComponents = { realizedValue: 5, remainingValue: 4 };
    expect(
      aflTradeValueDetailResponseSchema.safeParse({ ...detail, assets: changedAssets }).success
    ).toBe(false);

    const wrongClubAssets = assetBreakdowns();
    wrongClubAssets[0].receivedByAflClubId = 'fixture-club-outside-comparison';
    expect(
      aflTradeValueDetailResponseSchema.safeParse({ ...detail, assets: wrongClubAssets }).success
    ).toBe(false);

    const duplicateCreditAssets = assetBreakdowns();
    duplicateCreditAssets[1].lineage.creditedAssetIds.push('fixture-asset-a');
    expect(
      aflTradeValueDetailResponseSchema.safeParse({ ...detail, assets: duplicateCreditAssets })
        .success
    ).toBe(false);
  });

  it('serves withdrawn results only with the matching withdrawn publication', () => {
    expect(aflTradeValueListResponseSchema.safeParse(listResponse(withdrawn())).success).toBe(
      false
    );
    const withdrawnConsistency = {
      ...consistency(),
      selection: 'explicit_historical' as const,
      publication: { ...publication, state: 'withdrawn' as const },
      freshness: 'withdrawn' as const,
    };
    expect(
      aflTradeValueListResponseSchema.safeParse(listResponse(withdrawn(), withdrawnConsistency))
        .success
    ).toBe(true);
    expect(
      aflTradeValueListResponseSchema.safeParse(
        listResponse(availableSummary(), withdrawnConsistency)
      ).success
    ).toBe(false);
    expect(
      aflTradeValueDetailResponseSchema.safeParse({
        consistency: withdrawnConsistency,
        tradeId: 'fixture-trade-1',
        valuations: [available()],
        assets: assetBreakdowns(),
        lineageSummary: resolvedLineageSummary(),
      }).success
    ).toBe(false);
  });

  it('rejects fantasy ownership and unknown fields at response boundaries', () => {
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...listResponse(availableSummary()),
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
  });

  it('rejects full detail payloads from lightweight list items', () => {
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...listResponse(availableSummary()),
        items: [{ tradeId: 'fixture-trade-1', valuation: available() }],
      }).success
    ).toBe(false);
  });
});
