import { expect, it } from 'vitest';
import {
  fitPlayerPavEmpiricalCalibration,
  restorePlayerPavEmpiricalCalibration,
  applyPlayerPavEmpiricalCalibration,
} from '@/server/aflTradeIntelligence/modeling/playerPavForecastEvaluation';
import type { PlayerPavResearchRow } from '@/server/aflTradeIntelligence/modeling/playerPavForecastDesign';

const row = (
  observationId: string,
  partition: PlayerPavResearchRow['partition'],
  target: number[] | null
): PlayerPavResearchRow => ({
  observationId,
  partition,
  target,
  playerId: observationId,
  predictionSeason: 2020,
  cutoff: 10,
  labelAvailableAt: 1,
  history: [{ pav: 1, games: 1 }],
  outcomeUnavailable: null,
  forecastUnavailable: null,
});
const fitted = { predict: () => [10, 20, 30] };
const configuration = { minimumCalibrationObservations: 2, intervalCoverage: 0.8 };
it.each(['validation', 'final_test'] as const)(
  'rejects restored late calibration for earlier %s without opening targets',
  (partition) => {
    const state = fitPlayerPavEmpiricalCalibration(
      [
        { ...row('late', 'calibration', [9, 18, 27]), labelAvailableAt: 19 },
        { ...row('anchor', 'validation', null), cutoff: 20 },
      ],
      fitted,
      1,
      configuration
    );
    const restored = restorePlayerPavEmpiricalCalibration(JSON.parse(JSON.stringify(state)));
    const earlier = row('earlier', partition, null);
    Object.defineProperty(earlier, 'target', {
      get() {
        throw new Error('Target must remain sealed');
      },
    });
    expect(() => applyPlayerPavEmpiricalCalibration([earlier], fitted, restored)).toThrow(
      /calibration.*cutoff/i
    );
  }
);
it('rejects held-out application when no evaluation cutoff was retained', () => {
  const state = restorePlayerPavEmpiricalCalibration(
    JSON.parse(
      JSON.stringify(
        fitPlayerPavEmpiricalCalibration(
          [row('calibration', 'calibration', [9, 18, 27])],
          fitted,
          1,
          configuration
        )
      )
    )
  );
  expect(state.content.evaluationCutoff).toBeNull();
  expect(() =>
    applyPlayerPavEmpiricalCalibration([row('heldout', 'final_test', null)], fitted, state)
  ).toThrow(/calibration.*cutoff/i);
  expect(
    applyPlayerPavEmpiricalCalibration([row('calibration', 'calibration', null)], fitted, state)[0]!
      .distribution
  ).toEqual({ state: 'unavailable', reason: 'calibration_is_not_held_out_evaluation' });
});
it('restores exact empirical residual paths without accessing noncalibration targets', () => {
  const validation = row('validation', 'validation', null);
  Object.defineProperty(validation, 'target', {
    get() {
      throw new Error('Sealed validation target');
    },
  });
  const final = row('final', 'final_test', null);
  Object.defineProperty(final, 'target', {
    get() {
      throw new Error('Sealed final-test target');
    },
  });
  const rows = [
    row('low', 'calibration', [9, 18, 27]),
    row('high', 'calibration', [11, 22, 33]),
    validation,
    final,
  ];
  const state = fitPlayerPavEmpiricalCalibration(rows, fitted, 1, configuration);
  const restored = restorePlayerPavEmpiricalCalibration(JSON.parse(JSON.stringify(state)));
  expect(applyPlayerPavEmpiricalCalibration([validation], fitted, restored)[0]).toMatchObject({
    annualPointPav: [10, 20, 30],
    totalPointPav: 60,
    distribution: {
      state: 'empirical_calibration_paths',
      annualDraws: [
        [9, 18, 27],
        [11, 22, 33],
      ],
      totalDraws: [54, 66],
    },
  });
  expect(applyPlayerPavEmpiricalCalibration([final], fitted, restored)[0]!.totalPointPav).toBe(60);
});

it('rejects changed calibration state bytes and unknown fields on restoration', () => {
  const state = fitPlayerPavEmpiricalCalibration(
    [row('low', 'calibration', [9, 18, 27])],
    fitted,
    1,
    configuration
  );
  expect(() =>
    restorePlayerPavEmpiricalCalibration({
      ...state,
      content: { ...state.content, intervalCoverage: 0.9 },
    })
  ).toThrow();
  expect(() => restorePlayerPavEmpiricalCalibration({ ...state, approved: true })).toThrow();
});

it('does not use calibration labels unavailable by the validation cutoff', () => {
  const late = { ...row('late', 'calibration', [9, 18, 27]), labelAvailableAt: 10 };
  const state = fitPlayerPavEmpiricalCalibration(
    [late, row('validation', 'validation', null)],
    fitted,
    1,
    configuration
  );
  expect(state.content.residuals).toEqual([]);
  expect(
    applyPlayerPavEmpiricalCalibration([row('validation', 'validation', null)], fitted, state)[0]!
      .distribution
  ).toEqual({ state: 'unavailable', reason: 'insufficient_calibration_support' });
});
