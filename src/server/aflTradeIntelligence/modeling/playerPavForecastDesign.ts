import { z } from 'zod';

import type { AflTradePlayerPavObservationSet } from './playerPavObservationContracts';

const grid = (schema: z.ZodNumber, maximum: number) =>
  z
    .array(schema)
    .min(1)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, 'Candidate grids must be unique.')
    .transform((values) => [...values].sort((left, right) => left - right));

export const playerPavForecastConfigurationSchema = z
  .object({
    schemaVersion: z.literal('player-pav-forecast-comparison/v1'),
    horizonSeasons: z.literal(3),
    featureHistories: grid(z.number().int().min(1).max(3), 3),
    ridgePenalties: grid(z.number().finite().positive(), 10),
    shrinkagePseudoSeasons: grid(z.number().finite().positive(), 10),
    minimumTrainingObservations: z.number().int().min(2).max(100_000),
    minimumTuningOrigins: z.number().int().min(1).max(200),
    minimumCalibrationObservations: z.number().int().min(2).max(100_000),
    intervalCoverage: z.number().gt(0).lt(1),
    knowledgePolicy: z.enum(['calculated_by_origin', 'retrospective_finalized_measurements']),
  })
  .strict();

export type PlayerPavForecastConfiguration = z.infer<typeof playerPavForecastConfigurationSchema>;
export type PlayerPavForecastCandidate =
  | { kind: 'persistence'; historySeasons: 1 }
  | { kind: 'shrinkage'; historySeasons: number; pseudoSeasons: number }
  | { kind: 'ridge'; historySeasons: number; penalty: number };

export interface PlayerPavResearchRow {
  observationId: string;
  playerId: string;
  partition: AflTradePlayerPavObservationSet['content']['observations'][number]['partition'];
  predictionSeason: number;
  cutoff: number;
  labelAvailableAt: number;
  history: ({ pav: number; games: number } | null)[];
  target: number[] | null;
  outcomeUnavailable: string | null;
  forecastUnavailable: string | null;
}

/** Preserve v1 unavailable outcomes; this adapter never manufactures new measured rows. */
export function preparePlayerPavResearchRows(
  set: AflTradePlayerPavObservationSet,
  configuration: Pick<PlayerPavForecastConfiguration, 'featureHistories' | 'knowledgePolicy'>
): PlayerPavResearchRow[] {
  return preparePlayerPavForecastRows(set, configuration, [
    'train',
    'calibration',
    'validation',
    'final_test',
  ]);
}

const targetPartitionsSchema = z
  .array(z.enum(['train', 'calibration', 'validation', 'final_test']))
  .max(4)
  .refine((values) => new Set(values).size === values.length, 'Target partitions must be unique.');

/** Controls numerical label access only; it does not authenticate custody or grant evaluation authority. */
export function preparePlayerPavForecastRows(
  set: AflTradePlayerPavObservationSet,
  configuration: Pick<PlayerPavForecastConfiguration, 'featureHistories' | 'knowledgePolicy'>,
  targetPartitions: readonly PlayerPavResearchRow['partition'][],
  selectedObservationIds?: readonly string[]
): PlayerPavResearchRow[] {
  const openedTargets = new Set(targetPartitionsSchema.parse(targetPartitions));
  const selectedTargets =
    selectedObservationIds === undefined
      ? null
      : new Set(z.array(z.string().min(1)).max(100_000).parse(selectedObservationIds));
  if (selectedTargets) {
    const known = new Set(set.content.observations.map((row) => row.observationId));
    if (
      selectedTargets.size !== selectedObservationIds!.length ||
      [...selectedTargets].some((id) => !known.has(id))
    )
      throw new RangeError('Selected target IDs require unique exact observation-set membership.');
  }
  if (
    set.content.schemaVersion === 'afl-trade-player-pav-observation-set/v2' &&
    configuration.knowledgePolicy !== 'retrospective_finalized_measurements'
  ) {
    throw new TypeError('Retrospective PAV observations require a retrospective knowledge policy.');
  }
  if (
    set.content.policy.content.fixedHorizonSeasons !== 3 ||
    Math.max(...configuration.featureHistories) > set.content.policy.content.featureHistorySeasons
  ) {
    throw new TypeError(
      'PAV comparison requires the exact three-season horizon and admitted feature window.'
    );
  }
  const keys = new Set<string>();
  return set.content.observations.map((row) => {
    const targetOpened =
      openedTargets.has(row.partition) &&
      (selectedTargets === null || selectedTargets.has(row.observationId));
    if (
      row.targetCalculationSeasons.length !== 3 ||
      row.targetCalculationSeasons.some(
        (season, index) => season !== row.predictionSeason + index + 1
      ) ||
      row.outcomeHorizonEndsAt !== `${row.predictionSeason + 3}-12-31T23:59:59.999Z`
    ) {
      throw new TypeError(
        'PAV research outcomes must describe the exact three-season target and horizon end.'
      );
    }
    const key = `${row.playerId}|${row.predictionSeason}|${row.acquisitionSpell.spellVersionId}`;
    if (keys.has(key)) throw new TypeError('Duplicated PAV player-origin-spell observation.');
    keys.add(key);
    const cutoff = Date.parse(row.predictionCutoffAt);
    const knowledgeCutoff = Date.parse(set.content.knowledgeCutoffAt);
    if (
      row.featureValues.some((value) => Date.parse(value.calculatedAt) > knowledgeCutoff) ||
      (targetOpened &&
        (row.targetValues.some((value) => Date.parse(value.calculatedAt) > knowledgeCutoff) ||
          Date.parse(row.outcomeObservedAt) > knowledgeCutoff))
    ) {
      throw new TypeError('PAV research evidence exceeds the observation-set knowledge cutoff.');
    }
    const history = row.featureCalculationSeasons.map((season) => {
      const values = row.featureValues.filter((value) => value.seasonYear === season);
      const gameIds = values.flatMap((value) => value.sourceRowIds);
      if (new Set(gameIds).size !== gameIds.length || gameIds.length > 30) {
        throw new TypeError('PAV feature spells must not double-count season game evidence.');
      }
      return values.length === 0
        ? null
        : {
            pav: values.reduce((sum, value) => sum + value.totalPav, 0),
            games: gameIds.length,
          };
    });
    const target =
      !targetOpened || row.outcome.state !== 'mature_observed'
        ? null
        : row.targetCalculationSeasons.map((season) => {
            const value = row.targetValues.find((entry) => entry.seasonYear === season);
            if (value) return value.totalPav;
            const end = row.acquisitionSpell.effectiveThrough;
            if (end !== null && season > Number(end.slice(0, 4))) return 0;
            throw new TypeError('Missing measured PAV cannot be converted to a zero target.');
          });
    const strict = configuration.knowledgePolicy === 'calculated_by_origin';
    return {
      observationId: row.observationId,
      playerId: row.playerId,
      partition: row.partition,
      predictionSeason: row.predictionSeason,
      cutoff,
      labelAvailableAt: targetOpened
        ? Math.max(
            Date.parse(row.outcomeObservedAt),
            Date.parse(row.outcomeHorizonEndsAt),
            ...(strict ? row.targetValues.map((value) => Date.parse(value.calculatedAt)) : [])
          )
        : Infinity,
      history,
      target,
      outcomeUnavailable: !targetOpened
        ? 'target_not_opened'
        : row.outcome.state === 'unavailable'
          ? row.outcome.reason
          : row.outcome.state === 'right_censored'
            ? 'right_censored'
            : null,
      forecastUnavailable:
        strict && row.featureValues.some((value) => Date.parse(value.calculatedAt) > cutoff)
          ? 'feature_not_calculated_by_origin'
          : null,
    };
  });
}
