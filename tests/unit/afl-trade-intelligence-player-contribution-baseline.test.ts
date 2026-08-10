import { describe, expect, it } from 'vitest';

import {
  fitAflTradePlayerContributionBaseline,
  calculateAflTradeWeightedQuantile,
} from '@/server/aflTradeIntelligence/modeling/playerContributionBaseline';
import {
  createAflTradePlayerObservationSet,
  type AflTradePlayerBaselineConfig,
  type AflTradePlayerObservationSetContent,
  type AflTradePlayerSeasonObservation,
} from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';

const partitionYears = {
  train: 2018,
  calibration: 2020,
  validation: 2022,
  final_test: 2024,
} as const;

const baselineConfig: AflTradePlayerBaselineConfig = {
  schemaVersion: 'afl-trade-player-baseline-config/v1',
  replacementQuantile: 0.25,
  minimumGamesForReplacementFit: 1,
  minimumTrainingObservationsPerGroup: 3,
  weighting: 'games_played',
  replacementStratification: 'role_and_era',
  unavailableAndZeroTreatment: 'distinct',
  activeCareerTreatment: 'right_censored',
};

interface ObservationOptions {
  id: string;
  partition: keyof typeof partitionYears;
  gamesPlayed?: number;
  gamesAvailable?: number;
  contribution?: AflTradePlayerSeasonObservation['contribution'];
  role?: string;
  era?: string;
  career?: AflTradePlayerSeasonObservation['career'];
}

function observation({
  id,
  partition,
  gamesPlayed = 10,
  gamesAvailable = 22,
  contribution = { state: 'observed', total: gamesPlayed * 4 },
  role = 'midfielder',
  era = 'modern-era',
  career,
}: ObservationOptions): AflTradePlayerSeasonObservation {
  const year = partitionYears[partition];
  const outcomeObservedAt = `${year}-12-31T00:00:00.000Z`;
  return {
    observationId: `fixture-observation-${id}`,
    playerId: `fixture-player-${id}`,
    season: year,
    role,
    era,
    partition,
    predictionCutoffAt: `${year}-01-01T00:00:00.000Z`,
    roleKnownAt: `${year - 1}-12-15T00:00:00.000Z`,
    outcomeObservedAt,
    gamesPlayed,
    gamesAvailable,
    contribution,
    career: career ?? { state: 'right_censored', censoredAt: outcomeObservedAt },
  };
}

function observationContent(validationContribution = 60): AflTradePlayerObservationSetContent {
  return {
    schemaVersion: 'afl-trade-player-observation-set/v1',
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    valueUnitId: 'fixture-contribution-units',
    observations: [
      observation({
        id: 'train-low',
        partition: 'train',
        gamesPlayed: 2,
        contribution: { state: 'observed', total: 2 },
      }),
      observation({
        id: 'train-mid',
        partition: 'train',
        gamesPlayed: 18,
        contribution: { state: 'observed', total: 54 },
      }),
      observation({
        id: 'train-high',
        partition: 'train',
        gamesPlayed: 20,
        contribution: { state: 'observed', total: 100 },
      }),
      observation({
        id: 'calibration-scored',
        partition: 'calibration',
        gamesPlayed: 10,
        gamesAvailable: 20,
        contribution: { state: 'observed', total: 50 },
      }),
      observation({
        id: 'calibration-zero',
        partition: 'calibration',
        gamesPlayed: 0,
        contribution: { state: 'observed', total: 0 },
      }),
      observation({
        id: 'validation-scored',
        partition: 'validation',
        gamesPlayed: 12,
        contribution: { state: 'observed', total: validationContribution },
      }),
      observation({
        id: 'final-unavailable',
        partition: 'final_test',
        contribution: { state: 'unavailable', reason: 'source_missing' },
      }),
      observation({
        id: 'final-unsupported',
        partition: 'final_test',
        role: 'defender',
        contribution: { state: 'observed', total: 40 },
        career: { state: 'completed', careerEndedAt: '2024-12-01T00:00:00.000Z' },
      }),
    ],
  };
}

describe('AFL trade-intelligence player-contribution baseline', () => {
  it('calculates a deterministic games-weighted quantile and rejects invalid inputs', () => {
    const values = [
      { observationId: 'low', value: 1, weight: 2 },
      { observationId: 'mid', value: 3, weight: 18 },
      { observationId: 'high', value: 5, weight: 20 },
    ];

    expect(calculateAflTradeWeightedQuantile(values, 0.25)).toBe(3);
    expect(calculateAflTradeWeightedQuantile([...values].reverse(), 0.25)).toBe(3);
    expect(() => calculateAflTradeWeightedQuantile([], 0.25)).toThrow(/at least one/i);
    expect(() =>
      calculateAflTradeWeightedQuantile([{ observationId: 'bad', value: 1, weight: 0 }], 0.25)
    ).toThrow(/positive weight/i);
    expect(() =>
      calculateAflTradeWeightedQuantile(
        [
          { observationId: 'duplicate', value: 1, weight: 1 },
          { observationId: 'duplicate', value: 2, weight: 1 },
        ],
        0.25
      )
    ).toThrow(/unique/i);
    expect(() => calculateAflTradeWeightedQuantile(values, 0)).toThrow(/quantile/i);
  });

  it('fits deterministically without mutating the observation set', () => {
    const set = createAflTradePlayerObservationSet(observationContent());
    const before = structuredClone(set);

    const first = fitAflTradePlayerContributionBaseline(set, baselineConfig);
    const second = fitAflTradePlayerContributionBaseline(set, baselineConfig);

    expect(first).toEqual(second);
    expect(first.baselineFitId).toMatch(/^player-baseline-fit:[a-f0-9]{64}$/);
    expect(set).toEqual(before);
    expect(first.content.replacementLevels).toEqual([
      {
        role: 'midfielder',
        era: 'modern-era',
        eligibleTrainingObservations: 3,
        totalGamesWeight: 40,
        replacementContributionPerGame: 3,
      },
    ]);
  });

  it('keeps held-out outcomes out of replacement fitting', () => {
    const ordinary = fitAflTradePlayerContributionBaseline(
      createAflTradePlayerObservationSet(observationContent(60)),
      baselineConfig
    );
    const adversarial = fitAflTradePlayerContributionBaseline(
      createAflTradePlayerObservationSet(observationContent(60_000)),
      baselineConfig
    );

    expect(adversarial.content.replacementLevels).toEqual(ordinary.content.replacementLevels);
    expect(
      adversarial.content.scores.find(
        (score) => score.observationId === 'fixture-observation-validation-scored'
      )?.observedContributionAboveReplacement
    ).not.toBe(
      ordinary.content.scores.find(
        (score) => score.observationId === 'fixture-observation-validation-scored'
      )?.observedContributionAboveReplacement
    );
  });

  it('keeps contribution, availability, and censoring treatment separately auditable', () => {
    const fit = fitAflTradePlayerContributionBaseline(
      createAflTradePlayerObservationSet(observationContent()),
      baselineConfig
    );
    const score = fit.content.scores.find(
      (item) => item.observationId === 'fixture-observation-calibration-scored'
    );

    expect(score).toMatchObject({
      observedContribution: 50,
      observedContributionPerGame: 5,
      replacementContributionPerGame: 3,
      impactAboveReplacementPerGame: 2,
      availabilityRate: 0.5,
      observedContributionAboveReplacement: 20,
      careerTreatment: 'right_censored',
    });
  });

  it('distinguishes unavailable, zero-game, and unsupported-cohort observations', () => {
    const fit = fitAflTradePlayerContributionBaseline(
      createAflTradePlayerObservationSet(observationContent()),
      baselineConfig
    );

    expect(fit.content.unscored).toEqual([
      {
        observationId: 'fixture-observation-calibration-zero',
        reason: 'zero_games',
      },
      {
        observationId: 'fixture-observation-final-unavailable',
        reason: 'contribution_unavailable',
      },
      {
        observationId: 'fixture-observation-final-unsupported',
        reason: 'unsupported_role_era',
      },
    ]);
    expect(fit.content.diagnostics).toEqual({
      eligibleTrainingObservations: 3,
      supportedRoleEraGroups: 1,
      unsupportedRoleEraGroups: 1,
      scoredObservations: 5,
      unscoredObservations: 3,
    });
  });

  it('fails closed when a role-era cohort lacks enough training observations', () => {
    const fit = fitAflTradePlayerContributionBaseline(
      createAflTradePlayerObservationSet(observationContent()),
      { ...baselineConfig, minimumTrainingObservationsPerGroup: 4 }
    );

    expect(fit.content.replacementLevels).toEqual([]);
    expect(fit.content.scores).toEqual([]);
    expect(fit.content.unscored).toHaveLength(fit.content.inputObservationIds.length);
    expect(
      fit.content.unscored.filter(({ reason }) => reason === 'unsupported_role_era')
    ).toHaveLength(6);
  });
});
