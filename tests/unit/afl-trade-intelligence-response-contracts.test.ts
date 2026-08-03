import { describe, expect, it } from 'vitest';

import {
  aflTradeConsistencyEnvelopeSchema,
  aflTradeValueDetailResponseSchema,
  aflTradeValueListResponseSchema,
  type AflTradeConsistencyEnvelope,
  type AflTradeValueResult,
} from '@/types/aflTradeIntelligence';

const publication = {
  publicationId: `publication:${'a'.repeat(64)}`,
  state: 'published' as const,
  modelId: 'afl-contribution-model',
  modelVersion: '1.0.0',
  datasetId: `dataset:${'b'.repeat(64)}`,
  publishedAt: '2026-01-01T12:00:00.000Z',
};

function consistency(): AflTradeConsistencyEnvelope {
  return {
    contractVersion: 'afl-trade-value/v1' as const,
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
    contractVersion: 'afl-trade-value/v1' as const,
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

function available(): AflTradeValueResult {
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

function withdrawn(): AflTradeValueResult {
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
  valuation: AflTradeValueResult,
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

  it('enforces calculation, publication, knowledge, and serving chronology', () => {
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
    expect(aflTradeValueListResponseSchema.safeParse(listResponse(available())).success).toBe(true);
    expect(
      aflTradeValueListResponseSchema.safeParse(
        listResponse(available(), noPublicationConsistency())
      ).success
    ).toBe(false);
  });

  it('prevents per-item publication overrides and mixed requested views', () => {
    expect(
      aflTradeValueListResponseSchema.safeParse(
        listResponse({
          ...available(),
          publication: {
            ...publication,
            publicationId: `publication:${'e'.repeat(64)}`,
          },
        } as unknown as AflTradeValueResult)
      ).success
    ).toBe(false);
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...listResponse(available()),
        requestedView: 'at_trade',
      }).success
    ).toBe(false);
  });

  it('enforces pagination bounds and unique list trade identifiers', () => {
    const list = listResponse(available());
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
  });

  it('requires unique detail views and reconciled lineage status', () => {
    const detail = {
      consistency: consistency(),
      tradeId: 'fixture-trade-1',
      valuations: [available(), available()],
      lineageStatus: 'resolved',
      unresolvedAssetCount: 0,
    };
    expect(aflTradeValueDetailResponseSchema.safeParse(detail).success).toBe(false);
    expect(
      aflTradeValueDetailResponseSchema.safeParse({
        ...detail,
        valuations: [available()],
        unresolvedAssetCount: 1,
      }).success
    ).toBe(false);
    expect(
      aflTradeValueDetailResponseSchema.safeParse({
        ...detail,
        valuations: [available()],
        lineageStatus: 'partial',
        unresolvedAssetCount: 1,
      }).success
    ).toBe(true);
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
      aflTradeValueListResponseSchema.safeParse(listResponse(available(), withdrawnConsistency))
        .success
    ).toBe(false);
    expect(
      aflTradeValueDetailResponseSchema.safeParse({
        consistency: withdrawnConsistency,
        tradeId: 'fixture-trade-1',
        valuations: [available()],
        lineageStatus: 'resolved',
        unresolvedAssetCount: 0,
      }).success
    ).toBe(false);
  });

  it('rejects fantasy ownership and unknown fields at response boundaries', () => {
    expect(
      aflTradeValueListResponseSchema.safeParse({
        ...listResponse(available()),
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
  });
});
