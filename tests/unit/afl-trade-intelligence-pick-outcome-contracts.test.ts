import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  aflTradePickOutcomeObservationSchema,
  aflTradePickOutcomeObservationSetContentSchema,
  aflTradePickOutcomeObservationSetSchema,
  createAflTradePickOutcomeObservationSet,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSetContent,
} from '@/server/aflTradeIntelligence/modeling/pickOutcomeContracts';

const digest = (character: string) => character.repeat(64);
const partitionYears = {
  train: 2000,
  calibration: 2004,
  validation: 2008,
  final_test: 2012,
} as const;

function observation(
  partition: keyof typeof partitionYears,
  overrides: Partial<AflTradePickOutcomeObservation> = {}
): AflTradePickOutcomeObservation {
  const draftYear = partitionYears[partition];
  const outcomeHorizonEndsAt = `${draftYear + 2}-12-31T00:00:00.000Z`;
  return {
    observationId: `fixture-pick-observation-${partition}`,
    playerId: `fixture-draftee-${partition}`,
    draftClassId: `fixture-draft-class-${draftYear}`,
    draftYear,
    partition,
    predictionCutoffAt: `${draftYear}-01-01T00:00:00.000Z`,
    selectionKnownAt: `${draftYear - 1}-12-31T00:00:00.000Z`,
    outcomeHorizonEndsAt,
    outcomeObservedAt: `${draftYear + 3}-01-01T00:00:00.000Z`,
    selection: {
      pathway: 'national',
      access: 'open',
      nominalSelectionNumber: 10,
      actualSelectionNumber: 12,
      bidSelectionNumber: null,
      draftRound: 1,
    },
    era: 'fixture-era',
    playerPosition: 'midfielder',
    ageAtDraft: 18.5,
    evidenceQuality: 'high',
    outcome: {
      state: 'mature_observed',
      contribution: 25,
      gamesPlayed: 30,
      category: 'regular_contributor',
    },
    ...overrides,
  };
}

function content(): AflTradePickOutcomeObservationSetContent {
  return {
    schemaVersion: 'afl-trade-pick-observation-set/v1',
    publicAssetBoundary: 'source_native_afl_draft_selection_no_fantasy_ownership',
    datasetId: `dataset:${digest('1')}`,
    modelProtocolId: `model-protocol:${digest('2')}`,
    valueUnitId: 'fixture-contribution-unit',
    fixedHorizonSeasons: 2,
    fixedHorizonDefinitionArtifactId: `artifact:${digest('3')}`,
    outcomeDefinitionArtifactId: `artifact:${digest('4')}`,
    curveEligibility: 'open_access_national_draft_actual_selection_only',
    observations: [
      observation('train'),
      observation('calibration'),
      observation('validation'),
      observation('final_test', {
        outcomeObservedAt: '2013-01-01T00:00:00.000Z',
        outcome: {
          state: 'right_censored',
          contributionObservedToDate: 8,
          gamesObservedToDate: 12,
          censoredAt: '2013-01-01T00:00:00.000Z',
        },
      }),
    ],
  };
}

describe('AFL trade-intelligence pick-outcome contracts', () => {
  it('creates an order-normalized public fixed-horizon observation set', () => {
    const forward = createAflTradePickOutcomeObservationSet(content());
    const reverse = createAflTradePickOutcomeObservationSet({
      ...content(),
      observations: [...content().observations].reverse(),
    });

    expect(forward).toEqual(reverse);
    expect(forward.observationSetId).toMatch(/^pick-observation-set:[a-f0-9]{64}$/);
    expect(forward.content.publicAssetBoundary).toContain('no_fantasy_ownership');
    expect(AFL_TRADE_PICK_OUTCOME_CATEGORIES).toEqual([
      'no_afl_game',
      'short_career',
      'replacement_level',
      'regular_contributor',
      'high_quality',
      'elite',
    ]);
  });

  it('rejects selection hindsight and labels observed before maturity', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selectionKnownAt: '2000-02-01T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcomeObservedAt: '2002-01-01T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: {
          state: 'right_censored',
          contributionObservedToDate: 1,
          gamesObservedToDate: 1,
          censoredAt: '2003-01-01T00:00:00.000Z',
        },
      }).success
    ).toBe(false);
  });

  it('keeps no-game, zero, unavailable, and other outcomes distinct', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: {
          state: 'mature_observed',
          contribution: 1,
          gamesPlayed: 0,
          category: 'no_afl_game',
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: {
          state: 'mature_observed',
          contribution: 0,
          gamesPlayed: 0,
          category: 'replacement_level',
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        outcome: { state: 'unavailable', reason: 'source_missing' },
      }).success
    ).toBe(true);
  });

  it('enforces national, bid-matched, and pathway position semantics', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: { ...base.selection, actualSelectionNumber: null },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: { ...base.selection, bidSelectionNumber: 8 },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: {
          ...base.selection,
          access: 'father_son_bid_match',
          bidSelectionNumber: null,
        },
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        selection: {
          ...base.selection,
          pathway: 'rookie',
          access: 'father_son_bid_match',
          bidSelectionNumber: 8,
        },
      }).success
    ).toBe(false);
  });

  it('rejects duplicate identities and non-bijective draft-class years', () => {
    const set = content();
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: [
          set.observations[0],
          { ...set.observations[1], observationId: set.observations[0].observationId },
          set.observations[2],
          set.observations[3],
        ],
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.map((item) =>
          item.partition === 'calibration'
            ? { ...item, draftClassId: set.observations[0].draftClassId }
            : item
        ),
      }).success
    ).toBe(false);
  });

  it('partitions and censors whole draft classes rather than selected players', () => {
    const set = content();
    const extra = observation('train', {
      observationId: 'fixture-pick-observation-train-extra',
      playerId: 'fixture-draftee-train-extra',
      outcome: {
        state: 'right_censored',
        contributionObservedToDate: 3,
        gamesObservedToDate: 4,
        censoredAt: '2001-01-01T00:00:00.000Z',
      },
      outcomeObservedAt: '2001-01-01T00:00:00.000Z',
    });
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: [...set.observations, extra],
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: [
          ...set.observations,
          {
            ...observation('train'),
            observationId: 'fixture-pick-observation-split',
            playerId: 'fixture-draftee-split',
            partition: 'calibration',
          },
        ],
      }).success
    ).toBe(false);
  });

  it('requires every chronological partition and purges labels before the next cohort', () => {
    const set = content();
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.filter(({ partition }) => partition !== 'calibration'),
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.map((item) =>
          item.partition === 'train'
            ? { ...item, outcomeObservedAt: '2004-01-01T00:00:00.000Z' }
            : item
        ),
      }).success
    ).toBe(false);
  });

  it('rejects fantasy ownership fields and detects content mutation', () => {
    const base = observation('train');
    expect(
      aflTradePickOutcomeObservationSchema.safeParse({
        ...base,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
    expect(
      aflTradePickOutcomeObservationSetContentSchema.safeParse({
        ...content(),
        ownerId: 'fixture-owner',
        rosterId: 'fixture-roster',
      }).success
    ).toBe(false);

    const set = createAflTradePickOutcomeObservationSet(content());
    expect(
      aflTradePickOutcomeObservationSetSchema.safeParse({
        ...set,
        content: { ...set.content, fixedHorizonSeasons: 3 },
      }).success
    ).toBe(false);
  });
});
