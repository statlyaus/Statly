import {
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
  type AflTradePlayerPavObservation,
  type AflTradePlayerPavObservationSet,
  type AflTradePlayerPavPolicy,
} from './playerPavObservationContracts';

type AcquisitionSpell = AflTradePlayerPavObservation['acquisitionSpell'];
type CalculationMembership = AflTradePlayerPavObservationSet['content']['calculations'][number];
type PlayerValue = AflTradePlayerPavObservation['featureValues'][number];

export interface AflTradePlayerPavCalculationEvidence {
  readonly calculation: CalculationMembership;
  readonly playerValues: readonly PlayerValue[];
}

export interface AflTradeReleasedPlayerSpellPrediction {
  readonly releaseId: string;
  readonly partition: AflTradePlayerPavObservation['partition'];
  readonly predictionSeason: number;
  readonly playerId: string;
  readonly acquisitionSpell: AcquisitionSpell;
}

export interface AflTradePlayerPavMaterializationRequest {
  readonly environment: 'test_fixture' | 'non_production' | 'production';
  readonly competition: 'AFLM';
  readonly createdAt: string;
  readonly knowledgeCutoffAt: string;
  readonly releaseId: string;
  readonly policy: AflTradePlayerPavPolicy;
  readonly predictions: readonly AflTradeReleasedPlayerSpellPrediction[];
  readonly calculations: readonly AflTradePlayerPavCalculationEvidence[];
}

function partitionFor(
  policy: AflTradePlayerPavPolicy,
  predictionSeason: number
): AflTradePlayerPavObservation['partition'] {
  const partition = policy.content.partitions.find(
    ({ fromPredictionSeason, throughPredictionSeason }) =>
      predictionSeason >= fromPredictionSeason && predictionSeason <= throughPredictionSeason
  );
  if (!partition) {
    throw new RangeError(`Prediction season ${predictionSeason} is outside the reviewed policy.`);
  }
  return partition.role;
}

function seasonEnd(seasonYear: number): string {
  return `${seasonYear}-12-31T23:59:59.999Z`;
}

function spellEndSeason(spell: AcquisitionSpell): number | null {
  return spell.effectiveThrough === null ? null : Number(spell.effectiveThrough.slice(0, 4));
}

function assertRequest(request: AflTradePlayerPavMaterializationRequest): void {
  if (
    request.environment !== request.policy.content.environment ||
    request.competition !== request.policy.content.competition ||
    Date.parse(request.policy.content.createdAt) > Date.parse(request.createdAt) ||
    Date.parse(request.knowledgeCutoffAt) > Date.parse(request.createdAt)
  ) {
    throw new TypeError('Player-PAV materialization scope or chronology is invalid.');
  }

  const predictionKeys = request.predictions.map(
    ({ predictionSeason, playerId, acquisitionSpell }) =>
      `${predictionSeason}|${playerId}|${acquisitionSpell.spellVersionId}`
  );
  if (
    request.predictions.length < 4 ||
    new Set(predictionKeys).size !== predictionKeys.length ||
    request.predictions.some(
      ({ releaseId, partition, predictionSeason, acquisitionSpell }) =>
        releaseId !== request.releaseId ||
        partition !== partitionFor(request.policy, predictionSeason) ||
        Date.parse(acquisitionSpell.recordedAt) > Date.parse(seasonEnd(predictionSeason)) ||
        Date.parse(acquisitionSpell.effectiveFrom) > Date.parse(`${predictionSeason}-12-31`) ||
        (acquisitionSpell.effectiveThrough !== null &&
          Date.parse(acquisitionSpell.effectiveThrough) < Date.parse(`${predictionSeason}-12-31`))
    )
  ) {
    throw new TypeError(
      'Released acquisition-spell release membership is incomplete, duplicated, mixed, or out of scope.'
    );
  }

  const calculationIds = request.calculations.map(({ calculation }) => calculation.calculationId);
  const calculationSeasons = request.calculations.map(({ calculation }) => calculation.seasonYear);
  if (
    new Set(calculationIds).size !== calculationIds.length ||
    new Set(calculationSeasons).size !== calculationSeasons.length ||
    request.calculations.some(({ calculation, playerValues }) => {
      const playerValueKeys = playerValues.map(
        ({ playerId, spellVersionId }) => `${playerId}|${spellVersionId}`
      );
      return (
        calculation.methodId !== request.policy.content.methodId ||
        Date.parse(calculation.calculatedAt) > Date.parse(request.createdAt) ||
        new Set(playerValueKeys).size !== playerValueKeys.length ||
        playerValues.some(
          (value) =>
            value.calculationId !== calculation.calculationId ||
            value.calculationSha256 !== calculation.calculationSha256 ||
            value.seasonYear !== calculation.seasonYear ||
            value.effectiveThrough !== calculation.effectiveThrough ||
            value.calculatedAt !== calculation.calculatedAt
        )
      );
    })
  ) {
    throw new TypeError(
      'Finalized player-PAV calculation evidence is duplicated or internally mixed.'
    );
  }
}

function valuesForPlayer(
  evidence: AflTradePlayerPavCalculationEvidence | undefined,
  playerId: string
): PlayerValue[] {
  if (!evidence) return [];
  return evidence.playerValues
    .filter((value) => value.playerId === playerId)
    .sort(
      (left, right) =>
        left.seasonYear - right.seasonYear ||
        left.spellVersionId.localeCompare(right.spellVersionId)
    );
}

export function materializeAflTradePlayerPavObservationSet(
  request: AflTradePlayerPavMaterializationRequest
): AflTradePlayerPavObservationSet {
  assertRequest(request);
  const calculationsBySeason = new Map(
    request.calculations.map((evidence) => [evidence.calculation.seasonYear, evidence])
  );
  const observations = [...request.predictions]
    .sort(
      (left, right) =>
        left.predictionSeason - right.predictionSeason ||
        left.playerId.localeCompare(right.playerId) ||
        left.acquisitionSpell.spellVersionId.localeCompare(right.acquisitionSpell.spellVersionId)
    )
    .map((prediction, index) => {
      const featureCalculationSeasons = Array.from(
        { length: request.policy.content.featureHistorySeasons },
        (_, offset) =>
          prediction.predictionSeason - request.policy.content.featureHistorySeasons + 1 + offset
      );
      const targetCalculationSeasons = Array.from(
        { length: request.policy.content.fixedHorizonSeasons },
        (_, offset) => prediction.predictionSeason + 1 + offset
      );
      const predictionCutoffAt = seasonEnd(prediction.predictionSeason);
      const outcomeHorizonEndsAt = seasonEnd(targetCalculationSeasons.at(-1)!);
      const featureValues = featureCalculationSeasons.flatMap((seasonYear) =>
        valuesForPlayer(calculationsBySeason.get(seasonYear), prediction.playerId).filter(
          (value) =>
            Date.parse(value.effectiveThrough) <= Date.parse(predictionCutoffAt) &&
            Date.parse(value.calculatedAt) <= Date.parse(request.knowledgeCutoffAt)
        )
      );
      const coveredFeatureSeasons = new Set(featureValues.map(({ seasonYear }) => seasonYear));
      const featureCoverageComplete = featureCalculationSeasons.every((seasonYear) =>
        coveredFeatureSeasons.has(seasonYear)
      );
      const endSeason = spellEndSeason(prediction.acquisitionSpell);
      const measuredTargetSeasons = targetCalculationSeasons.filter(
        (seasonYear) => endSeason === null || seasonYear <= endSeason
      );
      const targetValues = measuredTargetSeasons.flatMap((seasonYear) =>
        valuesForPlayer(calculationsBySeason.get(seasonYear), prediction.playerId).filter(
          (value) =>
            value.spellVersionId === prediction.acquisitionSpell.spellVersionId &&
            value.clubId === prediction.acquisitionSpell.clubId &&
            Date.parse(value.calculatedAt) <= Date.parse(request.knowledgeCutoffAt)
        )
      );
      const coveredTargetSeasons = new Set(targetValues.map(({ seasonYear }) => seasonYear));
      const targetCoverageComplete = measuredTargetSeasons.every((seasonYear) =>
        coveredTargetSeasons.has(seasonYear)
      );
      const targetContribution = targetValues.reduce((sum, value) => sum + value.totalPav, 0);
      const targetGames = targetValues.reduce((sum, value) => sum + value.gamesPlayed, 0);
      const horizonMature =
        Date.parse(outcomeHorizonEndsAt) <= Date.parse(request.knowledgeCutoffAt);

      let includedTargetValues = targetValues;
      let outcomeObservedAt = request.knowledgeCutoffAt;
      let outcome: AflTradePlayerPavObservation['outcome'];
      if (!featureCoverageComplete) {
        includedTargetValues = [];
        outcome = { state: 'unavailable', reason: 'feature_history_incomplete' };
      } else if (horizonMature && targetCoverageComplete) {
        outcomeObservedAt = outcomeHorizonEndsAt;
        outcome = {
          state: 'mature_observed',
          contribution: targetContribution,
          gamesPlayed: targetGames,
          seasonsObserved: targetCalculationSeasons.length,
        };
      } else if (!horizonMature && targetValues.length > 0) {
        outcome = {
          state: 'right_censored',
          contributionObservedToDate: targetContribution,
          gamesObservedToDate: targetGames,
          seasonsObserved: targetValues.length,
          censoredAt: request.knowledgeCutoffAt,
        };
      } else {
        includedTargetValues = [];
        outcome = { state: 'unavailable', reason: 'horizon_calculation_missing' };
      }

      return createAflTradePlayerPavObservation({
        ordinal: index + 1,
        partition: prediction.partition,
        predictionSeason: prediction.predictionSeason,
        predictionCutoffAt,
        outcomeHorizonEndsAt,
        outcomeObservedAt,
        releaseId: prediction.releaseId,
        playerId: prediction.playerId,
        acquisitionSpell: prediction.acquisitionSpell,
        featureCalculationSeasons,
        featureValues,
        targetCalculationSeasons,
        targetValues: includedTargetValues,
        outcome,
      });
    });

  const referencedCalculationIds = new Set(
    observations.flatMap((observation) =>
      [...observation.featureValues, ...observation.targetValues].map(
        ({ calculationId }) => calculationId
      )
    )
  );
  const calculations = request.calculations
    .map(({ calculation }) => calculation)
    .filter(({ calculationId }) => referencedCalculationIds.has(calculationId));

  return createAflTradePlayerPavObservationSet({
    schemaVersion: 'afl-trade-player-pav-observation-set/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: request.environment,
    competition: request.competition,
    createdAt: request.createdAt,
    knowledgeCutoffAt: request.knowledgeCutoffAt,
    releaseId: request.releaseId,
    policy: request.policy,
    calculations,
    observations,
    observationCount: observations.length,
    observationSetSha256: '0'.repeat(64),
  });
}
