import { describe, expect, it } from 'vitest';

import { createAflTradeCanonicalJsonArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  AFL_TRADE_PROJECTION_DOCUMENT_KINDS,
  AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES,
  AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_EXPORT_ROW_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_MATERIALIZATION_BINDING_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
  aflTradeProjectionDetailDocumentContentSchema,
  aflTradeProjectionDocumentContentSchema,
  aflTradeProjectionDocumentSchema,
  aflTradeProjectionExportRowDocumentContentSchema,
  aflTradeProjectionMethodologyDocumentContentSchema,
  aflTradeProjectionMaterializationBindingSchema,
  aflTradeProjectionSummaryDocumentContentSchema,
  aflTradeProjectionViewGlobalFactorsSchema,
  createAflTradeProjectionDocumentArtifact,
  verifyAflTradeProjectionDocumentArtifact,
  type AflTradeProjectionDetailDocumentContent,
  type AflTradeProjectionDocumentArtifact,
  type AflTradeProjectionDocumentContent,
  type AflTradeProjectionExportRowDocumentContent,
  type AflTradeProjectionMethodologyDocumentContent,
  type AflTradeProjectionSummaryDocumentContent,
} from '@/server/aflTradeIntelligence/publication/projectionDocumentContracts';
import {
  type AflTradeConsistencyEnvelope,
  type AflTradeMethodologyResponse,
  type AflTradeValueDetailResponse,
  type AflTradeValueResult,
  type AflTradeValueSummary,
  type AflTradeValuationView,
  aflTradeValueSummarySchema,
} from '@/types/aflTradeIntelligence';

const digest = (character: string) => character.repeat(64);
const publicationId = `publication:${digest('a')}`;
const valuationBundleId = `valuation-bundle:${digest('b')}`;
const valuationOutputInventoryIndexId = `valuation-output-inventory-index:${digest('c')}`;
const calculationAsOf = '2026-08-05T03:00:00.000Z';
const knowledgeCutoffAt = '2026-08-05T01:00:00.000Z';
const materializedAt = '2026-08-05T04:00:00.000Z';
const projectionMaterializedAt = '2026-08-05T03:30:00.000Z';
const valueUnit = {
  id: 'fixture-value-unit',
  label: 'Fixture value',
  description: 'A fabricated football-contribution unit used only for projection contract tests.',
  direction: 'higher_is_better' as const,
};
const runtimeSummaryStates = [
  'calculating',
  'stale',
  'failed_previous_available',
  'withdrawn',
] as const;

type ProjectionDocumentKind = (typeof AFL_TRADE_PROJECTION_DOCUMENT_KINDS)[number];
type AvailableValue = Extract<AflTradeValueResult, { availability: 'available' }>;

const canonicalFactors = [
  {
    kind: 'positive' as const,
    code: 'fixture-positive-factor',
    label: 'Fabricated positive factor',
    explanation: 'Fabricated direct evidence supports this projection.',
  },
  {
    kind: 'negative' as const,
    code: 'fixture-negative-factor',
    label: 'Fabricated negative factor',
    explanation: 'Fabricated direct evidence limits this projection.',
  },
];

function viewGlobalFactors(view: AflTradeValuationView) {
  return { view, factors: canonicalFactors };
}

function common<const Kind extends ProjectionDocumentKind>(kind: Kind) {
  return {
    schemaVersion: AFL_TRADE_PROJECTION_DOCUMENT_SCHEMA_VERSION,
    kind,
    publicAssetBoundary: AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY,
    publicationId,
    valuationBundleId,
    valuationOutputInventoryIndexId,
    scopeKey: 'public-afl-trades-current',
    valueUnitId: valueUnit.id,
    calculationAsOf,
    knowledgeCutoffAt,
  } as const;
}

function consistency(): AflTradeConsistencyEnvelope {
  return {
    contractVersion: 'afl-trade-value/v2',
    selection: 'active',
    publication: {
      publicationId,
      state: 'published',
      valuationBundleId,
      valueUnitId: valueUnit.id,
      publishedAt: '2026-08-05T02:00:00.000Z',
    },
    registryRevision: 7,
    projectionBuildId: `projection:${digest('d')}`,
    servedAt: materializedAt,
    calculationAsOf,
    knowledgeCutoffAt,
    freshness: 'current',
    supportedScope: ['Fabricated resolved AFL trade assets'],
    excludedScope: [],
    warnings: [],
  };
}

function summary(): AflTradeValueSummary {
  return {
    availability: 'available',
    view: 'current',
    modelVintage: 'current',
    unit: valueUnit,
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
          explanation: 'Fabricated held-out calibration supports the projection.',
        },
        {
          kind: 'data_coverage',
          level: 'moderate',
          reasonCode: 'fixture-coverage-moderate',
          explanation: 'Fabricated coverage supports moderate confidence.',
        },
      ],
    },
    coverage: { status: 'complete', coverageRatio: 1, excludedAssetCount: 0 },
    methodologyHref: '/draft/trades/methodology/publication-fixture',
    warnings: [],
  };
}

function unavailableSummary(view: AflTradeValuationView = 'current'): AflTradeValueSummary {
  return {
    availability: 'unsupported_trade',
    view,
    modelVintage: null,
    temporalContext: null,
    reasonCode: 'fixture-unsupported-trade',
    message: 'This fabricated AFL trade is outside the supported projection scope.',
    nextAction: null,
    warnings: [],
    methodologyHref: '/draft/trades/methodology/publication-fixture',
  };
}

function runtimeSummaryState(
  availability: 'calculating' | 'stale' | 'failed_previous_available' | 'withdrawn'
): unknown {
  if (availability === 'stale') {
    return {
      ...summary(),
      availability,
      reasonCode: 'fixture-stale',
      message: 'The fabricated serving-time freshness policy classifies this value as stale.',
      nextAction: null,
      warnings: [
        {
          code: 'fixture-stale',
          severity: 'warning',
          message: 'The fabricated value is stale.',
        },
      ],
      staleSince: '2026-08-05T03:30:00.000Z',
    };
  }
  if (availability === 'failed_previous_available') {
    return {
      ...summary(),
      availability,
      reasonCode: 'fixture-refresh-failed',
      message: 'A fabricated refresh failed after this prior value was calculated.',
      nextAction: null,
      warnings: [
        {
          code: 'fixture-refresh-failed',
          severity: 'warning',
          message: 'The fabricated refresh failed.',
        },
      ],
      latestAttemptFailedAt: '2026-08-05T03:30:00.000Z',
    };
  }
  return { ...unavailableSummary(), availability };
}

function availableValue(view: AflTradeValuationView): AvailableValue {
  return {
    availability: 'available',
    view,
    modelVintage: view === 'at_trade' ? 'original_vintage' : 'current',
    temporalContext: {
      effectiveAt: '2025-10-01T00:00:00.000Z',
      knowledgeCutoffAt,
      valuationAsOf: calculationAsOf,
    },
    unit: valueUnit,
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
              description: 'Fabricated outcome variation for projection tests.',
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
              description: 'Fabricated outcome variation for projection tests.',
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
          explanation: 'Fabricated calibration supports this projection.',
        },
        {
          kind: 'lineage',
          level: 'moderate',
          reasonCode: 'fixture-lineage-moderate',
          explanation: 'Fabricated lineage supports moderate confidence.',
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
}

function assetValue(view: AflTradeValuationView, clubValue: AvailableValue['clubValues'][number]) {
  return {
    status: 'valued' as const,
    view,
    estimate: clubValue.estimate,
    estimateStatistic: 'mean' as const,
    uncertainty: clubValue.uncertainty,
    distribution: clubValue.distribution,
    factors: [],
    currentComponents:
      view === 'current' ? { realizedValue: 6, remainingValue: clubValue.estimate - 6 } : null,
  };
}

function detailResponse(): AflTradeValueDetailResponse {
  const views = ['at_trade', 'realized', 'remaining', 'current'] as const;
  const valuations = views.map(availableValue);
  return {
    consistency: consistency(),
    tradeId: 'fixture-trade-1',
    valuations,
    assets: [
      {
        assetId: 'fixture-asset-a',
        assetKind: 'player',
        label: 'Fabricated player A',
        receivedByAflClubId: 'fixture-club-a',
        lineage: {
          status: 'resolved',
          rootAssetId: 'fixture-asset-a',
          creditedAssetIds: ['fixture-asset-a'],
          summary: 'Fabricated resolved player lineage.',
        },
        values: views.map((view) => assetValue(view, valuations[0].clubValues[0])),
      },
      {
        assetId: 'fixture-asset-b',
        assetKind: 'draft_selection',
        label: 'Fabricated draft selection B',
        receivedByAflClubId: 'fixture-club-b',
        lineage: {
          status: 'resolved',
          rootAssetId: 'fixture-asset-b',
          creditedAssetIds: ['fixture-asset-b', 'fixture-player-b'],
          summary: 'Fabricated selection-to-player lineage.',
        },
        values: views.map((view) => assetValue(view, valuations[0].clubValues[1])),
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
  };
}

function methodologyResponse(): AflTradeMethodologyResponse {
  return {
    availability: 'published',
    consistency: consistency(),
    methodologyHref: '/draft/trades/methodology/publication-fixture',
    methodology: {
      valuationBundleId,
      modelVersion: 'fixture-model-2026.1',
      components: [
        {
          role: 'player_contribution_and_availability',
          modelVersion: 'fixture-player-1.0.0',
          summary: 'Fabricated player contribution component.',
        },
        {
          role: 'draft_pick_and_future_pick_distribution',
          modelVersion: 'fixture-pick-1.0.0',
          summary: 'Fabricated draft-pick distribution component.',
        },
      ],
      valueUnit,
      primaryOutcome: {
        code: 'fixture-club-contribution',
        label: 'Fabricated club contribution',
        definition: 'Fabricated definition used only for projection contract tests.',
      },
      trainingPeriod: { firstSeason: 2001, lastSeason: 2024 },
      calculationAsOf,
      supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
      supportedDataCoverage: ['Fabricated resolved AFL trade assets'],
      knownLimitations: ['Fabricated limitation used only for contract testing.'],
      materialChangesFromPrevious: [],
    },
  };
}

function summaryContent(): AflTradeProjectionSummaryDocumentContent {
  return {
    ...common('trade_summary'),
    tradeId: 'fixture-trade-1',
    view: 'current',
    valuation: summary(),
    viewGlobalFactors: viewGlobalFactors('current'),
  };
}

function detailContent(): AflTradeProjectionDetailDocumentContent {
  const response = detailResponse();
  return {
    ...common('trade_detail'),
    tradeId: response.tradeId,
    valuations: response.valuations,
    viewGlobalFactors: response.valuations.map(({ view }) => viewGlobalFactors(view)),
    assets: response.assets,
    lineageSummary: response.lineageSummary,
  };
}

function methodologyContent(): AflTradeProjectionMethodologyDocumentContent {
  const response = methodologyResponse();
  if (response.availability !== 'published') throw new Error('Expected published methodology.');
  const projectionMaterializationId = `projection-materialization:${digest('e')}`;
  return {
    ...common('methodology'),
    methodology: response.methodology,
    projectionMaterialization: {
      schemaVersion: AFL_TRADE_PROJECTION_MATERIALIZATION_BINDING_SCHEMA_VERSION,
      projectionMaterializationId,
      artifactRef: createAflTradeCanonicalJsonArtifactRef(
        { projectionMaterializationId, fixtureRoot: 'canonical-methodology-binding' },
        projectionMaterializedAt
      ),
      publicationId,
      valuationOutputInventoryIndexId,
      projectionPublicEvidenceIndexId: `projection-public-evidence-index:${digest('f')}`,
      projectionPresentationPolicyId: `projection-presentation-policy:${digest('1')}`,
      projectionSchemaBundleId: `projection-schema-bundle:${digest('2')}`,
      scopeKey: common('methodology').scopeKey,
      valueUnitId: valueUnit.id,
      calculationAsOf,
      knowledgeCutoffAt,
      tradeCount: 1,
      documentCount: 9,
      evidenceTradeSetSha256: digest('3'),
      entrySetSha256: digest('4'),
      shardSetSha256: digest('5'),
    },
  };
}

function exportContent(
  valuation: AflTradeValueSummary = summary(),
  rowOrdinal = 1
): AflTradeProjectionExportRowDocumentContent {
  return {
    ...common('valuation_export_row'),
    viewGlobalFactors: rowOrdinal === 0 ? viewGlobalFactors(valuation.view) : null,
    exportRow: {
      rowSchemaVersion: AFL_TRADE_PROJECTION_EXPORT_ROW_SCHEMA_VERSION,
      rowOrdinal,
      tradeId: 'fixture-trade-1',
      view: valuation.view,
      valuation,
      clubValue: 'clubValues' in valuation ? valuation.clubValues[rowOrdinal] : null,
      selectedClubOutcome:
        'clubValues' in valuation
          ? {
              aflClubId: valuation.clubValues[rowOrdinal].aflClubId,
              distribution: {
                downside: { quantile: 0.1, value: valuation.clubValues[rowOrdinal].interval.lower },
                upside: { quantile: 0.9, value: valuation.clubValues[rowOrdinal].interval.upper },
                lowReturn: {
                  threshold: valuation.clubValues[rowOrdinal].interval.lower - 1,
                  probability: 0.2,
                },
                eliteOutcome: {
                  threshold: valuation.clubValues[rowOrdinal].interval.upper + 1,
                  probability: 0.1,
                },
              },
            }
          : null,
    },
  };
}

function createArtifact(
  content: AflTradeProjectionDocumentContent = summaryContent(),
  timestamp = materializedAt
): AflTradeProjectionDocumentArtifact {
  return createAflTradeProjectionDocumentArtifact({ content, materializedAt: timestamp });
}

describe('AFL trade-intelligence projection document contracts', () => {
  it('accepts each strict, versioned immutable projection document kind', () => {
    const contents = [summaryContent(), detailContent(), methodologyContent(), exportContent()];

    expect(AFL_TRADE_PROJECTION_DOCUMENT_KINDS).toEqual([
      'trade_summary',
      'trade_detail',
      'methodology',
      'valuation_export_row',
    ]);
    for (const content of contents) {
      expect(aflTradeProjectionDocumentContentSchema.safeParse(content).success).toBe(true);
      expect(createArtifact(content).projectionDocument.content.kind).toBe(content.kind);
    }
  });

  it('creates deterministic content IDs and complete canonical artifact references', () => {
    const first = createArtifact();
    const second = createArtifact(structuredClone(summaryContent()));

    expect(second).toEqual(first);
    expect(first.projectionDocument.projectionDocumentId).toMatch(
      /^projection-document:[a-f0-9]{64}$/
    );
    expect(first.projectionDocumentArtifactRef).toMatchObject({
      artifactId: `artifact:${first.projectionDocumentArtifactRef.contentSha256}`,
      storageUri: `artifact://sha256/${first.projectionDocumentArtifactRef.contentSha256}`,
      mediaType: 'application/json',
      createdAt: materializedAt,
    });
    expect(first.projectionDocumentArtifactRef.byteLength).toBeGreaterThan(0);
    expect(first.projectionDocumentArtifactRef.byteLength).toBeLessThanOrEqual(
      AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES
    );
    expect(verifyAflTradeProjectionDocumentArtifact(first)).toBe(true);
  });

  it('binds a summary to its trade view, value unit, and canonical club order', () => {
    const content = summaryContent();
    const valuation = content.valuation;
    if (!('clubValues' in valuation)) throw new Error('Expected available summary.');

    expect(
      aflTradeProjectionSummaryDocumentContentSchema.safeParse({ ...content, view: 'realized' })
        .success
    ).toBe(false);
    expect(
      aflTradeProjectionSummaryDocumentContentSchema.safeParse({
        ...content,
        valueUnitId: 'different-unit',
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionSummaryDocumentContentSchema.safeParse({
        ...content,
        valuation: { ...valuation, clubValues: [...valuation.clubValues].reverse() },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionSummaryDocumentContentSchema.safeParse({
        ...content,
        viewGlobalFactors: viewGlobalFactors('realized'),
      }).success
    ).toBe(false);
  });

  it('requires unique canonical view-global factor ordering', () => {
    expect(
      aflTradeProjectionViewGlobalFactorsSchema.safeParse(viewGlobalFactors('current')).success
    ).toBe(true);
    expect(
      aflTradeProjectionViewGlobalFactorsSchema.safeParse({
        view: 'current',
        factors: [...canonicalFactors].reverse(),
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionViewGlobalFactorsSchema.safeParse({
        view: 'current',
        factors: [canonicalFactors[0], canonicalFactors[0]],
      }).success
    ).toBe(false);
  });

  it('requires complete canonical detail views while preserving per-view temporal identity', () => {
    const content = detailContent();
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse({
        ...content,
        valuations: [...content.valuations].reverse(),
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse({
        ...content,
        valuations: content.valuations.slice(1),
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse({
        ...content,
        viewGlobalFactors: [...content.viewGlobalFactors].reverse(),
      }).success
    ).toBe(false);
    const historicalAtTrade = content.valuations.map((valuation, index) =>
      index === 0 && valuation.temporalContext
        ? {
            ...valuation,
            temporalContext: {
              effectiveAt: '2020-11-12T00:00:00.000Z',
              knowledgeCutoffAt: '2020-11-11T23:59:59.000Z',
              valuationAsOf: '2020-11-12T00:00:00.000Z',
            },
          }
        : valuation
    );
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse({
        ...content,
        valuations: historicalAtTrade,
      }).success
    ).toBe(true);
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse({
        ...content,
        valuations: historicalAtTrade.map((valuation, index) =>
          index === 0 && valuation.temporalContext
            ? {
                ...valuation,
                temporalContext: {
                  ...valuation.temporalContext,
                  knowledgeCutoffAt: '2020-11-12T00:00:00.001Z',
                },
              }
            : valuation
        ),
      }).success
    ).toBe(false);
  });

  it('reuses complete-detail attribution invariants and canonical asset ordering', () => {
    const content = detailContent();
    const reversedAssets = [...content.assets].reverse();
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse({
        ...content,
        assets: reversedAssets,
      }).success
    ).toBe(false);

    const assets = structuredClone(content.assets);
    const firstValue = assets[0].values[0];
    if (firstValue.status !== 'valued') throw new Error('Expected valued asset fixture.');
    firstValue.estimate += 1;
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse({ ...content, assets }).success
    ).toBe(false);

    const repeatedClubFactor = structuredClone(content);
    const firstValuation = repeatedClubFactor.valuations[0];
    if (!('clubValues' in firstValuation)) throw new Error('Expected available valuation fixture.');
    firstValuation.clubValues[0].factors = [canonicalFactors[0]];
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse(repeatedClubFactor).success
    ).toBe(false);

    const repeatedAssetFactor = structuredClone(content);
    const repeatedAssetValue = repeatedAssetFactor.assets[0].values[0];
    if (repeatedAssetValue.status !== 'valued') throw new Error('Expected valued asset fixture.');
    repeatedAssetValue.factors = [canonicalFactors[0]];
    expect(
      aflTradeProjectionDetailDocumentContentSchema.safeParse(repeatedAssetFactor).success
    ).toBe(false);
  });

  it('binds exactly one canonical methodology to bundle, unit, calculation, and all views', () => {
    const content = methodologyContent();
    expect(
      aflTradeProjectionMaterializationBindingSchema.safeParse(content.projectionMaterialization)
        .success
    ).toBe(true);
    const artifact = createArtifact(content);
    expect(artifact.projectionDocument.content.kind).toBe('methodology');
    expect(verifyAflTradeProjectionDocumentArtifact(artifact)).toBe(true);
    expect(
      aflTradeProjectionMethodologyDocumentContentSchema.safeParse({
        ...content,
        valuationBundleId: `valuation-bundle:${digest('e')}`,
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionMethodologyDocumentContentSchema.safeParse({
        ...content,
        methodology: {
          ...content.methodology,
          supportedViews: [...content.methodology.supportedViews].reverse(),
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionMethodologyDocumentContentSchema.safeParse({
        ...content,
        methodology: {
          ...content.methodology,
          components: [...content.methodology.components].reverse(),
        },
      }).success
    ).toBe(false);
  });

  it('requires methodology materialization identity to match every common document coordinate', () => {
    const content = methodologyContent();
    const mutations = [
      { publicationId: `publication:${digest('6')}` },
      { valuationOutputInventoryIndexId: `valuation-output-inventory-index:${digest('7')}` },
      { scopeKey: 'different-public-scope' },
      { valueUnitId: 'different-value-unit' },
      { calculationAsOf: '2026-08-05T03:00:01.000Z' },
      { knowledgeCutoffAt: '2026-08-05T01:00:01.000Z' },
    ];
    for (const mutation of mutations) {
      expect(
        aflTradeProjectionMethodologyDocumentContentSchema.safeParse({
          ...content,
          projectionMaterialization: {
            ...content.projectionMaterialization,
            ...mutation,
          },
        }).success
      ).toBe(false);
    }
    expect(
      aflTradeProjectionMaterializationBindingSchema.safeParse({
        ...content.projectionMaterialization,
        projectionPublicEvidenceIndexId: `projection-presentation-policy:${digest('8')}`,
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionMaterializationBindingSchema.safeParse({
        ...content.projectionMaterialization,
        approvalStatus: 'approved',
      }).success
    ).toBe(false);
  });

  it('rejects non-canonical refs, invalid counts or digests, and broken materialization chronology', () => {
    const content = methodologyContent();
    const binding = content.projectionMaterialization;
    for (const mutation of [
      { artifactRef: { ...binding.artifactRef, mediaType: 'application/octet-stream' } },
      { artifactRef: { ...binding.artifactRef, byteLength: 0 } },
      { artifactRef: { ...binding.artifactRef, byteLength: 512 * 1024 + 1 } },
      { artifactRef: { ...binding.artifactRef, artifactId: `artifact:${digest('9')}` } },
      { tradeCount: 2, documentCount: 9 },
      { tradeCount: 1, documentCount: 78 },
      { entrySetSha256: digest('g') },
      { knowledgeCutoffAt: '2026-08-05T03:00:00.001Z' },
      { calculationAsOf: '2026-08-05T03:30:00.001Z' },
    ]) {
      expect(
        aflTradeProjectionMaterializationBindingSchema.safeParse({
          ...binding,
          ...mutation,
        }).success
      ).toBe(false);
    }

    const futureRoot = {
      ...content,
      projectionMaterialization: {
        ...binding,
        artifactRef: {
          ...binding.artifactRef,
          createdAt: '2026-08-05T04:00:00.001Z',
        },
      },
    };
    expect(aflTradeProjectionMethodologyDocumentContentSchema.safeParse(futureRoot).success).toBe(
      true
    );
    expect(() => createArtifact(futureRoot, materializedAt)).toThrow(
      'Invalid AFL trade projection document artifact input.'
    );
  });

  it('requires available export rows to select the exact canonical club outcome', () => {
    const content = exportContent();
    const selectedClubOutcome = content.exportRow.selectedClubOutcome;
    if (!selectedClubOutcome) throw new Error('Expected selected club outcome fixture.');

    expect(aflTradeProjectionExportRowDocumentContentSchema.safeParse(content).success).toBe(true);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: { ...content.exportRow, rowOrdinal: 0 },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: { ...content.exportRow, clubValue: null },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: {
          ...content.exportRow,
          selectedClubOutcome: {
            ...selectedClubOutcome,
            aflClubId: 'fixture-club-a',
          },
        },
      }).success
    ).toBe(false);
  });

  it('binds export outcome P10 and P90 to the selected club interval around its median', () => {
    const content = exportContent();
    const selectedClubOutcome = content.exportRow.selectedClubOutcome;
    if (!selectedClubOutcome) throw new Error('Expected selected club outcome fixture.');

    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: {
          ...content.exportRow,
          selectedClubOutcome: {
            ...selectedClubOutcome,
            distribution: {
              ...selectedClubOutcome.distribution,
              downside: { quantile: 0.1, value: 5 },
            },
          },
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: {
          ...content.exportRow,
          selectedClubOutcome: {
            ...selectedClubOutcome,
            distribution: {
              ...selectedClubOutcome.distribution,
              upside: { quantile: 0.9, value: 11 },
            },
          },
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: {
          ...content.exportRow,
          selectedClubOutcome: {
            ...selectedClubOutcome,
            distribution: {
              ...selectedClubOutcome.distribution,
              downside: { quantile: 0.1, value: 9 },
            },
          },
        },
      }).success
    ).toBe(false);
  });

  it('emits view-global factors exactly once on export ordinal zero', () => {
    const firstRow = exportContent(summary(), 0);
    const laterRow = exportContent();

    expect(aflTradeProjectionExportRowDocumentContentSchema.safeParse(firstRow).success).toBe(true);
    expect(aflTradeProjectionExportRowDocumentContentSchema.safeParse(laterRow).success).toBe(true);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...firstRow,
        viewGlobalFactors: null,
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...laterRow,
        viewGlobalFactors: viewGlobalFactors(laterRow.exportRow.view),
      }).success
    ).toBe(false);
  });

  it('uses one null-club row at ordinal zero for unavailable export values', () => {
    const content = exportContent(unavailableSummary(), 0);
    const available = summary();
    if (!('clubValues' in available)) throw new Error('Expected available summary.');
    expect(aflTradeProjectionExportRowDocumentContentSchema.safeParse(content).success).toBe(true);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: { ...content.exportRow, rowOrdinal: 1 },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: { ...content.exportRow, clubValue: available.clubValues[0] },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        viewGlobalFactors: null,
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionExportRowDocumentContentSchema.safeParse({
        ...content,
        exportRow: {
          ...content.exportRow,
          selectedClubOutcome: exportContent(available, 0).exportRow.selectedClubOutcome,
        },
      }).success
    ).toBe(false);
  });

  it.each(runtimeSummaryStates)(
    'rejects the request-time or derived %s state from immutable summary storage',
    (availability) => {
      const valuation = runtimeSummaryState(availability);
      expect(aflTradeValueSummarySchema.safeParse(valuation).success).toBe(true);
      expect(
        aflTradeProjectionSummaryDocumentContentSchema.safeParse({
          ...summaryContent(),
          valuation,
        }).success
      ).toBe(false);
    }
  );

  it('enforces knowledge and materialization chronology', () => {
    expect(
      aflTradeProjectionSummaryDocumentContentSchema.safeParse({
        ...summaryContent(),
        knowledgeCutoffAt: '2026-08-05T03:00:01.000Z',
      }).success
    ).toBe(false);
    expect(() => createArtifact(summaryContent(), '2026-08-05T02:59:59.000Z')).toThrow(
      'Invalid AFL trade projection document artifact input.'
    );

    const artifact = createArtifact();
    expect(
      verifyAflTradeProjectionDocumentArtifact({
        ...artifact,
        projectionDocumentArtifactRef: {
          ...artifact.projectionDocumentArtifactRef,
          createdAt: '2026-08-05T02:59:59.000Z',
        },
      })
    ).toBe(false);
  });

  it('rejects oversized and non-canonical-media artifact references', () => {
    const artifact = createArtifact();
    expect(
      verifyAflTradeProjectionDocumentArtifact({
        ...artifact,
        projectionDocumentArtifactRef: {
          ...artifact.projectionDocumentArtifactRef,
          byteLength: AFL_TRADE_PROJECTION_DOCUMENT_MAX_BYTES + 1,
        },
      })
    ).toBe(false);
    expect(
      verifyAflTradeProjectionDocumentArtifact({
        ...artifact,
        projectionDocumentArtifactRef: {
          ...artifact.projectionDocumentArtifactRef,
          mediaType: 'text/csv',
        },
      })
    ).toBe(false);
  });

  it('requires exact envelopes and excludes serving and fantasy ownership fields', () => {
    const artifact = createArtifact();
    expect(verifyAflTradeProjectionDocumentArtifact({ ...artifact, extra: true })).toBe(false);
    expect(() =>
      createAflTradeProjectionDocumentArtifact({
        content: summaryContent(),
        materializedAt,
        extra: true,
      } as never)
    ).toThrow('Invalid AFL trade projection document artifact input.');
    expect(
      aflTradeProjectionDocumentSchema.safeParse({
        ...artifact.projectionDocument,
        content: { ...summaryContent(), servedAt: materializedAt },
      }).success
    ).toBe(false);
    expect(
      aflTradeProjectionSummaryDocumentContentSchema.safeParse({
        ...summaryContent(),
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
        ownerId: 'fixture-owner',
      }).success
    ).toBe(false);

    expect(artifact.projectionDocument.content.publicAssetBoundary).toBe(
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    );
    expect(artifact.projectionDocument.content).not.toHaveProperty('servedAt');
    expect(artifact.projectionDocument.content).not.toHaveProperty('registryRevision');
    expect(artifact.projectionDocument.content).not.toHaveProperty('selection');
    expect(artifact.projectionDocument.content).not.toHaveProperty('freshness');
  });

  it('is total for hostile, revoked, symbol-extended, and throwing inputs', () => {
    const artifact = createArtifact();
    const revoked = Proxy.revocable(artifact, {});
    revoked.revoke();
    expect(verifyAflTradeProjectionDocumentArtifact(revoked.proxy)).toBe(false);
    expect(
      verifyAflTradeProjectionDocumentArtifact(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error('hostile ownKeys');
            },
          }
        )
      )
    ).toBe(false);
    expect(
      verifyAflTradeProjectionDocumentArtifact(
        Object.defineProperties(
          {},
          {
            projectionDocument: {
              enumerable: true,
              get() {
                throw new Error('hostile getter');
              },
            },
            projectionDocumentArtifactRef: { enumerable: true, value: {} },
          }
        )
      )
    ).toBe(false);
    expect(verifyAflTradeProjectionDocumentArtifact({ ...artifact, [Symbol('extra')]: true })).toBe(
      false
    );
  });

  it('snapshots each top-level verifier property once, including through a proxy', () => {
    const artifact = createArtifact();
    const reads = new Map<PropertyKey, number>();
    const input = new Proxy(artifact, {
      get(target, property, receiver) {
        reads.set(property, (reads.get(property) ?? 0) + 1);
        return Reflect.get(target, property, receiver);
      },
    });

    expect(verifyAflTradeProjectionDocumentArtifact(input)).toBe(true);
    expect(reads.get('projectionDocument')).toBe(1);
    expect(reads.get('projectionDocumentArtifactRef')).toBe(1);
  });

  it('deep-freezes created results and rejects document or reference tampering', () => {
    const artifact = createArtifact();
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.projectionDocument)).toBe(true);
    expect(Object.isFrozen(artifact.projectionDocument.content)).toBe(true);
    expect(Object.isFrozen(artifact.projectionDocumentArtifactRef)).toBe(true);

    const tamperedDocument = structuredClone(artifact);
    tamperedDocument.projectionDocument.content.scopeKey = 'different-public-scope';
    expect(verifyAflTradeProjectionDocumentArtifact(tamperedDocument)).toBe(false);

    const tamperedReference = structuredClone(artifact);
    tamperedReference.projectionDocumentArtifactRef.contentSha256 = digest('f');
    expect(verifyAflTradeProjectionDocumentArtifact(tamperedReference)).toBe(false);
  });
});
