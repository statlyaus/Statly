import { describe, expect, it } from 'vitest';

import { compareAflTradePlayerPavForecasts } from '@/server/aflTradeIntelligence/modeling/playerPavForecastComparison';
import { restorePlayerPavForecast } from '@/server/aflTradeIntelligence/modeling/playerPavForecastFit';
import {
  createAflTradePlayerPavObservation,
  type AflTradePlayerPavObservation,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import {
  playerPavForecastConfiguration,
  playerPavForecastFixture,
} from '../testUtils/playerPavForecastFixture';

function withTarget(row: AflTradePlayerPavObservation, pav: number) {
  return createAflTradePlayerPavObservation({
    ...row,
    targetValues: row.targetValues.map((value) => ({ ...value, offensivePav: pav, totalPav: pav })),
    outcome: {
      state: 'mature_observed',
      contribution: pav * 3,
      gamesPlayed: 3,
      seasonsObserved: 3,
    },
  });
}

describe('player PAV research forecast comparison', () => {
  it('retains the selected learned parameters with their exact training membership', () => {
    const result = compareAflTradePlayerPavForecasts({
      observationSet: playerPavForecastFixture(),
      configuration: playerPavForecastConfiguration,
    });
    expect(result.schemaVersion).toBe('player-pav-forecast-comparison/v2');
    const ridge = result.models.find((model) => model.kind === 'ridge')!;
    expect(ridge).toMatchObject({
      fittedModel: {
        fitId: expect.stringMatching(/^player-pav-forecast-fit:[a-f0-9]{64}$/),
        content: {
          schemaVersion: 'player-pav-forecast-fit/v1',
          kind: 'ridge',
          targetMeans: [4, 4, 4],
        },
      },
    });
    expect(ridge.trainingObservationIds).toHaveLength(6);
    const restored = restorePlayerPavForecast(JSON.parse(JSON.stringify(ridge.fittedModel)));
    expect(
      restored.predict({
        observationId: 'held-out-replay',
        playerId: 'afl-player:held-out',
        partition: 'final_test',
        predictionSeason: 2021,
        cutoff: Date.parse('2021-12-31T23:59:59.999Z'),
        labelAvailableAt: Infinity,
        history: [
          { pav: 2, games: 1 },
          { pav: 2, games: 1 },
          { pav: 2, games: 1 },
        ],
        target: null,
        outcomeUnavailable: 'unobserved',
        forecastUnavailable: null,
      })
    ).toEqual([4, 4, 4]);
    expect(result.qualificationEligible).toBe(false);
  });

  it('compares three-season persistence without granting model qualification', () => {
    const result = compareAflTradePlayerPavForecasts({
      observationSet: playerPavForecastFixture(),
      configuration: playerPavForecastConfiguration,
    });

    expect(result).toMatchObject({ publicationEligible: false, qualificationEligible: false });
    const persistence = result.models.find((model) => model.kind === 'persistence')!;
    expect(
      persistence.forecasts
        .filter((row) => row.partition === 'final_test')
        .map((row) => row.annualPointPav)
    ).toEqual([
      [2, 2, 2],
      [6, 6, 6],
    ]);
    expect(
      persistence.forecasts
        .filter((row) => row.partition === 'final_test')
        .map((row) => row.totalPointPav)
    ).toEqual([6, 18]);
    expect(persistence.trainingObservationIds).toHaveLength(6);
  });

  it('tunes shrinkage on earlier training origins, never on the held-out partitions', () => {
    const result = compareAflTradePlayerPavForecasts({
      observationSet: playerPavForecastFixture(),
      configuration: {
        ...playerPavForecastConfiguration,
        featureHistories: [1],
        shrinkagePseudoSeasons: [1],
      },
    });
    const shrinkage = result.models.find((model) => model.kind === 'shrinkage')!;
    // One observed season weighted equally with one pseudo-season at the training mean of four.
    expect(
      shrinkage.forecasts
        .filter((row) => row.partition === 'final_test')
        .map((row) => row.annualPointPav)
    ).toEqual([
      [3, 3, 3],
      [5, 5, 5],
    ]);
    expect(shrinkage.tuningOrigins).toEqual([2005, 2009]);
  });

  it('fits standardized annual ridge with an unpenalized intercept and training-only scaling', () => {
    const result = compareAflTradePlayerPavForecasts({
      observationSet: playerPavForecastFixture((row) =>
        row.partition === 'train' ? withTarget(row, row.featureValues.at(-1)!.totalPav) : row
      ),
      configuration: {
        ...playerPavForecastConfiguration,
        featureHistories: [1],
        ridgePenalties: [6],
      },
    });
    const ridge = result.models.find((model) => model.kind === 'ridge')!;
    // Six rows: x mean=4, scale=2, y mean=4. Ridge slope is 12/(6+6)=1.
    expect(
      ridge.forecasts
        .filter((row) => row.partition === 'final_test')
        .map((row) => row.annualPointPav)
    ).toEqual([
      [3, 3, 3],
      [5, 5, 5],
    ]);
  });

  it('retains short histories as forecasts with explicit unavailable outcomes, never as zero labels', () => {
    const result = compareAflTradePlayerPavForecasts({
      observationSet: playerPavForecastFixture((row) =>
        row.partition !== 'final_test'
          ? row
          : createAflTradePlayerPavObservation({
              ...row,
              featureValues: row.featureValues.slice(-1),
              targetValues: [],
              outcome: { state: 'unavailable', reason: 'feature_history_incomplete' },
            })
      ),
      configuration: {
        ...playerPavForecastConfiguration,
        featureHistories: [3],
        shrinkagePseudoSeasons: [3],
      },
    });
    const shrinkage = result.models.find((model) => model.kind === 'shrinkage')!;
    expect(
      shrinkage.forecasts
        .filter((row) => row.partition === 'final_test')
        .map((row) => row.annualPointPav)
    ).toEqual([
      [3.5, 3.5, 3.5],
      [4.5, 4.5, 4.5],
    ]);
    expect(result.coverage.filter((row) => row.partition === 'final_test')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          observedHistorySeasons: 1,
          outcomeUnavailable: 'feature_history_incomplete',
          scored: false,
        }),
      ])
    );
  });

  it('keeps whole calibration error paths together and scores genuinely held-out distributions', () => {
    const result = compareAflTradePlayerPavForecasts({
      observationSet: playerPavForecastFixture((row) =>
        row.partition === 'calibration' ? withTarget(row, row.ordinal % 2 ? 3 : 5) : row
      ),
      configuration: playerPavForecastConfiguration,
    });
    const ridge = result.models.find((model) => model.kind === 'ridge')!;
    const forecast = ridge.forecasts.find((row) => row.partition === 'final_test')!;
    expect(forecast.distribution).toMatchObject({
      state: 'empirical_calibration_paths',
      annualDraws: [
        [3, 3, 3],
        [5, 5, 5],
      ],
      totalDraws: [9, 15],
      totalInterval: { lower: 9, upper: 15 },
    });
    expect(ridge.evaluation.final_test).toMatchObject({
      observationCount: 2,
      cumulative: { bias: 0, mae: 0, rmse: 0, crps: 1.5, intervalCoverage: 1, intervalWidth: 6 },
    });
    expect(result.tradePackageDistribution).toBe('unavailable_no_joint_evidence');
  });
});
