import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type { PlayerPavForecastCandidate, PlayerPavResearchRow } from './playerPavForecastDesign';

const finite = z.number().finite();
const annualMeans = z.array(finite).length(3);
const historySeasons = z.number().int().min(1).max(3);
const candidateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('persistence'), historySeasons: z.literal(1) }).strict(),
  z
    .object({ kind: z.literal('shrinkage'), historySeasons, pseudoSeasons: finite.positive() })
    .strict(),
  z.object({ kind: z.literal('ridge'), historySeasons, penalty: finite.positive() }).strict(),
]);
const version = { schemaVersion: z.literal('player-pav-forecast-fit/v1') };
const fitContentSchema = z
  .discriminatedUnion('kind', [
    candidateSchema.options[0].extend({ ...version, pooledMeans: annualMeans }).strict(),
    candidateSchema.options[1].extend({ ...version, pooledMeans: annualMeans }).strict(),
    candidateSchema.options[2]
      .extend({
        ...version,
        imputationMeans: z
          .array(z.object({ pav: finite, games: finite }).strict())
          .min(1)
          .max(3),
        centers: z.array(finite).min(3).max(9),
        scales: z.array(finite.positive()).min(3).max(9),
        coefficients: z.array(z.array(finite).min(3).max(9)).length(3),
        targetMeans: annualMeans,
      })
      .strict(),
  ])
  .superRefine((state, context) => {
    if (
      state.kind === 'ridge' &&
      (state.imputationMeans.length !== state.historySeasons ||
        state.centers.length !== state.historySeasons * 3 ||
        state.scales.length !== state.historySeasons * 3 ||
        state.coefficients.some((row) => row.length !== state.historySeasons * 3))
    )
      context.addIssue({
        code: 'custom',
        message: 'PAV fitted dimensions must match the candidate history.',
      });
  });

export const playerPavForecastFitStateSchema = z
  .object({
    fitId: aflTradeContentAddressedIdSchema('player-pav-forecast-fit'),
    content: fitContentSchema,
  })
  .strict()
  .superRefine((state, context) => {
    addAflTradeContentAddressIssue('player-pav-forecast-fit', state.fitId, state.content, context, [
      'fitId',
    ]);
  });

export type PlayerPavForecastFitState = z.infer<typeof playerPavForecastFitStateSchema>;

export interface PlayerPavFittedForecast {
  readonly state: PlayerPavForecastFitState;
  predict(row: PlayerPavResearchRow): number[];
}

function assertHistory(row: PlayerPavResearchRow, seasons: number): void {
  if (
    row.history.length < seasons ||
    row.history.some(
      (value) => value !== null && (!Number.isFinite(value.pav) || !Number.isFinite(value.games))
    )
  )
    throw new TypeError('PAV prediction requires finite history with explicit missing seasons.');
}

function ridgeFeatures(
  row: PlayerPavResearchRow,
  seasons: number,
  means: { pav: number; games: number }[]
) {
  return row.history
    .slice(-seasons)
    .flatMap((value, lag) => [
      value?.pav ?? means[lag]!.pav,
      value?.games ?? means[lag]!.games,
      value === null ? 1 : 0,
    ]);
}

/** Restores numerical state only; this grants no run, dataset or model qualification authority. */
export function restorePlayerPavForecast(unparsed: unknown): PlayerPavFittedForecast {
  const state = playerPavForecastFitStateSchema.parse(unparsed);
  const content = state.content;
  return {
    get state() {
      return structuredClone(state);
    },
    predict(row) {
      assertHistory(row, content.historySeasons);
      let predicted: number[];
      if (content.kind === 'ridge') {
        const values = ridgeFeatures(row, content.historySeasons, content.imputationMeans).map(
          (value, column) => (value - content.centers[column]!) / content.scales[column]!
        );
        predicted = content.coefficients.map(
          (beta, horizon) =>
            content.targetMeans[horizon]! +
            beta.reduce((sum, value, column) => sum + value * values[column]!, 0)
        );
      } else {
        const history = row.history
          .slice(-content.historySeasons)
          .filter((value) => value !== null);
        if (content.kind === 'persistence')
          predicted = [0, 1, 2].map(() => history.at(-1)?.pav ?? content.pooledMeans[0]!);
        else {
          const sum = history.reduce((total, value) => total + value.pav, 0);
          predicted = content.pooledMeans.map(
            (mean) =>
              (sum + content.pseudoSeasons * mean) / (history.length + content.pseudoSeasons)
          );
        }
      }
      if (predicted.some((value) => !Number.isFinite(value)))
        throw new RangeError('PAV predictions must remain finite.');
      return predicted;
    },
  };
}

function retainFit(content: z.input<typeof fitContentSchema>): PlayerPavFittedForecast {
  return restorePlayerPavForecast({
    fitId: createAflTradeContentAddress('player-pav-forecast-fit', content),
    content,
  });
}

function fitRidge(
  rows: readonly PlayerPavResearchRow[],
  historySeasons: number,
  penalty: number
): PlayerPavFittedForecast {
  const histories = rows.map((row) => row.history.slice(-historySeasons));
  const means = Array.from({ length: historySeasons }, (_, lag) => {
    const observed = histories.flatMap((history) => (history[lag] === null ? [] : [history[lag]!]));
    return {
      pav:
        observed.length === 0
          ? 0
          : observed.reduce((sum, value) => sum + value.pav, 0) / observed.length,
      games:
        observed.length === 0
          ? 0
          : observed.reduce((sum, value) => sum + value.games, 0) / observed.length,
    };
  });
  const raw = rows.map((row) => ridgeFeatures(row, historySeasons, means));
  const width = historySeasons * 3;
  const centers = Array.from(
    { length: width },
    (_, column) => raw.reduce((sum, row) => sum + row[column]!, 0) / rows.length
  );
  const scales = centers.map(
    (center, column) =>
      Math.sqrt(raw.reduce((sum, row) => sum + (row[column]! - center) ** 2, 0) / rows.length) || 1
  );
  const standardize = (values: number[]) =>
    values.map((value, column) => (value - centers[column]!) / scales[column]!);
  const x = raw.map(standardize);
  const yMean = [0, 1, 2].map(
    (horizon) => rows.reduce((sum, row) => sum + row.target![horizon]!, 0) / rows.length
  );
  const gram = centers.map((_, left) =>
    centers.map(
      (__, right) =>
        x.reduce((sum, row) => sum + row[left]! * row[right]!, 0) + (left === right ? penalty : 0)
    )
  );
  // Cholesky solves the positive-definite ridge system without an explicit matrix inverse.
  const lower = gram.map((row) => row.map(() => 0));
  for (let left = 0; left < width; left += 1) {
    for (let right = 0; right <= left; right += 1) {
      let entry = gram[left]![right]!;
      for (let k = 0; k < right; k += 1) entry -= lower[left]![k]! * lower[right]![k]!;
      if (left === right && (!(entry > 0) || !Number.isFinite(entry)))
        throw new RangeError('PAV ridge system is numerically unsupported.');
      lower[left]![right] = left === right ? Math.sqrt(entry) : entry / lower[right]![right]!;
    }
  }
  const coefficients = yMean.map((mean, horizon) => {
    const rhs = centers.map((_, column) =>
      x.reduce((sum, row, index) => sum + row[column]! * (rows[index]!.target![horizon]! - mean), 0)
    );
    const intermediate = Array<number>(width).fill(0);
    const beta = Array<number>(width).fill(0);
    for (let i = 0; i < width; i += 1) {
      let value = rhs[i]!;
      for (let j = 0; j < i; j += 1) value -= lower[i]![j]! * intermediate[j]!;
      intermediate[i] = value / lower[i]![i]!;
    }
    for (let i = width - 1; i >= 0; i -= 1) {
      let value = intermediate[i]!;
      for (let j = i + 1; j < width; j += 1) value -= lower[j]![i]! * beta[j]!;
      beta[i] = value / lower[i]![i]!;
    }
    return beta;
  });
  return retainFit({
    schemaVersion: 'player-pav-forecast-fit/v1',
    kind: 'ridge',
    historySeasons,
    penalty,
    imputationMeans: means,
    centers,
    scales,
    coefficients,
    targetMeans: yMean,
  });
}

export function fitPlayerPavForecast(
  rows: readonly PlayerPavResearchRow[],
  candidate: PlayerPavForecastCandidate
): PlayerPavFittedForecast {
  candidateSchema.parse(candidate);
  if (rows.length === 0 || rows.length > 100_000)
    throw new RangeError('PAV fitting requires a bounded nonempty training set.');
  for (const row of rows) {
    assertHistory(row, candidate.historySeasons);
    if (
      row.target === null ||
      row.target.length !== 3 ||
      row.target.some((value) => !Number.isFinite(value))
    )
      throw new TypeError('PAV fitting requires three finite annual targets.');
  }
  if (candidate.kind === 'ridge')
    return fitRidge(rows, candidate.historySeasons, candidate.penalty);
  const pooled = [0, 1, 2].map(
    (horizon) => rows.reduce((sum, row) => sum + row.target![horizon]!, 0) / rows.length
  );
  return retainFit({
    schemaVersion: 'player-pav-forecast-fit/v1',
    ...candidate,
    pooledMeans: pooled,
  });
}
