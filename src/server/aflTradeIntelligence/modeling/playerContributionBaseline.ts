import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradePlayerBaselineConfigSchema,
  aflTradePlayerBaselineFitSchema,
  aflTradePlayerObservationSetSchema,
  type AflTradePlayerBaselineConfig,
  type AflTradePlayerBaselineFit,
  type AflTradePlayerObservationSet,
  type AflTradePlayerSeasonObservation,
} from './playerContributionContracts';

interface WeightedValue {
  observationId: string;
  value: number;
  weight: number;
}

function groupKey(role: string, era: string): string {
  return `${role}\u0000${era}`;
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

export function calculateAflTradeWeightedQuantile(
  unparsedValues: readonly WeightedValue[],
  quantile: number
): number {
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new RangeError('Weighted quantile must be greater than zero and no greater than one.');
  }
  if (unparsedValues.length === 0) {
    throw new RangeError('Weighted quantile requires at least one value.');
  }
  const values = unparsedValues.map((entry) => {
    if (
      !entry.observationId.trim() ||
      !Number.isFinite(entry.value) ||
      !Number.isFinite(entry.weight) ||
      entry.weight <= 0
    ) {
      throw new RangeError(
        'Weighted quantile entries require an identity, value, and positive weight.'
      );
    }
    return { ...entry };
  });
  if (new Set(values.map(({ observationId }) => observationId)).size !== values.length) {
    throw new RangeError('Weighted quantile observation identities must be unique.');
  }
  values.sort(
    (left, right) =>
      left.value - right.value || left.observationId.localeCompare(right.observationId)
  );
  const totalWeight = values.reduce((total, entry) => total + entry.weight, 0);
  const threshold = quantile * totalWeight;
  let cumulativeWeight = 0;
  for (const entry of values) {
    cumulativeWeight += entry.weight;
    if (cumulativeWeight >= threshold) return normalizeNumber(entry.value);
  }
  return normalizeNumber(values.at(-1)!.value);
}

function eligibleForReplacementFit(
  observation: AflTradePlayerSeasonObservation,
  config: AflTradePlayerBaselineConfig
): observation is AflTradePlayerSeasonObservation & {
  contribution: { state: 'observed'; total: number };
} {
  return (
    observation.partition === 'train' &&
    observation.contribution.state === 'observed' &&
    observation.gamesPlayed >= config.minimumGamesForReplacementFit
  );
}

export function fitAflTradePlayerContributionBaseline(
  unparsedSet: AflTradePlayerObservationSet,
  unparsedConfig: AflTradePlayerBaselineConfig
): AflTradePlayerBaselineFit {
  const set = aflTradePlayerObservationSetSchema.parse(unparsedSet);
  const config = aflTradePlayerBaselineConfigSchema.parse(unparsedConfig);
  const observations = [...set.content.observations].sort((left, right) =>
    left.observationId.localeCompare(right.observationId)
  );
  const eligibleTrainingObservations = observations.filter((observation) =>
    eligibleForReplacementFit(observation, config)
  );
  const trainingGroups = new Map<string, typeof eligibleTrainingObservations>();
  for (const observation of eligibleTrainingObservations) {
    const key = groupKey(observation.role, observation.era);
    const group = trainingGroups.get(key) ?? [];
    group.push(observation);
    trainingGroups.set(key, group);
  }

  const replacementByGroup = new Map<string, number>();
  const replacementLevels: AflTradePlayerBaselineFit['content']['replacementLevels'] = [];
  for (const [key, group] of trainingGroups) {
    if (group.length < config.minimumTrainingObservationsPerGroup) continue;
    const first = group[0];
    const totalGamesWeight = group.reduce(
      (total, observation) => total + observation.gamesPlayed,
      0
    );
    const replacementContributionPerGame = calculateAflTradeWeightedQuantile(
      group.map((observation) => ({
        observationId: observation.observationId,
        value: observation.contribution.total / observation.gamesPlayed,
        weight: observation.gamesPlayed,
      })),
      config.replacementQuantile
    );
    replacementByGroup.set(key, replacementContributionPerGame);
    replacementLevels.push({
      role: first.role,
      era: first.era,
      eligibleTrainingObservations: group.length,
      totalGamesWeight,
      replacementContributionPerGame,
    });
  }
  replacementLevels.sort(
    (left, right) => left.role.localeCompare(right.role) || left.era.localeCompare(right.era)
  );

  const scores: AflTradePlayerBaselineFit['content']['scores'] = [];
  const unscored: AflTradePlayerBaselineFit['content']['unscored'] = [];
  for (const observation of observations) {
    if (observation.contribution.state === 'unavailable') {
      unscored.push({
        observationId: observation.observationId,
        reason: 'contribution_unavailable',
      });
      continue;
    }
    if (observation.gamesPlayed === 0) {
      unscored.push({ observationId: observation.observationId, reason: 'zero_games' });
      continue;
    }
    const replacementContributionPerGame = replacementByGroup.get(
      groupKey(observation.role, observation.era)
    );
    if (replacementContributionPerGame === undefined) {
      unscored.push({
        observationId: observation.observationId,
        reason: 'unsupported_role_era',
      });
      continue;
    }
    const observedContributionPerGame = normalizeNumber(
      observation.contribution.total / observation.gamesPlayed
    );
    const impactAboveReplacementPerGame = normalizeNumber(
      observedContributionPerGame - replacementContributionPerGame
    );
    scores.push({
      observationId: observation.observationId,
      playerId: observation.playerId,
      season: observation.season,
      partition: observation.partition,
      role: observation.role,
      era: observation.era,
      gamesPlayed: observation.gamesPlayed,
      gamesAvailable: observation.gamesAvailable,
      observedContribution: observation.contribution.total,
      observedContributionPerGame,
      replacementContributionPerGame,
      impactAboveReplacementPerGame,
      availabilityRate: normalizeNumber(observation.gamesPlayed / observation.gamesAvailable),
      observedContributionAboveReplacement: normalizeNumber(
        impactAboveReplacementPerGame * observation.gamesPlayed
      ),
      careerTreatment: observation.career.state,
    });
  }

  const allGroupKeys = new Set(
    observations.map((observation) => groupKey(observation.role, observation.era))
  );
  const content: AflTradePlayerBaselineFit['content'] = {
    schemaVersion: 'afl-trade-player-baseline-fit/v1',
    modelKind: 'player_contribution_and_availability',
    observationSetId: set.observationSetId,
    valueUnitId: set.content.valueUnitId,
    config,
    inputObservationIds: observations.map((observation) => observation.observationId),
    replacementLevels,
    scores,
    unscored,
    diagnostics: {
      eligibleTrainingObservations: eligibleTrainingObservations.length,
      supportedRoleEraGroups: replacementLevels.length,
      unsupportedRoleEraGroups: allGroupKeys.size - replacementLevels.length,
      scoredObservations: scores.length,
      unscoredObservations: unscored.length,
    },
  };

  return aflTradePlayerBaselineFitSchema.parse({
    baselineFitId: createAflTradeContentAddress('player-baseline-fit', content),
    content,
  });
}
