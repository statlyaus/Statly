import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PLAYER_PAV_OBSERVATION_SET_SCHEMA_VERSION,
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
  createAflTradePlayerPavPolicy,
  type AflTradePlayerPavObservation,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { deriveAflTradePlayerCalculationEvidence } from '@/server/aflTradeIntelligence/valuation/calculationNarrativeEvidence';

const digest = (marker: string) => marker.repeat(64);
const calculationId = (seasonYear: number) =>
  `hpn-pav-season:${seasonYear.toString(16).padStart(64, '0')}`;

function policy() {
  return createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'player-pav-policy-fixture-v1',
    featureHistorySeasons: 2,
    fixedHorizonSeasons: 3,
    methodId: `hpn-pav-method:${digest('a')}`,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    partitions: [
      { role: 'train', fromPredictionSeason: 1998, throughPredictionSeason: 2001 },
      { role: 'calibration', fromPredictionSeason: 2004, throughPredictionSeason: 2006 },
      { role: 'validation', fromPredictionSeason: 2009, throughPredictionSeason: 2011 },
      { role: 'final_test', fromPredictionSeason: 2014, throughPredictionSeason: 2016 },
    ],
    approvalDecision: {
      id: `review-decision:${digest('b')}`,
      sha256: digest('b'),
    },
    createdAt: '2026-08-11T00:00:00.000Z',
  });
}

function value(
  seasonYear: number,
  options: { playerId?: string; clubId?: string; spellVersionId?: string } = {}
) {
  const id = calculationId(seasonYear);
  return {
    calculationId: id,
    calculationSha256: id.slice(id.indexOf(':') + 1),
    seasonYear,
    effectiveThrough: `${seasonYear}-09-30T23:59:59.000Z`,
    calculatedAt: `${seasonYear}-10-01T00:00:00.000Z`,
    spellVersionId:
      options.spellVersionId ?? `acquisition-spell-version:${digest(String(seasonYear % 10))}`,
    playerId: options.playerId ?? 'afl-player:fixture',
    playerSha256: digest('c'),
    clubId: options.clubId ?? 'afl-club:fixture',
    sourceRowIds: [`provider-row:${seasonYear}:1`, `provider-row:${seasonYear}:2`],
    gamesPlayed: 2,
    offensivePav: seasonYear - 1990,
    midfieldPav: seasonYear - 1995,
    defensivePav: seasonYear - 2000,
    totalPav: 3 * seasonYear - 5985,
  };
}

function observation(
  ordinal: number,
  partition: AflTradePlayerPavObservation['partition'],
  predictionSeason: number
) {
  const spellVersionId = `acquisition-spell-version:${digest(String(ordinal))}`;
  const featureValues = [predictionSeason - 1, predictionSeason].map((seasonYear) =>
    value(seasonYear, { spellVersionId })
  );
  const targetValues = [predictionSeason + 1, predictionSeason + 2, predictionSeason + 3].map(
    (seasonYear) => value(seasonYear, { spellVersionId })
  );
  return createAflTradePlayerPavObservation({
    ordinal,
    partition,
    predictionSeason,
    predictionCutoffAt: `${predictionSeason}-12-31T23:59:59.999Z`,
    outcomeHorizonEndsAt: `${predictionSeason + 3}-12-31T23:59:59.999Z`,
    outcomeObservedAt: `${predictionSeason + 4}-01-01T00:00:00.000Z`,
    releaseId: `outcome-release:${digest('d')}`,
    playerId: 'afl-player:fixture',
    acquisitionSpell: {
      spellId: `acquisition-spell:fixture-${ordinal}`,
      spellVersionId,
      clubId: 'afl-club:fixture',
      effectiveFrom: `${predictionSeason - 1}-01-01`,
      effectiveThrough: null,
      recordedAt: `${predictionSeason - 1}-01-01T00:00:00.000Z`,
    },
    featureCalculationSeasons: [predictionSeason - 1, predictionSeason],
    featureValues,
    targetCalculationSeasons: [
      predictionSeason + 1,
      predictionSeason + 2,
      predictionSeason + 3,
    ],
    targetValues,
    outcome: {
      state: 'mature_observed',
      contribution: targetValues.reduce((sum, entry) => sum + entry.totalPav, 0),
      gamesPlayed: targetValues.reduce((sum, entry) => sum + entry.gamesPlayed, 0),
      seasonsObserved: 3,
    },
  });
}

describe('player PAV observation contracts', () => {
  it('seals exact acquisition-spell HPN histories and a label-purged four-partition set', () => {
    const observations = [
      observation(1, 'train', 2001),
      observation(2, 'calibration', 2006),
      observation(3, 'validation', 2011),
      observation(4, 'final_test', 2016),
    ];
    const calculations = observations
      .flatMap((entry) => [...entry.featureValues, ...entry.targetValues])
      .map((entry) => ({
        calculationId: entry.calculationId,
        calculationSha256: entry.calculationSha256,
        inputSetId: createAflTradeContentAddress('hpn-pav-input-set', {
          seasonYear: entry.seasonYear,
        }),
        methodId: `hpn-pav-method:${digest('a')}`,
        seasonYear: entry.seasonYear,
        effectiveThrough: entry.effectiveThrough,
        calculatedAt: entry.calculatedAt,
      }));

    const result = createAflTradePlayerPavObservationSet({
      schemaVersion: AFL_TRADE_PLAYER_PAV_OBSERVATION_SET_SCHEMA_VERSION,
      authorityBoundary:
        'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: 'test_fixture',
      competition: 'AFLM',
      createdAt: '2026-08-11T00:00:00.000Z',
      knowledgeCutoffAt: '2026-08-10T23:59:59.999Z',
      releaseId: `outcome-release:${digest('d')}`,
      policy: policy(),
      calculations,
      observations: [...observations].reverse(),
      observationCount: observations.length,
      observationSetSha256: '0'.repeat(64),
    });

    expect(result.content.observations.map(({ partition }) => partition)).toEqual([
      'train',
      'calibration',
      'validation',
      'final_test',
    ]);
    expect(result.content.observationSetSha256).not.toBe('0'.repeat(64));
  });

  it('rejects substituted PAV totals and cross-spell target evidence', () => {
    const valid = observation(1, 'train', 2001);

    expect(() =>
      createAflTradePlayerPavObservation({
        ...valid,
        outcome: { ...valid.outcome, contribution: valid.outcome.contribution + 1 },
      })
    ).toThrow();
    expect(() =>
      createAflTradePlayerPavObservation({
        ...valid,
        targetValues: [
          { ...valid.targetValues[0], spellVersionId: `acquisition-spell-version:${digest('f')}` },
          ...valid.targetValues.slice(1),
        ],
      })
    ).toThrow();
  });

  it('keeps an active incomplete horizon explicitly right-censored', () => {
    const valid = observation(4, 'final_test', 2016);
    const targetValues = valid.targetValues.slice(0, 1);
    const result = createAflTradePlayerPavObservation({
      ...valid,
      outcomeObservedAt: '2018-01-01T00:00:00.000Z',
      targetValues,
      outcome: {
        state: 'right_censored',
        contributionObservedToDate: targetValues[0]!.totalPav,
        gamesObservedToDate: targetValues[0]!.gamesPlayed,
        seasonsObserved: 1,
        censoredAt: '2018-01-01T00:00:00.000Z',
      },
    });

    expect(result.outcome.state).toBe('right_censored');
    expect(deriveAflTradePlayerCalculationEvidence(result)).toMatchObject({
      state: 'right_censored',
      evidenceCutoffAt: '2018-01-01T00:00:00.000Z',
      horizon: {
        requiredSeasons: [2017, 2018, 2019],
        observedSeasons: [2017],
      },
      totals: {
        gamesPlayed: 2,
        contribution: targetValues[0]!.totalPav,
        contributionPerGame: targetValues[0]!.totalPav / 2,
      },
    });
  });

  it('derives the player-value story from exact receiving-club seasons and games', () => {
    const player = observation(1, 'train', 2001);

    expect(deriveAflTradePlayerCalculationEvidence(player)).toMatchObject({
      kind: 'player',
      state: 'mature_observed',
      observationId: player.observationId,
      releaseId: player.releaseId,
      playerId: 'afl-player:fixture',
      acquisitionSpell: player.acquisitionSpell,
      predictionSeason: 2001,
      evidenceCutoffAt: '2005-01-01T00:00:00.000Z',
      horizon: {
        requiredSeasons: [2002, 2003, 2004],
        observedSeasons: [2002, 2003, 2004],
      },
      seasons: [
        {
          seasonYear: 2002,
          gamesPlayed: 2,
          contribution: 21,
          contributionPerGame: 10.5,
          calculationId: calculationId(2002),
          sourceObservationIds: ['provider-row:2002:1', 'provider-row:2002:2'],
        },
        {
          seasonYear: 2003,
          gamesPlayed: 2,
          contribution: 24,
          contributionPerGame: 12,
          calculationId: calculationId(2003),
          sourceObservationIds: ['provider-row:2003:1', 'provider-row:2003:2'],
        },
        {
          seasonYear: 2004,
          gamesPlayed: 2,
          contribution: 27,
          contributionPerGame: 13.5,
          calculationId: calculationId(2004),
          sourceObservationIds: ['provider-row:2004:1', 'provider-row:2004:2'],
        },
      ],
      totals: {
        gamesPlayed: 6,
        contribution: 72,
        contributionPerGame: 12,
      },
    });
  });

  it('separates historical football availability from later calculation custody', () => {
    const historical = observation(1, 'train', 2001);
    const backfilled = createAflTradePlayerPavObservation({
      ...historical,
      featureValues: historical.featureValues.map((entry) => ({
        ...entry,
        calculatedAt: '2026-08-11T01:00:00.000Z',
      })),
      targetValues: historical.targetValues.map((entry) => ({
        ...entry,
        calculatedAt: '2026-08-11T01:00:00.000Z',
      })),
    });

    expect(backfilled.featureValues.every(({ calculatedAt }) => calculatedAt.startsWith('2026')))
      .toBe(true);
    expect(backfilled.featureValues.at(-1)?.effectiveThrough).toBe(
      '2001-09-30T23:59:59.000Z'
    );
  });

  it('preserves multiple authenticated acquisition-spell values in one feature season', () => {
    const historical = observation(1, 'train', 2001);
    const additionalSpellValue = value(2000, {
      clubId: 'afl-club:previous',
      spellVersionId: `acquisition-spell-version:${digest('e')}`,
    });
    const result = createAflTradePlayerPavObservation({
      ...historical,
      featureValues: [historical.featureValues[0]!, additionalSpellValue, historical.featureValues[1]!],
    });

    expect(result.featureCalculationSeasons).toEqual([2000, 2001]);
    expect(result.featureValues.filter(({ seasonYear }) => seasonYear === 2000)).toHaveLength(2);
  });

  it('treats the post-departure portion of a mature receiving-club horizon as observed zero', () => {
    const historical = observation(1, 'train', 2001);
    const targetValues = historical.targetValues.slice(0, 1);
    const result = createAflTradePlayerPavObservation({
      ...historical,
      acquisitionSpell: {
        ...historical.acquisitionSpell,
        effectiveThrough: '2002-06-30',
      },
      targetValues,
      outcome: {
        state: 'mature_observed',
        contribution: targetValues[0]!.totalPav,
        gamesPlayed: targetValues[0]!.gamesPlayed,
        seasonsObserved: historical.targetCalculationSeasons.length,
      },
    });

    expect(result.outcome).toEqual({
      state: 'mature_observed',
      contribution: targetValues[0]!.totalPav,
      gamesPlayed: targetValues[0]!.gamesPlayed,
      seasonsObserved: 3,
    });
  });

  it('retains an explicit unavailable row when point-in-time feature history is incomplete', () => {
    const historical = observation(1, 'train', 2001);
    const result = createAflTradePlayerPavObservation({
      ...historical,
      featureValues: [],
      targetValues: [],
      outcome: { state: 'unavailable', reason: 'feature_history_incomplete' },
    });

    expect(result.outcome).toEqual({
      state: 'unavailable',
      reason: 'feature_history_incomplete',
    });
    expect(deriveAflTradePlayerCalculationEvidence(result)).toMatchObject({
      state: 'unavailable',
      reason: 'feature_history_incomplete',
      seasons: [],
      totals: null,
    });
  });
});
