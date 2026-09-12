import { describe, expect, it } from 'vitest';

import { compareAflTradePlayerPavForecasts } from '@/server/aflTradeIntelligence/modeling/playerPavForecastComparison';
import {
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
  createAflTradePlayerPavPolicy,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  playerPavForecastConfiguration,
  playerPavForecastFixture,
} from '../testUtils/playerPavForecastFixture';

const compare = (
  observationSet = playerPavForecastFixture(),
  configuration = playerPavForecastConfiguration
) => compareAflTradePlayerPavForecasts({ observationSet, configuration });

describe('PAV forecast evidence and holdout safety', () => {
  it('requires retrospective comparison labeling for retrospectively recorded spell evidence', () => {
    const original = playerPavForecastFixture();
    const knowledgePolicy = 'retrospective_as_recorded_by_dataset_creation' as const;
    const set = createAflTradePlayerPavObservationSet({
      ...original.content,
      schemaVersion: 'afl-trade-player-pav-observation-set/v2',
      knowledgePolicy,
      policy: createAflTradePlayerPavPolicy({
        ...original.content.policy.content,
        schemaVersion: 'afl-trade-player-pav-policy/v2',
        knowledgePolicy,
      }),
      observations: original.content.observations.map((row) =>
        createAflTradePlayerPavObservation({
          ...row,
          acquisitionSpell: { ...row.acquisitionSpell, recordedAt: '2026-08-01T00:00:00.000Z' },
          knowledgeBinding: {
            policy: knowledgePolicy,
            knowledgeCutoffAt: original.content.knowledgeCutoffAt,
          },
        })
      ),
    });
    expect(() => compare(set)).toThrow(/retrospective.*knowledge policy/i);
    const result = compareAflTradePlayerPavForecasts({
      observationSet: set,
      configuration: {
        ...playerPavForecastConfiguration,
        knowledgePolicy: 'retrospective_finalized_measurements',
      },
    });
    expect(result.models).toHaveLength(3);
    expect(result.qualificationEligible).toBe(false);
  });

  it.each(['validation', 'final_test'] as const)(
    'never tunes, fits or calibrates against %s targets',
    (partition) => {
      const baseline = compare();
      const changed = compare(
        playerPavForecastFixture((row) =>
          row.partition !== partition
            ? row
            : createAflTradePlayerPavObservation({
                ...row,
                targetValues: row.targetValues.map((value) => ({
                  ...value,
                  offensivePav: 400,
                  totalPav: 400,
                })),
                outcome: {
                  state: 'mature_observed',
                  contribution: 1200,
                  gamesPlayed: 3,
                  seasonsObserved: 3,
                },
              })
        )
      );
      const learned = (result: ReturnType<typeof compare>) =>
        result.models.map((model) => ({
          candidate: model.candidate,
          fittedModel: model.fittedModel,
          trainingObservationIds: model.trainingObservationIds,
          points: model.forecasts.map((row) => row.annualPointPav),
          distributions: model.forecasts.map((row) => row.distribution),
        }));
      expect(learned(changed)).toEqual(learned(baseline));
      expect(changed.models[0]!.evaluation[partition].cumulative!.mae).toBeGreaterThan(1000);
    }
  );

  it('keeps retrospective calculations out of strict historical forecasts', () => {
    const set = playerPavForecastFixture((row) =>
      createAflTradePlayerPavObservation({
        ...row,
        featureValues: row.featureValues.map((value) => ({
          ...value,
          calculatedAt: '2026-08-01T00:00:00.000Z',
        })),
        targetValues: row.targetValues.map((value) => ({
          ...value,
          calculatedAt: '2026-08-01T00:00:00.000Z',
        })),
      })
    );
    const strict = compare(set);
    expect(strict.models).toEqual([]);
    expect(
      strict.coverage.every((row) => row.forecastUnavailable === 'feature_not_calculated_by_origin')
    ).toBe(true);
    const retrospective = compareAflTradePlayerPavForecasts({
      observationSet: set,
      configuration: {
        ...playerPavForecastConfiguration,
        knowledgePolicy: 'retrospective_finalized_measurements',
      },
    });
    expect(retrospective.models).toHaveLength(3);
    expect(retrospective.qualificationEligible).toBe(false);
  });

  it('reports insufficient tuning and calibration support without manufacturing qualification', () => {
    expect(
      compare(undefined, { ...playerPavForecastConfiguration, minimumTuningOrigins: 3 })
    ).toMatchObject({
      state: 'unavailable_insufficient_training_or_tuning_support',
      models: [],
    });
    const sparse = compare(undefined, {
      ...playerPavForecastConfiguration,
      minimumCalibrationObservations: 3,
    });
    expect(
      sparse.models[0]!.forecasts.find((row) => row.partition === 'final_test')!.distribution
    ).toEqual({
      state: 'unavailable',
      reason: 'insufficient_calibration_support',
    });
    expect(sparse.models[0]!.evaluation.final_test.cumulative).toMatchObject({
      distributionObservationCount: 0,
      crps: null,
    });
  });

  it('uses structural zero only after a verified receiving-spell departure', () => {
    const result = compare(
      playerPavForecastFixture((row) =>
        row.partition !== 'final_test'
          ? row
          : createAflTradePlayerPavObservation({
              ...row,
              acquisitionSpell: { ...row.acquisitionSpell, effectiveThrough: '2022-12-31' },
              targetValues: row.targetValues.slice(0, 1),
              outcome: {
                state: 'mature_observed',
                contribution: 4,
                gamesPlayed: 1,
                seasonsObserved: 3,
              },
            })
      )
    );
    expect(
      result.models.find((model) => model.kind === 'ridge')!.evaluation.final_test.cumulative
    ).toMatchObject({ bias: 8, mae: 8 });
  });

  it('does not score an unfinished horizon as a complete outcome', () => {
    const result = compare(
      playerPavForecastFixture((row) =>
        row.partition !== 'final_test'
          ? row
          : createAflTradePlayerPavObservation({
              ...row,
              targetValues: row.targetValues.slice(0, 1),
              outcomeObservedAt: '2023-01-01T00:00:00.000Z',
              outcome: {
                state: 'right_censored',
                contributionObservedToDate: 4,
                gamesObservedToDate: 1,
                seasonsObserved: 1,
                censoredAt: '2023-01-01T00:00:00.000Z',
              },
            })
      )
    );
    expect(result.models[0]!.evaluation.final_test).toMatchObject({
      observationCount: 0,
      cumulative: null,
    });
    expect(
      result.coverage
        .filter((row) => row.partition === 'final_test')
        .every((row) => row.outcomeUnavailable === 'right_censored' && !row.scored)
    ).toBe(true);
  });

  it('rejects duplicate candidate choices rather than weighting them twice', () => {
    expect(() =>
      compare(undefined, { ...playerPavForecastConfiguration, featureHistories: [1, 1] })
    ).toThrow(/unique/i);
  });

  it('seals a deterministic comparison bound to the exact evidence and canonical candidate grid', () => {
    const result = compare();
    expect(result.comparisonId).toMatch(/^player-pav-research-comparison:[a-f0-9]{64}$/);
    expect(
      compare(undefined, {
        ...playerPavForecastConfiguration,
        featureHistories: [3, 1, 2],
        ridgePenalties: [10, 1],
      }).comparisonId
    ).toBe(result.comparisonId);
  });

  it.each(['train', 'final_test'] as const)(
    'fails closed on non-finite %s scores from finite extreme values',
    (partition) => {
      const set = playerPavForecastFixture((row) =>
        row.partition !== partition
          ? row
          : createAflTradePlayerPavObservation({
              ...row,
              targetValues: row.targetValues.map((value) => ({
                ...value,
                offensivePav: 1e200,
                totalPav: 1e200,
              })),
              outcome: {
                state: 'mature_observed',
                contribution: 3e200,
                gamesPlayed: 3,
                seasonsObserved: 3,
              },
            })
      );
      expect(() => compare(set)).toThrow(/finite/i);
    }
  );

  it('rejects a resealed four-season outcome even when its policy declares three seasons', () => {
    const set = playerPavForecastFixture((row) => {
      if (row.partition !== 'final_test') return row;
      const seasonYear = row.predictionSeason + 4;
      const calculationId = createAflTradeContentAddress('hpn-pav-season', { seasonYear });
      const value = {
        ...row.targetValues.at(-1)!,
        seasonYear,
        calculationId,
        calculationSha256: calculationId.split(':')[1]!,
        effectiveThrough: `${seasonYear}-09-30T00:00:00.000Z`,
        calculatedAt: `${seasonYear}-10-01T00:00:00.000Z`,
        sourceRowIds: [`fixture-row:${row.playerId}:${seasonYear}`],
      };
      return createAflTradePlayerPavObservation({
        ...row,
        targetCalculationSeasons: [...row.targetCalculationSeasons, seasonYear],
        targetValues: [...row.targetValues, value],
        outcomeHorizonEndsAt: `${seasonYear}-12-31T23:59:59.999Z`,
        outcomeObservedAt: `${seasonYear}-12-31T23:59:59.999Z`,
        outcome: { state: 'mature_observed', contribution: 16, gamesPlayed: 4, seasonsObserved: 4 },
      });
    });
    expect(() => compare(set)).toThrow(/exact three-season/i);
  });

  it('rejects incorrectly declared horizon maturity without changing the historical labels', () => {
    const set = playerPavForecastFixture((row) =>
      row.partition !== 'final_test'
        ? row
        : createAflTradePlayerPavObservation({
            ...row,
            outcomeHorizonEndsAt: '2023-12-31T23:59:59.999Z',
          })
    );
    expect(() => compare(set)).toThrow(/exact three-season/i);
  });
});
