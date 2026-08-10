import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_VALUE_AVAILABILITY,
  AFL_TRADE_VALUE_BEARING_AVAILABILITY,
  AFL_TRADE_VALUE_UNAVAILABLE_AVAILABILITY,
  aflTradePublicHrefSchema,
  aflTradeValueResultSchema,
  type AflTradeValueAvailability,
} from '@/types/aflTradeIntelligence';

const warning = {
  code: 'fixture-warning',
  severity: 'warning' as const,
  message: 'A fabricated warning for contract testing.',
};

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
        assetId: 'fixture-unresolved-asset',
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

function partial() {
  return {
    ...numericCore(),
    availability: 'available_partial' as const,
    comparison: {
      ...numericCore().comparison,
      basis: 'included_assets_only' as const,
      excludedAssetIds: ['fixture-unresolved-asset'],
    },
    assessment: { ...numericCore().assessment, scope: 'included_assets_only' as const },
    coverage: partialCoverage(),
    reasonCode: 'partial-asset-coverage',
    message: 'One fabricated asset is excluded from the numerical result.',
    nextAction: {
      kind: 'resolve_identity' as const,
      label: 'Resolve the remaining identity',
      href: '/afl-trades/methodology',
      expectedAfter: null,
    },
    warnings: [warning],
  };
}

function stale() {
  return {
    ...numericCore(),
    availability: 'stale' as const,
    coverage: completeCoverage(),
    reasonCode: 'publication-stale',
    message: 'The last approved fabricated result is older than its freshness threshold.',
    nextAction: {
      kind: 'retry_later' as const,
      label: 'Check again later',
      href: null,
      expectedAfter: '2026-01-03T00:00:00.000Z',
    },
    warnings: [warning],
    staleSince: '2026-01-02T00:00:00.000Z',
  };
}

function failedPreviousAvailable() {
  return {
    ...numericCore(),
    availability: 'failed_previous_available' as const,
    coverage: completeCoverage(),
    reasonCode: 'latest-calculation-failed',
    message: 'The last approved fabricated result remains visible after a failed attempt.',
    nextAction: {
      kind: 'retry_later' as const,
      label: 'Check again after the next attempt',
      href: null,
      expectedAfter: null,
    },
    warnings: [warning],
    latestAttemptFailedAt: '2026-01-02T00:00:00.000Z',
  };
}

const unavailableNextActions: Record<
  Exclude<AflTradeValueAvailability, (typeof AFL_TRADE_VALUE_BEARING_AVAILABILITY)[number]>,
  string
> = {
  not_calculated: 'await_calculation',
  source_blocked: 'await_source_approval',
  insufficient_data: 'collect_more_evidence',
  identity_unresolved: 'resolve_identity',
  lineage_unresolved: 'resolve_lineage',
  model_not_approved: 'await_model_approval',
  calculating: 'await_calculation',
  withdrawn: 'view_methodology',
  unsupported_trade: 'view_methodology',
};

type UnavailableState = keyof typeof unavailableNextActions;

const valueBearingFixtures: Record<
  (typeof AFL_TRADE_VALUE_BEARING_AVAILABILITY)[number],
  | ReturnType<typeof available>
  | ReturnType<typeof partial>
  | ReturnType<typeof stale>
  | ReturnType<typeof failedPreviousAvailable>
> = {
  available: available(),
  available_partial: partial(),
  stale: stale(),
  failed_previous_available: failedPreviousAvailable(),
};

function unavailable(availability: UnavailableState) {
  return {
    availability,
    view: 'current' as const,
    modelVintage: null,
    temporalContext: null,
    reasonCode: `fixture-${availability}`,
    message: `The fabricated result is ${availability}.`,
    nextAction: {
      kind: unavailableNextActions[availability],
      label: 'View the next safe action',
      href: '/afl-trades/methodology',
      expectedAfter: null,
    },
    warnings: [],
    methodologyHref: '/afl-trades/methodology',
  };
}

describe('AFL trade-intelligence availability contracts', () => {
  it('uses the complete canonical closed vocabulary in stable order', () => {
    expect(AFL_TRADE_VALUE_AVAILABILITY).toEqual([
      'not_calculated',
      'source_blocked',
      'insufficient_data',
      'identity_unresolved',
      'lineage_unresolved',
      'model_not_approved',
      'calculating',
      'available',
      'available_partial',
      'stale',
      'failed_previous_available',
      'withdrawn',
      'unsupported_trade',
    ]);
    expect(AFL_TRADE_VALUE_UNAVAILABLE_AVAILABILITY).toEqual(
      AFL_TRADE_VALUE_AVAILABILITY.filter(
        (availability) => !AFL_TRADE_VALUE_BEARING_AVAILABILITY.includes(availability as never)
      )
    );
  });

  it('accepts only same-site public paths', () => {
    expect(aflTradePublicHrefSchema.safeParse('/draft/trades/methodology').success).toBe(true);
    for (const href of ['//attacker.example', '/\\attacker.example', '/path\\redirect', '/bad path']) {
      expect(aflTradePublicHrefSchema.safeParse(href).success).toBe(false);
    }
  });

  it.each(Object.keys(unavailableNextActions) as UnavailableState[])(
    'accepts the honest non-numerical %s state',
    (availability) => {
      expect(aflTradeValueResultSchema.parse(unavailable(availability)).availability).toBe(
        availability
      );
    }
  );

  it.each(Object.keys(unavailableNextActions) as UnavailableState[])(
    'rejects fabricated numbers and unknown payload fields in %s',
    (availability) => {
      expect(
        aflTradeValueResultSchema.safeParse({
          ...unavailable(availability),
          estimate: 0,
        }).success
      ).toBe(false);
      expect(
        aflTradeValueResultSchema.safeParse({
          ...unavailable(availability),
          unexpectedField: true,
        }).success
      ).toBe(false);
    }
  );

  it.each(Object.values(valueBearingFixtures))(
    'accepts the value-bearing $availability state',
    (value) => {
      expect(aflTradeValueResultSchema.parse(value).availability).toBe(value.availability);
    }
  );

  it('rejects legacy and unknown availability states', () => {
    for (const availability of ['not_published', 'unsupported', 'mystery']) {
      expect(
        aflTradeValueResultSchema.safeParse({
          ...unavailable('not_calculated'),
          availability,
        }).success
      ).toBe(false);
    }
  });

  it('enforces status-specific next actions', () => {
    expect(
      aflTradeValueResultSchema.safeParse({
        ...unavailable('source_blocked'),
        nextAction: {
          kind: 'resolve_identity',
          label: 'Wrong action',
          href: null,
          expectedAfter: null,
        },
      }).success
    ).toBe(false);
  });

  it('rejects fantasy ownership fields from both numerical and unavailable payloads', () => {
    expect(
      aflTradeValueResultSchema.safeParse({
        ...available(),
        userId: 'fixture-user',
        leagueId: 'fixture-fantasy-league',
      }).success
    ).toBe(false);
    expect(
      aflTradeValueResultSchema.safeParse({
        ...unavailable('not_calculated'),
        rosterId: 'fixture-roster',
        fantasySeasonId: 'fixture-season',
      }).success
    ).toBe(false);
  });
});
