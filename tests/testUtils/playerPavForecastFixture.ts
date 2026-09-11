import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradePlayerPavObservation,
  createAflTradePlayerPavObservationSet,
  createAflTradePlayerPavPolicy,
  type AflTradePlayerPavObservation,
} from '@/server/aflTradeIntelligence/modeling/playerPavObservationContracts';

const digest = (value: string) => value.repeat(64);
const releaseId = `outcome-release:${digest('d')}`;
const methodId = `hpn-pav-method:${digest('a')}`;

export const playerPavForecastConfiguration = {
  schemaVersion: 'player-pav-forecast-comparison/v1' as const,
  horizonSeasons: 3 as const,
  featureHistories: [1, 2, 3],
  ridgePenalties: [1, 10],
  shrinkagePseudoSeasons: [1, 3],
  minimumTrainingObservations: 2,
  minimumTuningOrigins: 2,
  minimumCalibrationObservations: 2,
  intervalCoverage: 0.8,
  knowledgePolicy: 'calculated_by_origin' as const,
};

export function playerPavForecastFixture(
  transform: (row: AflTradePlayerPavObservation) => AflTradePlayerPavObservation = (row) => row
) {
  const policy = createAflTradePlayerPavPolicy({
    schemaVersion: 'afl-trade-player-pav-policy/v1',
    authorityBoundary:
      'private_released_acquisition_spell_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    policyVersion: 'pav-forecast-fixture-v1',
    featureHistorySeasons: 3,
    fixedHorizonSeasons: 3,
    methodId,
    sourceValueUnit: 'season_pav',
    outcomeValueUnit: 'fixed_horizon_pav',
    partitions: [
      { role: 'train', fromPredictionSeason: 2001, throughPredictionSeason: 2009 },
      { role: 'calibration', fromPredictionSeason: 2013, throughPredictionSeason: 2013 },
      { role: 'validation', fromPredictionSeason: 2017, throughPredictionSeason: 2017 },
      { role: 'final_test', fromPredictionSeason: 2021, throughPredictionSeason: 2021 },
    ],
    approvalDecision: { id: `review-decision:${digest('b')}`, sha256: digest('b') },
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  const origins = [2001, 2005, 2009, 2013, 2017, 2021];
  const observations = origins.flatMap((predictionSeason, originIndex) =>
    [2, 6].map((priorPav, playerIndex) => {
      const ordinal = originIndex * 2 + playerIndex + 1;
      const playerId = `afl-player:fixture-${predictionSeason}-${playerIndex}`;
      const spellVersionId = createAflTradeContentAddress('acquisition-spell-version', {
        playerId,
      });
      const value = (seasonYear: number, pav: number) => {
        const calculationId = createAflTradeContentAddress('hpn-pav-season', { seasonYear });
        return {
          calculationId,
          calculationSha256: calculationId.split(':')[1]!,
          seasonYear,
          effectiveThrough: `${seasonYear}-09-30T00:00:00.000Z`,
          calculatedAt: `${seasonYear}-10-01T00:00:00.000Z`,
          playerId,
          playerSha256: digest('c'),
          clubId: 'afl-club:fixture',
          spellVersionId,
          sourceRowIds: [`fixture-row:${playerId}:${seasonYear}`],
          gamesPlayed: 1,
          offensivePav: pav,
          midfieldPav: 0,
          defensivePav: 0,
          totalPav: pav,
        };
      };
      const featureCalculationSeasons = [
        predictionSeason - 2,
        predictionSeason - 1,
        predictionSeason,
      ];
      const targetCalculationSeasons = [
        predictionSeason + 1,
        predictionSeason + 2,
        predictionSeason + 3,
      ];
      return transform(
        createAflTradePlayerPavObservation({
          ordinal,
          partition:
            originIndex < 3
              ? 'train'
              : originIndex === 3
                ? 'calibration'
                : originIndex === 4
                  ? 'validation'
                  : 'final_test',
          predictionSeason,
          predictionCutoffAt: `${predictionSeason}-12-31T23:59:59.999Z`,
          outcomeHorizonEndsAt: `${predictionSeason + 3}-12-31T23:59:59.999Z`,
          outcomeObservedAt: `${predictionSeason + 3}-12-31T23:59:59.999Z`,
          releaseId,
          playerId,
          acquisitionSpell: {
            spellId: `acquisition-spell:fixture-${ordinal}`,
            spellVersionId,
            clubId: 'afl-club:fixture',
            effectiveFrom: `${predictionSeason - 2}-01-01`,
            effectiveThrough: null,
            recordedAt: `${predictionSeason - 2}-01-01T00:00:00.000Z`,
          },
          featureCalculationSeasons,
          featureValues: featureCalculationSeasons.map((season) => value(season, priorPav)),
          targetCalculationSeasons,
          targetValues: targetCalculationSeasons.map((season) => value(season, 4)),
          outcome: {
            state: 'mature_observed',
            contribution: 12,
            gamesPlayed: 3,
            seasonsObserved: 3,
          },
        })
      );
    })
  );
  const calculations = new Map(
    observations
      .flatMap((row) => [...row.featureValues, ...row.targetValues])
      .map((value) => [
        value.calculationId,
        {
          calculationId: value.calculationId,
          calculationSha256: value.calculationSha256,
          inputSetId: createAflTradeContentAddress('hpn-pav-input-set', {
            seasonYear: value.seasonYear,
          }),
          methodId,
          seasonYear: value.seasonYear,
          effectiveThrough: value.effectiveThrough,
          calculatedAt: value.calculatedAt,
        },
      ])
  );
  return createAflTradePlayerPavObservationSet({
    schemaVersion: 'afl-trade-player-pav-observation-set/v1',
    authorityBoundary: policy.content.authorityBoundary,
    publicationEligible: false,
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-09-01T00:00:00.000Z',
    knowledgeCutoffAt: '2026-09-01T00:00:00.000Z',
    releaseId,
    policy,
    calculations: [...calculations.values()],
    observations,
    observationCount: observations.length,
    observationSetSha256: digest('0'),
  });
}
