import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_METHODOLOGY_HREF,
  aflTradeMethodologyResponseSchema,
  type AflTradeMethodologyResponse,
} from '@/types/aflTradeIntelligence';

const valuationBundleId = `valuation-bundle:${'b'.repeat(64)}`;
const valueUnit = {
  id: 'contribution-above-replacement-v1',
  label: 'Contribution above replacement',
  description: 'A fabricated unit used only to verify the public methodology contract.',
  direction: 'higher_is_better' as const,
};

function publishedResponse(): AflTradeMethodologyResponse {
  return {
    availability: 'published',
    consistency: {
      contractVersion: 'afl-trade-value/v2',
      selection: 'active',
      publication: {
        publicationId: `publication:${'a'.repeat(64)}`,
        state: 'published',
        valuationBundleId,
        valueUnitId: valueUnit.id,
        publishedAt: '2026-01-02T00:00:00.000Z',
      },
      registryRevision: 4,
      projectionBuildId: `projection:${'c'.repeat(64)}`,
      servedAt: '2026-01-03T00:00:00.000Z',
      calculationAsOf: '2026-01-01T12:00:00.000Z',
      knowledgeCutoffAt: '2026-01-01T00:00:00.000Z',
      freshness: 'current',
      supportedScope: ['Fabricated resolved AFL trade assets'],
      excludedScope: ['Fabricated unresolved AFL trade assets'],
      warnings: [],
    },
    methodologyHref: '/draft/trades/methodology/publication-fixture',
    methodology: {
      valuationBundleId,
      modelVersion: 'fixture-model-2026.1',
      components: [
        {
          role: 'player_contribution_and_availability',
          modelVersion: 'fixture-player-1.0.0',
          summary: 'Fabricated player contribution and availability component.',
        },
        {
          role: 'draft_pick_and_future_pick_distribution',
          modelVersion: 'fixture-pick-1.0.0',
          summary: 'Fabricated draft-pick and future-pick distribution component.',
        },
      ],
      valueUnit,
      primaryOutcome: {
        code: 'fixture-club-contribution',
        label: 'Fabricated club contribution',
        definition: 'Fabricated definition used only for contract validation.',
      },
      trainingPeriod: { firstSeason: 2001, lastSeason: 2024 },
      calculationAsOf: '2026-01-01T12:00:00.000Z',
      supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
      supportedDataCoverage: ['Fabricated resolved AFL trade assets'],
      knownLimitations: ['Fabricated limitation used only for contract validation.'],
      materialChangesFromPrevious: [],
    },
  };
}

function unavailableResponse(): AflTradeMethodologyResponse {
  return {
    consistency: {
      contractVersion: 'afl-trade-value/v2',
      selection: 'none',
      publication: null,
      registryRevision: 0,
      projectionBuildId: null,
      servedAt: '2026-01-03T00:00:00.000Z',
      calculationAsOf: null,
      knowledgeCutoffAt: null,
      freshness: 'unavailable',
      supportedScope: [],
      excludedScope: ['Numerical AFL trade valuation pending approved evidence use'],
      warnings: [],
    },
    availability: 'unavailable',
    reasonCode: 'source-approval-required',
    message: 'Required evidence use has not been approved.',
    nextAction: {
      kind: 'await_source_approval',
      label: 'Read methodology and current limits',
      href: AFL_TRADE_METHODOLOGY_HREF,
      expectedAfter: null,
    },
    methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
    methodology: null,
  };
}

describe('AFL trade-intelligence methodology contracts', () => {
  it('accepts truthful unavailable and publication-bound metadata responses', () => {
    expect(aflTradeMethodologyResponseSchema.parse(unavailableResponse()).availability).toBe(
      'unavailable'
    );
    expect(aflTradeMethodologyResponseSchema.parse(publishedResponse()).availability).toBe(
      'published'
    );
  });

  it('rejects unavailable metadata that claims an active publication', () => {
    const response = unavailableResponse();
    expect(
      aflTradeMethodologyResponseSchema.safeParse({
        ...response,
        consistency: publishedResponse().consistency,
      }).success
    ).toBe(false);
  });

  it.each([
    ['bundle', { valuationBundleId: `valuation-bundle:${'d'.repeat(64)}` }],
    ['value unit', { valueUnit: { ...valueUnit, id: 'different-unit' } }],
    ['calculation time', { calculationAsOf: '2026-01-01T13:00:00.000Z' }],
  ])('rejects methodology that drifts from the selected %s', (_label, patch) => {
    const response = publishedResponse();
    expect(
      aflTradeMethodologyResponseSchema.safeParse({
        ...response,
        methodology: { ...response.methodology, ...patch },
      }).success
    ).toBe(false);
  });

  it('requires both governed component roles and all four public views', () => {
    const response = publishedResponse();
    if (!response.methodology) throw new Error('Expected published methodology fixture.');

    expect(
      aflTradeMethodologyResponseSchema.safeParse({
        ...response,
        methodology: {
          ...response.methodology,
          components: [response.methodology.components[0], response.methodology.components[0]],
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeMethodologyResponseSchema.safeParse({
        ...response,
        methodology: { ...response.methodology, supportedViews: ['current'] },
      }).success
    ).toBe(false);
  });

  it('rejects an inverted training period and withdrawn publication metadata', () => {
    const response = publishedResponse();
    if (!response.methodology || !response.consistency.publication) {
      throw new Error('Expected published methodology fixture.');
    }

    expect(
      aflTradeMethodologyResponseSchema.safeParse({
        ...response,
        methodology: {
          ...response.methodology,
          trainingPeriod: { firstSeason: 2024, lastSeason: 2001 },
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeMethodologyResponseSchema.safeParse({
        ...response,
        consistency: {
          ...response.consistency,
          freshness: 'withdrawn',
          publication: { ...response.consistency.publication, state: 'withdrawn' },
        },
      }).success
    ).toBe(false);
  });
});
