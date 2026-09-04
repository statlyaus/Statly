// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createAflTradeDevelopmentGradeDataset } from '@/server/aflTradeIntelligence/modeling/developmentTradeGradeDataset';
import {
  createAflTradeDevelopmentGradeModel,
  valueAflTradeDevelopmentTrade,
} from '@/server/aflTradeIntelligence/modeling/developmentTradeGradeModel';
import { deriveAflTradeStatlyGrades } from '@/server/aflTradeIntelligence/valuation/statlyGradePolicy';
import { aflTradeValueSummarySchema } from '@/types/aflTradeIntelligence';

const PROVIDERS = ['afl_tables', 'footywire', 'fryzigg'] as const;
type ValueSummary = ReturnType<typeof valueAflTradeDevelopmentTrade>['summaries'][keyof ReturnType<
  typeof valueAflTradeDevelopmentTrade
>['summaries']];

function requireAvailableSummary(
  summary: ValueSummary
): asserts summary is Extract<ValueSummary, { availability: 'available' }> {
  if (summary.availability !== 'available') {
    throw new Error('Expected an available valuation summary fixture.');
  }
}

function observedOutcome(value: number) {
  return {
    games: { state: 'observed' as const, value },
    goals: { state: 'observed' as const, value: value / 4 },
    coachesVotes: { state: 'observed' as const, value: value / 10 },
    brownlowVotes: { state: 'observed' as const, value: value / 20 },
  };
}

function acquisition(input: {
  id: string;
  year: number;
  playerId: string;
  pick: number;
  outcome: ReturnType<typeof observedOutcome> | Record<string, unknown>;
}) {
  return {
    acquisitionId: input.id,
    effectiveAt: `${input.year}-11-20T00:00:00.000Z`,
    outcomeMaturedAt: `${input.year + 3}-10-01T00:00:00.000Z`,
    outcomeObservedAt: '2026-08-07T00:00:00.000Z',
    seasonYear: input.year,
    mechanism: 'national_draft',
    receivingClubId: `club:${input.playerId}`,
    player: {
      identityState: 'resolved',
      playerId: input.playerId,
      playerName: `${input.playerId} name`,
    },
    selection: {
      nominalNumber: input.pick,
      actualNumber: input.pick,
      round: input.pick <= 20 ? 1 : 2,
      originalClubId: null,
    },
    atTrade: { age: 18, heightCm: 188, weightKg: 82 },
    outcome: input.outcome,
  };
}

function dataset(extraAcquisitions: ReturnType<typeof acquisition>[] = []) {
  const history = [
    acquisition({
      id: 'acq:h1',
      year: 2010,
      playerId: 'player:h1',
      pick: 10,
      outcome: observedOutcome(40),
    }),
    acquisition({
      id: 'acq:h2',
      year: 2011,
      playerId: 'player:h2',
      pick: 12,
      outcome: observedOutcome(60),
    }),
    acquisition({
      id: 'acq:h3',
      year: 2012,
      playerId: 'player:h3',
      pick: 14,
      outcome: observedOutcome(80),
    }),
    acquisition({
      id: 'acq:h4',
      year: 2013,
      playerId: 'player:h4',
      pick: 35,
      outcome: observedOutcome(20),
    }),
    acquisition({
      id: 'acq:h5',
      year: 2014,
      playerId: 'player:h5',
      pick: 38,
      outcome: observedOutcome(30),
    }),
  ];
  const acquisitions = [...history, ...extraAcquisitions];
  const providerSeasons = acquisitions.map((item) => ({
    observationId: `provider:${item.player.playerId}:${item.seasonYear - 1}`,
    playerId: item.player.playerId,
    seasonYear: item.seasonYear - 1,
    knownAt: `${item.seasonYear - 1}-10-01T00:00:00.000Z`,
    state: 'reconciled',
    sourceProviders: [...PROVIDERS],
    stats: { games: 20, goals: 5, coachesVotes: 3, brownlowVotes: 1 },
  }));
  return createAflTradeDevelopmentGradeDataset({
    schemaVersion: 'afl-trade-development-grade-dataset-input/v1',
    environment: 'test_fixture',
    createdAt: '2026-08-08T00:00:00.000Z',
    sourceBoundary: 'pinned_workbook_and_reconciled_fitzroy_no_fantasy_ownership',
    fixedOutcomeHorizonSeasons: 3,
    acquisitions,
    providerSeasons,
  });
}

function trade(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'afl-trade-development-grade-case/v1',
    tradeId: 'trade:2018:alpha-beta',
    effectiveAt: '2018-10-10T00:00:00.000Z',
    asOf: '2026-08-08T00:00:00.000Z',
    parties: [
      {
        aflClubId: 'club:alpha',
        clubName: 'Alpha',
        assets: [
          {
            assetId: 'asset:alpha-pick',
            kind: 'pick',
            lineageState: 'resolved',
            acquisitionId: 'acq:alpha',
            selection: { nominalNumber: 12, round: 1 },
          },
        ],
      },
      {
        aflClubId: 'club:beta',
        clubName: 'Beta',
        assets: [
          {
            assetId: 'asset:beta-pick',
            kind: 'pick',
            lineageState: 'resolved',
            acquisitionId: 'acq:beta',
            selection: { nominalNumber: 38, round: 2 },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function currentAcquisitions() {
  return [
    acquisition({
      id: 'acq:alpha',
      year: 2018,
      playerId: 'player:alpha',
      pick: 12,
      outcome: observedOutcome(90),
    }),
    acquisition({
      id: 'acq:beta',
      year: 2018,
      playerId: 'player:beta',
      pick: 38,
      outcome: observedOutcome(15),
    }),
  ];
}

describe('development AFL trade grade model', () => {
  it('produces contract-valid at-trade, realized, remaining and current summaries', () => {
    const source = dataset(currentAcquisitions());
    const model = createAflTradeDevelopmentGradeModel(source, {
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
      practicalEquivalenceTolerance: 5,
    });
    const result = valueAflTradeDevelopmentTrade({ dataset: source, model, trade: trade() });

    expect(Object.keys(result.summaries)).toEqual(['at_trade', 'realized', 'remaining', 'current']);
    Object.values(result.summaries).forEach((summary) => {
      expect(aflTradeValueSummarySchema.safeParse(summary).success).toBe(true);
      expect(summary.methodologyHref).toBe('/draft/trades/methodology');
      expect(summary.warnings).toContainEqual(
        expect.objectContaining({ code: 'development-workbook-preview' })
      );
      expect(deriveAflTradeStatlyGrades(summary).state).toBe('provisional');
    });
  });

  it('does not use outcomes that had not matured at the at-trade cutoff', () => {
    const original = dataset(currentAcquisitions());
    const contaminated = dataset([
      ...currentAcquisitions(),
      acquisition({
        id: 'acq:future',
        year: 2017,
        playerId: 'player:future',
        pick: 12,
        outcome: observedOutcome(10_000),
      }),
    ]);
    const config = {
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
      practicalEquivalenceTolerance: 5,
    };

    const first = valueAflTradeDevelopmentTrade({
      dataset: original,
      model: createAflTradeDevelopmentGradeModel(original, config),
      trade: trade(),
    });
    const second = valueAflTradeDevelopmentTrade({
      dataset: contaminated,
      model: createAflTradeDevelopmentGradeModel(contaminated, config),
      trade: trade(),
    });

    requireAvailableSummary(first.summaries.at_trade);
    requireAvailableSummary(second.summaries.at_trade);
    expect(second.summaries.at_trade.clubValues).toEqual(first.summaries.at_trade.clubValues);
  });

  it('uses only reconciled pre-trade provider observations as player features', () => {
    const source = dataset(currentAcquisitions());
    const result = valueAflTradeDevelopmentTrade({
      dataset: source,
      model: createAflTradeDevelopmentGradeModel(source, {
        createdAt: '2026-08-08T00:00:00.000Z',
        minimumCohortSize: 2,
        practicalEquivalenceTolerance: 5,
      }),
      trade: trade(),
    });

    expect(
      result.assets.find(({ assetId }) => assetId === 'asset:alpha-pick')?.featureProviders
    ).toEqual(['afl_tables', 'footywire', 'fryzigg']);
  });

  it('marks current grading partial for a right-censored active career', () => {
    const partial = acquisition({
      id: 'acq:alpha',
      year: 2025,
      playerId: 'player:alpha',
      pick: 12,
      outcome: {
        games: { state: 'partial', observedValue: 8, reason: 'active_career_right_censored' },
        goals: { state: 'partial', observedValue: 2, reason: 'active_career_right_censored' },
        coachesVotes: {
          state: 'partial',
          observedValue: 0,
          reason: 'active_career_right_censored',
        },
        brownlowVotes: {
          state: 'partial',
          observedValue: 0,
          reason: 'active_career_right_censored',
        },
      },
    });
    partial.effectiveAt = '2025-10-15T00:00:00.000Z';
    partial.outcomeMaturedAt = '2028-10-01T00:00:00.000Z';
    const source = dataset([
      partial,
      acquisition({
        id: 'acq:beta',
        year: 2025,
        playerId: 'player:beta',
        pick: 38,
        outcome: partial.outcome,
      }),
    ]);
    const result = valueAflTradeDevelopmentTrade({
      dataset: source,
      model: createAflTradeDevelopmentGradeModel(source, {
        createdAt: '2026-08-08T00:00:00.000Z',
        minimumCohortSize: 2,
        practicalEquivalenceTolerance: 5,
      }),
      trade: trade({ effectiveAt: '2025-10-15T00:00:00.000Z' }),
    });

    requireAvailableSummary(result.summaries.current);
    requireAvailableSummary(result.summaries.realized);
    expect(result.summaries.current.availability).toBe('available');
    expect(result.summaries.current.confidence.level).toBe('low');
    expect(result.summaries.realized.confidence.level).toBe('low');
    expect(result.assets.find(({ assetId }) => assetId === 'asset:alpha-pick')?.state).toBe(
      'right_censored'
    );
  });

  it('excludes unresolved lineage instead of inventing a pick or player outcome', () => {
    const source = dataset(currentAcquisitions());
    const input = trade();
    const result = valueAflTradeDevelopmentTrade({
      dataset: source,
      model: createAflTradeDevelopmentGradeModel(source, {
        createdAt: '2026-08-08T00:00:00.000Z',
        minimumCohortSize: 2,
        practicalEquivalenceTolerance: 5,
      }),
      trade: {
        ...input,
        parties: input.parties.map((party, index) =>
          index === 0
            ? {
                ...party,
                assets: party.assets.map((asset) => ({ ...asset, lineageState: 'unresolved' })),
              }
            : party
        ),
      },
    });

    expect(result.summaries.current.availability).toBe('lineage_unresolved');
    expect(result.assets.find(({ assetId }) => assetId === 'asset:alpha-pick')?.state).toBe(
      'lineage_unresolved'
    );
  });

  it('conserves probability across all parties and practical equivalence', () => {
    const source = dataset(currentAcquisitions());
    const base = trade();
    const result = valueAflTradeDevelopmentTrade({
      dataset: source,
      model: createAflTradeDevelopmentGradeModel(source, {
        createdAt: '2026-08-08T00:00:00.000Z',
        minimumCohortSize: 2,
        practicalEquivalenceTolerance: 5,
      }),
      trade: {
        ...base,
        parties: [
          ...base.parties,
          {
            aflClubId: 'club:gamma',
            clubName: 'Gamma',
            assets: [
              {
                assetId: 'asset:gamma-future',
                kind: 'future_pick',
                lineageState: 'resolved',
                acquisitionId: null,
                selection: { nominalNumber: null, round: 1 },
              },
            ],
          },
        ],
      },
    });
    const summary = result.summaries.at_trade;
    requireAvailableSummary(summary);
    const total =
      summary.clubValues.reduce((sum, club) => sum + club.finishesAheadProbability, 0) +
      summary.practicalEquivalenceProbability;

    expect(total).toBeCloseTo(1, 12);
  });

  it('keeps multi-party results invariant when parties and assets are reordered', () => {
    const source = dataset(currentAcquisitions());
    const model = createAflTradeDevelopmentGradeModel(source, {
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
      practicalEquivalenceTolerance: 5,
    });
    const base = trade();
    const gamma = {
      aflClubId: 'club:gamma',
      clubName: 'Gamma',
      assets: [
        {
          assetId: 'asset:gamma-pick',
          kind: 'pick',
          lineageState: 'resolved',
          acquisitionId: null,
          selection: { nominalNumber: 14, round: 1 },
        },
        {
          assetId: 'asset:gamma-future',
          kind: 'future_pick',
          lineageState: 'resolved',
          acquisitionId: null,
          selection: { nominalNumber: null, round: 1 },
        },
      ],
    };
    const first = valueAflTradeDevelopmentTrade({
      dataset: source,
      model,
      trade: { ...base, parties: [...base.parties, gamma] },
    });
    const second = valueAflTradeDevelopmentTrade({
      dataset: source,
      model,
      trade: {
        ...base,
        parties: [
          { ...gamma, assets: [...gamma.assets].reverse() },
          ...[...base.parties].reverse(),
        ],
      },
    });

    for (const view of ['at_trade', 'realized', 'remaining', 'current'] as const) {
      expect(second.summaries[view]).toEqual(first.summaries[view]);
    }
  });

  it('reports a shared lead as balanced instead of favouring the first tied club', () => {
    const gammaAcquisition = acquisition({
      id: 'acq:gamma',
      year: 2018,
      playerId: 'player:gamma',
      pick: 14,
      outcome: observedOutcome(90),
    });
    const source = dataset([...currentAcquisitions(), gammaAcquisition]);
    const model = createAflTradeDevelopmentGradeModel(source, {
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
      practicalEquivalenceTolerance: 5,
    });
    const base = trade();
    const result = valueAflTradeDevelopmentTrade({
      dataset: source,
      model,
      trade: {
        ...base,
        parties: [
          ...base.parties,
          {
            aflClubId: 'club:gamma',
            clubName: 'Gamma',
            assets: [
              {
                assetId: 'asset:gamma-pick',
                kind: 'pick',
                lineageState: 'resolved',
                acquisitionId: 'acq:gamma',
                selection: { nominalNumber: 14, round: 1 },
              },
            ],
          },
        ],
      },
    });

    requireAvailableSummary(result.summaries.realized);
    expect(result.summaries.realized.assessment).toEqual({
      interpretation: 'balanced_within_uncertainty',
      favouredAflClubId: null,
      scope: 'complete_trade',
    });
    expect(
      result.summaries.realized.clubValues.filter(
        ({ finishesAheadProbability }) => finishesAheadProbability === 0.5
      )
    ).toHaveLength(2);
  });

  it('is deterministic and never exposes workbook grade, expected or actual fields', () => {
    const source = dataset(currentAcquisitions());
    const model = createAflTradeDevelopmentGradeModel(source, {
      createdAt: '2026-08-08T00:00:00.000Z',
      minimumCohortSize: 2,
      practicalEquivalenceTolerance: 5,
    });
    const first = valueAflTradeDevelopmentTrade({ dataset: source, model, trade: trade() });
    const second = valueAflTradeDevelopmentTrade({ dataset: source, model, trade: trade() });
    const serialized = JSON.stringify(first);

    expect(second).toEqual(first);
    expect(serialized).not.toMatch(/legacy|"expected"|"actual"|workbookGrade/i);
  });
});
