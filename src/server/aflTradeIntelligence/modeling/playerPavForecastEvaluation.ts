import type {
  PlayerPavForecastConfiguration,
  PlayerPavResearchRow,
} from './playerPavForecastDesign';
import type { PlayerPavFittedForecast } from './playerPavForecastFit';
import { z } from 'zod';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';

const calibrationContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-pav-empirical-calibration/v1'),
    authorityBoundary: z.literal('numerical_calibration_no_execution_or_qualification_authority'),
    historySeasons: z.number().int().min(1).max(3),
    minimumCalibrationObservations: z.number().int().min(2).max(100_000),
    intervalCoverage: z.number().gt(0).lt(1),
    evaluationCutoff: z.number().finite().nullable(),
    residuals: z
      .array(
        z
          .object({
            observationId: z.string().min(1),
            errors: z.array(z.number().finite()).length(3),
          })
          .strict()
      )
      .max(100_000),
  })
  .strict();
export const playerPavEmpiricalCalibrationSchema = z
  .object({
    calibrationId: z.string().regex(/^player-pav-empirical-calibration:[a-f0-9]{64}$/),
    content: calibrationContentSchema,
  })
  .strict()
  .refine(
    (state) =>
      state.calibrationId ===
      createAflTradeContentAddress('player-pav-empirical-calibration', state.content)
  );
export type PlayerPavEmpiricalCalibration = z.infer<typeof playerPavEmpiricalCalibrationSchema>;
export function restorePlayerPavEmpiricalCalibration(
  input: unknown
): PlayerPavEmpiricalCalibration {
  return playerPavEmpiricalCalibrationSchema.parse(input);
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => sum(values) / values.length;
const quantile = (sorted: readonly number[], probability: number) =>
  sorted[Math.max(0, Math.ceil(probability * sorted.length) - 1)]!;

function interval(draws: readonly number[], coverage: number) {
  const sorted = [...draws].sort((left, right) => left - right);
  return {
    lower: quantile(sorted, (1 - coverage) / 2),
    upper: quantile(sorted, (1 + coverage) / 2),
  };
}

function distributionScore(draws: readonly number[], actual: number, coverage: number) {
  const sorted = [...draws].sort((left, right) => left - right);
  const bounds = interval(sorted, coverage);
  const width = bounds.upper - bounds.lower;
  // Equivalent to the empirical pairwise CRPS definition, without quadratic storage or work.
  const crps =
    mean(sorted.map((value) => Math.abs(value - actual))) -
    sum(sorted.map((value, index) => (2 * index - sorted.length + 1) * value)) / sorted.length ** 2;
  return {
    crps,
    intervalCoverage: Number(actual >= bounds.lower && actual <= bounds.upper),
    intervalWidth: width,
    intervalScore:
      width +
      (2 / (1 - coverage)) *
        (Math.max(bounds.lower - actual, 0) + Math.max(actual - bounds.upper, 0)),
  };
}

/** Calibration supplies marginal player paths only, never cross-player/trade dependence. */
export function createPlayerPavResearchForecasts(
  rows: readonly PlayerPavResearchRow[],
  fitted: PlayerPavFittedForecast,
  historySeasons: number,
  configuration: PlayerPavForecastConfiguration
) {
  return applyPlayerPavEmpiricalCalibration(
    rows,
    fitted,
    fitPlayerPavEmpiricalCalibration(rows, fitted, historySeasons, configuration)
  );
}

/** Fits the existing marginal calibration arithmetic; this grants no evaluation authority. */
export function fitPlayerPavEmpiricalCalibration(
  rows: readonly PlayerPavResearchRow[],
  fitted: Pick<PlayerPavFittedForecast, 'predict'>,
  historySeasons: number,
  configuration: Pick<
    PlayerPavForecastConfiguration,
    'minimumCalibrationObservations' | 'intervalCoverage'
  >
): PlayerPavEmpiricalCalibration {
  const evaluationCutoff = Math.min(
    ...rows.filter((row) => row.partition === 'validation').map((row) => row.cutoff)
  );
  const residuals = rows
    .filter(
      (row) =>
        row.partition === 'calibration' &&
        row.target !== null &&
        row.forecastUnavailable === null &&
        row.labelAvailableAt < evaluationCutoff &&
        row.history.slice(-historySeasons).every((value) => value !== null)
    )
    .map((row) => ({
      observationId: row.observationId,
      errors: fitted.predict(row).map((value, horizon) => row.target![horizon]! - value),
    }));
  const content = {
    schemaVersion: 'afl-trade-player-pav-empirical-calibration/v1' as const,
    authorityBoundary: 'numerical_calibration_no_execution_or_qualification_authority' as const,
    historySeasons,
    minimumCalibrationObservations: configuration.minimumCalibrationObservations,
    intervalCoverage: configuration.intervalCoverage,
    evaluationCutoff: Number.isFinite(evaluationCutoff) ? evaluationCutoff : null,
    residuals,
  };
  return restorePlayerPavEmpiricalCalibration({
    calibrationId: createAflTradeContentAddress('player-pav-empirical-calibration', content),
    content,
  });
}

/** Applies retained marginal paths without opening targets or refitting calibration. */
export function applyPlayerPavEmpiricalCalibration(
  rows: readonly PlayerPavResearchRow[],
  fitted: Pick<PlayerPavFittedForecast, 'predict'>,
  unparsed: PlayerPavEmpiricalCalibration
) {
  const { content: configuration } = restorePlayerPavEmpiricalCalibration(unparsed);
  const { residuals, historySeasons } = configuration;
  // A null cutoff records that fitting had no validation anchor. It can still
  // describe calibration rows, but cannot establish temporal safety for held-out use.
  if (
    rows.some(
      (row) =>
        (row.partition === 'validation' || row.partition === 'final_test') &&
        (configuration.evaluationCutoff === null ||
          !Number.isFinite(row.cutoff) ||
          row.cutoff < configuration.evaluationCutoff)
    )
  ) {
    throw new RangeError(
      'PAV calibration requires a retained cutoff no later than each evaluation origin.'
    );
  }
  if (
    residuals.length *
      rows.filter((row) => row.partition === 'validation' || row.partition === 'final_test')
        .length *
      4 >
    2_000_000
  ) {
    throw new RangeError('PAV empirical path workload exceeds the supported comparison bound.');
  }
  return rows
    .filter((row) => row.partition !== 'train' && row.forecastUnavailable === null)
    .map((row) => {
      const annualPointPav = fitted.predict(row);
      const totalPointPav = sum(annualPointPav);
      if ([...annualPointPav, totalPointPav].some((value) => !Number.isFinite(value))) {
        throw new RangeError('PAV forecast arithmetic must remain finite.');
      }
      const shortHistory = row.history.slice(-historySeasons).some((value) => value === null);
      const unavailable =
        row.partition === 'calibration'
          ? 'calibration_is_not_held_out_evaluation'
          : shortHistory
            ? 'short_history_calibration_unsupported'
            : residuals.length < configuration.minimumCalibrationObservations
              ? 'insufficient_calibration_support'
              : null;
      const annualDraws =
        unavailable === null
          ? residuals.map((path) =>
              annualPointPav.map((value, horizon) => value + path.errors[horizon]!)
            )
          : [];
      const totalDraws = annualDraws.map(sum);
      if (
        annualDraws.some((draw) => draw.some((value) => !Number.isFinite(value))) ||
        totalDraws.some((value) => !Number.isFinite(value))
      ) {
        throw new RangeError('PAV predictive paths must remain finite.');
      }
      return {
        observationId: row.observationId,
        playerId: row.playerId,
        partition: row.partition,
        predictionSeason: row.predictionSeason,
        annualPointPav,
        totalPointPav,
        historySupport: shortHistory
          ? ('short_history_unvalidated' as const)
          : ('complete_history' as const),
        distribution:
          unavailable !== null
            ? { state: 'unavailable' as const, reason: unavailable }
            : {
                state: 'empirical_calibration_paths' as const,
                nominalCoverage: configuration.intervalCoverage,
                calibrationObservationIds: residuals.map((path) => path.observationId),
                annualDraws,
                totalDraws,
                annualIntervals: [0, 1, 2].map((horizon) =>
                  interval(
                    annualDraws.map((draw) => draw[horizon]!),
                    configuration.intervalCoverage
                  )
                ),
                totalInterval: interval(totalDraws, configuration.intervalCoverage),
              },
      };
    });
}

export function evaluatePlayerPavResearchForecasts(
  rows: readonly PlayerPavResearchRow[],
  forecasts: ReturnType<typeof createPlayerPavResearchForecasts>,
  configuration: PlayerPavForecastConfiguration
) {
  return {
    validation: evaluatePlayerPavForecastPartition(rows, forecasts, configuration, 'validation'),
    final_test: evaluatePlayerPavForecastPartition(rows, forecasts, configuration, 'final_test'),
  };
}

/** Numerical scoring only. The execution owner must authorize target access before calling. */
export function evaluatePlayerPavForecastPartition(
  rows: readonly PlayerPavResearchRow[],
  forecasts: ReturnType<typeof createPlayerPavResearchForecasts>,
  configuration: Pick<PlayerPavForecastConfiguration, 'intervalCoverage'>,
  partition: 'validation' | 'final_test'
) {
  if (partition !== 'validation' && partition !== 'final_test') {
    throw new RangeError('PAV evaluation partition must be validation or final_test.');
  }
  const rowsById = new Map(
    rows.filter((row) => row.partition === partition).map((row) => [row.observationId, row])
  );
  const observed = forecasts.filter((forecast) => {
    if (forecast.partition !== partition) return false;
    const row = rowsById.get(forecast.observationId);
    if (!row) throw new RangeError('PAV forecast requires its exact partition observation.');
    return row.target !== null;
  });
  const metrics = (horizon: number | null) => {
    if (observed.length === 0) return null;
    const errors = observed.map((forecast) => {
      const target = rowsById.get(forecast.observationId)!.target!;
      return horizon === null
        ? forecast.totalPointPav - sum(target)
        : forecast.annualPointPav[horizon]! - target[horizon]!;
    });
    const distributions = observed.flatMap((forecast) => {
      if (forecast.distribution.state === 'unavailable') return [];
      const target = rowsById.get(forecast.observationId)!.target!;
      return [
        distributionScore(
          horizon === null
            ? forecast.distribution.totalDraws
            : forecast.distribution.annualDraws.map((draw) => draw[horizon]!),
          horizon === null ? sum(target) : target[horizon]!,
          configuration.intervalCoverage
        ),
      ];
    });
    const result = {
      bias: mean(errors),
      mae: mean(errors.map(Math.abs)),
      rmse: Math.sqrt(mean(errors.map((value) => value ** 2))),
      distributionObservationCount: distributions.length,
      crps: distributions.length === 0 ? null : mean(distributions.map((score) => score.crps)),
      intervalCoverage:
        distributions.length === 0
          ? null
          : mean(distributions.map((score) => score.intervalCoverage)),
      intervalWidth:
        distributions.length === 0 ? null : mean(distributions.map((score) => score.intervalWidth)),
      intervalScore:
        distributions.length === 0 ? null : mean(distributions.map((score) => score.intervalScore)),
    };
    if (Object.values(result).some((value) => value !== null && !Number.isFinite(value))) {
      throw new RangeError('PAV evaluation scores must remain finite.');
    }
    return result;
  };
  return {
    observationCount: observed.length,
    annual: [0, 1, 2].map(metrics),
    cumulative: metrics(null),
  };
}

/** Retains paired score contributions, not confidence intervals or qualification authority.
 * The execution owner must authorize target access. Player and origin keys allow a later
 * declared dependence-aware analysis without reopening sealed numerical outcomes.
 */
export function evaluatePlayerPavPairedObservationScores(
  rows: readonly PlayerPavResearchRow[],
  primary: ReturnType<typeof createPlayerPavResearchForecasts>,
  baseline: ReturnType<typeof createPlayerPavResearchForecasts>,
  configuration: Pick<PlayerPavForecastConfiguration, 'intervalCoverage'>,
  partition: 'validation' | 'final_test'
) {
  if (partition !== 'validation' && partition !== 'final_test')
    throw new RangeError('PAV evaluation partition must be validation or final_test.');
  const selected = rows.filter((row) => row.partition === partition);
  const byId = new Map(selected.map((row) => [row.observationId, row]));
  if (byId.size !== selected.length)
    throw new RangeError('Paired PAV scores require unique observation identities.');
  const index = (forecasts: typeof primary) => {
    const matches = forecasts.filter((forecast) => forecast.partition === partition);
    const result = new Map(matches.map((forecast) => [forecast.observationId, forecast]));
    if (result.size !== matches.length)
      throw new RangeError('Paired PAV scores require unique forecast identities.');
    for (const forecast of matches) {
      const row = byId.get(forecast.observationId);
      if (
        !row ||
        row.playerId !== forecast.playerId ||
        row.predictionSeason !== forecast.predictionSeason
      )
        throw new RangeError(
          'Paired PAV scores require exact player, origin and partition identity.'
        );
    }
    return result;
  };
  const primaryById = index(primary);
  const baselineById = index(baseline);
  type Metric = NonNullable<ReturnType<typeof evaluatePlayerPavForecastPartition>['cumulative']>;
  const contribution = (metric: Metric | null) => {
    if (metric === null) throw new RangeError('Paired PAV score requires an observed outcome.');
    const squaredError = metric.bias ** 2;
    if (!Number.isFinite(squaredError))
      throw new RangeError('PAV evaluation scores must remain finite.');
    return {
      error: metric.bias,
      absoluteError: metric.mae,
      squaredError,
      distribution:
        metric.distributionObservationCount === 0
          ? null
          : {
              crps: metric.crps!,
              intervalCoverage: metric.intervalCoverage!,
              intervalWidth: metric.intervalWidth!,
              intervalScore: metric.intervalScore!,
            },
    };
  };
  const score = (row: PlayerPavResearchRow, forecast: (typeof primary)[number]) => {
    const metrics = evaluatePlayerPavForecastPartition([row], [forecast], configuration, partition);
    return {
      annual: metrics.annual.map(contribution),
      cumulative: contribution(metrics.cumulative),
    };
  };
  return selected.flatMap((row) => {
    const left = primaryById.get(row.observationId);
    const right = baselineById.get(row.observationId);
    if (!left || !right || row.target === null) return [];
    return [
      {
        observationId: row.observationId,
        playerId: row.playerId,
        predictionSeason: row.predictionSeason,
        partition,
        primary: score(row, left),
        baseline: score(row, right),
      },
    ];
  });
}
