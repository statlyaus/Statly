import { describe, expect, it } from 'vitest';

import {
  aflTradePlayerObservationSetContentSchema,
  aflTradePlayerObservationSetSchema,
  aflTradePlayerSeasonObservationSchema,
  createAflTradePlayerObservationSet,
  type AflTradePlayerObservationSetContent,
  type AflTradePlayerSeasonObservation,
} from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';

const partitionYears = {
  train: 2018,
  calibration: 2020,
  validation: 2022,
  final_test: 2024,
} as const;

function observation(
  partition: keyof typeof partitionYears,
  overrides: Partial<AflTradePlayerSeasonObservation> = {}
): AflTradePlayerSeasonObservation {
  const year = partitionYears[partition];
  return {
    observationId: `fixture-observation-${partition}`,
    playerId: `fixture-player-${partition}`,
    season: year,
    role: 'midfielder',
    era: 'modern-era',
    partition,
    predictionCutoffAt: `${year}-01-01T00:00:00.000Z`,
    roleKnownAt: `${year - 1}-12-15T00:00:00.000Z`,
    outcomeObservedAt: `${year}-12-31T00:00:00.000Z`,
    gamesPlayed: 20,
    gamesAvailable: 22,
    contribution: { state: 'observed', total: 100 },
    career: {
      state: 'completed',
      careerEndedAt: `${year}-12-01T00:00:00.000Z`,
    },
    ...overrides,
  };
}

function content(): AflTradePlayerObservationSetContent {
  return {
    schemaVersion: 'afl-trade-player-observation-set/v1',
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    valueUnitId: 'fixture-contribution-above-replacement',
    observations: [
      observation('train'),
      observation('calibration'),
      observation('validation'),
      observation('final_test', {
        career: {
          state: 'right_censored',
          censoredAt: '2024-12-31T00:00:00.000Z',
        },
      }),
    ],
  };
}

describe('AFL trade-intelligence player-contribution contracts', () => {
  it('accepts a content-addressed chronological public observation set', () => {
    const set = createAflTradePlayerObservationSet(content());

    expect(set.observationSetId).toMatch(/^player-observation-set:[a-f0-9]{64}$/);
    expect(set.content.publicIdentityBoundary).toBe('source_native_no_fantasy_ownership');
    expect(set.content.observations.at(-1)?.career.state).toBe('right_censored');
  });

  it('rejects role hindsight and outcomes observed at or before prediction cutoff', () => {
    const base = observation('train');
    expect(
      aflTradePlayerSeasonObservationSchema.safeParse({
        ...base,
        roleKnownAt: '2018-02-01T00:00:00.000Z',
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerSeasonObservationSchema.safeParse({
        ...base,
        outcomeObservedAt: base.predictionCutoffAt,
      }).success
    ).toBe(false);
  });

  it('rejects impossible availability and non-zero contribution without games', () => {
    const base = observation('train');
    expect(
      aflTradePlayerSeasonObservationSchema.safeParse({
        ...base,
        gamesPlayed: 23,
        gamesAvailable: 22,
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerSeasonObservationSchema.safeParse({
        ...base,
        gamesPlayed: 0,
        contribution: { state: 'observed', total: 1 },
      }).success
    ).toBe(false);
  });

  it('requires completed and right-censored career evidence to match observation time', () => {
    const base = observation('train');
    expect(
      aflTradePlayerSeasonObservationSchema.safeParse({
        ...base,
        career: { state: 'completed', careerEndedAt: '2017-12-01T00:00:00.000Z' },
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerSeasonObservationSchema.safeParse({
        ...base,
        career: { state: 'right_censored', censoredAt: '2018-11-30T00:00:00.000Z' },
      }).success
    ).toBe(false);
  });

  it('rejects duplicate identities, missing partitions, and temporal overlap', () => {
    const set = content();
    expect(
      aflTradePlayerObservationSetContentSchema.safeParse({
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
      aflTradePlayerObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.map((item) =>
          item.partition === 'calibration' ? { ...item, partition: 'train' as const } : item
        ),
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerObservationSetContentSchema.safeParse({
        ...set,
        observations: set.observations.map((item) =>
          item.partition === 'calibration'
            ? { ...item, predictionCutoffAt: '2018-06-01T00:00:00.000Z' }
            : item
        ),
      }).success
    ).toBe(false);
  });

  it('rejects fantasy ownership fields at both row and dataset boundaries', () => {
    const base = observation('train');
    expect(
      aflTradePlayerSeasonObservationSchema.safeParse({
        ...base,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerObservationSetContentSchema.safeParse({
        ...content(),
        ownerId: 'fixture-owner',
        rosterId: 'fixture-roster',
      }).success
    ).toBe(false);
  });

  it('detects mutation after the observation-set identifier is created', () => {
    const set = createAflTradePlayerObservationSet(content());

    expect(
      aflTradePlayerObservationSetSchema.safeParse({
        ...set,
        content: { ...set.content, valueUnitId: 'mutated-value-unit' },
      }).success
    ).toBe(false);
  });
});
