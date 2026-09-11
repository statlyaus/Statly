import { describe, expect, it } from 'vitest';
import type { PlayerPavResearchRow } from '@/server/aflTradeIntelligence/modeling/playerPavForecastDesign';
import {
  createPlayerPavResearchForecasts,
  evaluatePlayerPavForecastPartition,
  evaluatePlayerPavPairedObservationScores,
} from '@/server/aflTradeIntelligence/modeling/playerPavForecastEvaluation';

type Forecast = ReturnType<typeof createPlayerPavResearchForecasts>[number];
function row(
  observationId: string,
  partition: 'validation' | 'final_test',
  target: number[] | null
): PlayerPavResearchRow {
  return {
    observationId,
    partition,
    target,
    playerId: observationId,
    predictionSeason: 2020,
    cutoff: 0,
    labelAvailableAt: 1,
    history: [{ pav: 1, games: 1 }],
    outcomeUnavailable: null,
    forecastUnavailable: null,
  };
}
function forecast(observationId: string, partition: 'validation' | 'final_test'): Forecast {
  return {
    observationId,
    playerId: observationId,
    partition,
    predictionSeason: 2020,
    annualPointPav: [2, 4, 6],
    totalPointPav: 12,
    historySupport: 'complete_history',
    distribution: { state: 'unavailable', reason: 'insufficient_calibration_support' },
  };
}
function sealTarget(input: PlayerPavResearchRow) {
  Object.defineProperty(input, 'target', {
    get() {
      throw new Error('Sealed target was accessed.');
    },
  });
  return input;
}

describe('partition-separated numerical PAV evaluation', () => {
  it('retains paired score contributions and dependence keys without reopening other partitions', () => {
    const actual = row('paired', 'final_test', [3, 3, 3]);
    const primary = forecast('paired', 'final_test');
    const baseline = { ...primary, annualPointPav: [3, 3, 3], totalPointPav: 9 };
    const scores = evaluatePlayerPavPairedObservationScores(
      [sealTarget(row('sealed', 'validation', null)), actual],
      [primary],
      [baseline],
      { intervalCoverage: 0.8 },
      'final_test'
    );
    expect(scores).toEqual([
      {
        observationId: 'paired',
        playerId: 'paired',
        predictionSeason: 2020,
        partition: 'final_test',
        primary: {
          annual: [
            { error: -1, absoluteError: 1, squaredError: 1, distribution: null },
            { error: 1, absoluteError: 1, squaredError: 1, distribution: null },
            { error: 3, absoluteError: 3, squaredError: 9, distribution: null },
          ],
          cumulative: { error: 3, absoluteError: 3, squaredError: 9, distribution: null },
        },
        baseline: {
          annual: [
            { error: 0, absoluteError: 0, squaredError: 0, distribution: null },
            { error: 0, absoluteError: 0, squaredError: 0, distribution: null },
            { error: 0, absoluteError: 0, squaredError: 0, distribution: null },
          ],
          cumulative: { error: 0, absoluteError: 0, squaredError: 0, distribution: null },
        },
      },
    ]);
  });
  it('rejects an unknown runtime partition before accessing targets', () => {
    expect(() =>
      Reflect.apply(evaluatePlayerPavForecastPartition, undefined, [
        [sealTarget(row('validation', 'validation', null))],
        [forecast('validation', 'validation')],
        { intervalCoverage: 0.8 },
        'train',
      ])
    ).toThrow('evaluation partition');
  });
  it('retains distribution scores on exact pairs and never treats missing paths as zeros', () => {
    const actual = row('paired', 'final_test', [2, 2, 2]);
    const primary: Forecast = {
      ...forecast('paired', 'final_test'),
      annualPointPav: [0, 0, 0],
      totalPointPav: 0,
      distribution: {
        state: 'empirical_calibration_paths',
        nominalCoverage: 0.8,
        calibrationObservationIds: ['minus', 'plus'],
        annualDraws: [
          [-1, -1, -1],
          [1, 1, 1],
        ],
        totalDraws: [-3, 3],
        annualIntervals: Array.from({ length: 3 }, () => ({ lower: -1, upper: 1 })),
        totalInterval: { lower: -3, upper: 3 },
      },
    };
    const result = evaluatePlayerPavPairedObservationScores(
      [actual, row('no-target', 'final_test', null)],
      [primary],
      [forecast('paired', 'final_test')],
      { intervalCoverage: 0.8 },
      'final_test'
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.primary.annual[0]!.distribution).toMatchObject({
      crps: 1.5,
      intervalCoverage: 0,
      intervalWidth: 2,
    });
    expect(result[0]!.primary.annual[0]!.distribution!.intervalScore).toBeCloseTo(12);
    expect(result[0]!.primary.cumulative.distribution).toMatchObject({
      crps: 4.5,
      intervalCoverage: 0,
      intervalWidth: 6,
    });
    expect(result[0]!.primary.cumulative.distribution!.intervalScore).toBeCloseTo(36);
    expect(result[0]!.baseline.cumulative.distribution).toBeNull();
  });
  it.each(['player', 'origin', 'duplicate_forecast', 'duplicate_observation'])(
    'rejects ambiguous paired %s identities before opening targets',
    (mutation) => {
      const actual = sealTarget(row('paired', 'final_test', null));
      const primary = forecast('paired', 'final_test');
      const candidate = {
        ...primary,
        ...(mutation === 'player' ? { playerId: 'wrong' } : {}),
        ...(mutation === 'origin' ? { predictionSeason: 2021 } : {}),
      };
      expect(() =>
        evaluatePlayerPavPairedObservationScores(
          mutation === 'duplicate_observation' ? [actual, actual] : [actual],
          mutation === 'duplicate_forecast' ? [candidate, candidate] : [candidate],
          [primary],
          { intervalCoverage: 0.8 },
          'final_test'
        )
      ).toThrow(/identit/);
    }
  );
  it('scores an explicitly opened final test without accessing validation targets', () => {
    const result = evaluatePlayerPavForecastPartition(
      [sealTarget(row('validation', 'validation', null)), row('final', 'final_test', [3, 3, 3])],
      [forecast('validation', 'validation'), forecast('final', 'final_test')],
      { intervalCoverage: 0.8 },
      'final_test'
    );
    expect(result.observationCount).toBe(1);
    expect(result.annual.map((metric) => metric?.bias)).toEqual([-1, 1, 3]);
    expect(result.cumulative).toMatchObject({ bias: 3, mae: 3, rmse: 3 });
  });
  it('preserves marginal distribution scores for the selected partition', () => {
    const result = evaluatePlayerPavForecastPartition(
      [row('validation', 'validation', [1, 1, 1])],
      [
        {
          ...forecast('validation', 'validation'),
          annualPointPav: [1, 1, 1],
          totalPointPav: 3,
          distribution: {
            state: 'empirical_calibration_paths',
            nominalCoverage: 0.8,
            calibrationObservationIds: ['calibration-one', 'calibration-two'],
            annualDraws: [
              [0, 0, 0],
              [2, 2, 2],
            ],
            totalDraws: [0, 6],
            annualIntervals: [
              { lower: 0, upper: 2 },
              { lower: 0, upper: 2 },
              { lower: 0, upper: 2 },
            ],
            totalInterval: { lower: 0, upper: 6 },
          },
        },
      ],
      { intervalCoverage: 0.8 },
      'validation'
    );
    expect(result.cumulative).toEqual({
      bias: 0,
      mae: 0,
      rmse: 0,
      distributionObservationCount: 1,
      crps: 1.5,
      intervalCoverage: 1,
      intervalWidth: 6,
      intervalScore: 6,
    });
    expect(result.annual.map((metric) => metric?.crps)).toEqual([0.5, 0.5, 0.5]);
  });
  it('reports no measured score when selected targets are unavailable', () => {
    expect(
      evaluatePlayerPavForecastPartition(
        [row('validation', 'validation', null)],
        [forecast('validation', 'validation')],
        { intervalCoverage: 0.8 },
        'validation'
      )
    ).toEqual({ observationCount: 0, annual: [null, null, null], cumulative: null });
  });
  it('rejects a forecast relabeled from final test to validation before reading its target', () => {
    expect(() =>
      evaluatePlayerPavForecastPartition(
        [sealTarget(row('same-id', 'final_test', null))],
        [forecast('same-id', 'validation')],
        { intervalCoverage: 0.8 },
        'validation'
      )
    ).toThrow('exact partition observation');
  });
  it('scores validation without accessing final-test targets', () => {
    const result = evaluatePlayerPavForecastPartition(
      [row('validation', 'validation', [1, 2, 3]), sealTarget(row('final', 'final_test', null))],
      [forecast('validation', 'validation'), forecast('final', 'final_test')],
      { intervalCoverage: 0.8 },
      'validation'
    );
    expect(result.observationCount).toBe(1);
    expect(result.annual.map((metric) => metric?.mae)).toEqual([1, 2, 3]);
    expect(result.cumulative).toMatchObject({
      bias: 6,
      mae: 6,
      rmse: 6,
      distributionObservationCount: 0,
      crps: null,
    });
  });
});
