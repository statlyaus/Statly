import { z } from 'zod';

import {
  aflTradePickPavDistributionBenchmarkSchema,
  type AflTradePickPavDistributionBenchmark,
} from '../modeling/pickPavDistributionBenchmark';
import {
  aflTradePlayerPavObservationSchema,
  type AflTradePlayerPavObservation,
} from '../modeling/playerPavObservationContracts';

const selectionNumberSchema = z.number().int().positive().max(500);

export interface AflTradePickCalculationEvidence {
  readonly kind: 'pick';
  readonly benchmarkId: string;
  readonly observationSetId: string;
  readonly policyId: string;
  readonly methodId: string;
  readonly valueUnit: 'fixed_horizon_pav';
  readonly selectionNumber: number;
  readonly cohort: Readonly<{
    minimumSelectionNumber: number;
    maximumSelectionNumber: number;
    observationCount: number;
    draftClassCount: number;
    sourceSelectionNumbers: readonly number[];
  }>;
  readonly expected: Readonly<{
    contribution: number;
    games: number;
  }>;
  readonly centralRange: Readonly<{
    contribution: Readonly<{ p10: number; p50: number; p90: number }>;
    games: Readonly<{ p10: number; p50: number; p90: number }>;
  }>;
  readonly outcomeProbabilities: readonly Readonly<{
    category: string;
    probability: number;
  }>[];
  readonly empiricalSupportObservationIds: readonly string[];
  readonly fixedHorizonSeasons: number;
  readonly limitation: string;
}

interface AflTradePlayerCalculationEvidenceBase {
  readonly kind: 'player';
  readonly observationId: string;
  readonly releaseId: string;
  readonly playerId: string;
  readonly acquisitionSpell: AflTradePlayerPavObservation['acquisitionSpell'];
  readonly predictionSeason: number;
  readonly evidenceCutoffAt: string;
  readonly horizon: Readonly<{
    endsAt: string;
    requiredSeasons: readonly number[];
    observedSeasons: readonly number[];
  }>;
}

export type AflTradePlayerCalculationEvidence =
  | (AflTradePlayerCalculationEvidenceBase &
      Readonly<{
        state: 'mature_observed' | 'right_censored';
        seasons: readonly Readonly<{
          seasonYear: number;
          gamesPlayed: number;
          contribution: number;
          contributionPerGame: number | null;
          calculationId: string;
          calculationSha256: string;
          effectiveThrough: string;
          sourceObservationIds: readonly string[];
        }>[];
        totals: Readonly<{
          gamesPlayed: number;
          contribution: number;
          contributionPerGame: number | null;
        }>;
      }>)
  | (AflTradePlayerCalculationEvidenceBase &
      Readonly<{
        state: 'unavailable';
        reason: Extract<
          AflTradePlayerPavObservation['outcome'],
          { state: 'unavailable' }
        >['reason'];
        seasons: readonly [];
        totals: null;
      }>);

function perGame(contribution: number, gamesPlayed: number): number | null {
  return gamesPlayed === 0 ? null : contribution / gamesPlayed;
}

/**
 * Projects season-by-season receiving-club evidence from one exact player observation. Totals are
 * re-derived from its sealed season values; unavailable observations never acquire numeric zeros.
 */
export function deriveAflTradePlayerCalculationEvidence(
  unparsedObservation: AflTradePlayerPavObservation
): AflTradePlayerCalculationEvidence {
  const observation = aflTradePlayerPavObservationSchema.parse(unparsedObservation);
  const base: AflTradePlayerCalculationEvidenceBase = {
    kind: 'player',
    observationId: observation.observationId,
    releaseId: observation.releaseId,
    playerId: observation.playerId,
    acquisitionSpell: { ...observation.acquisitionSpell },
    predictionSeason: observation.predictionSeason,
    evidenceCutoffAt: observation.outcomeObservedAt,
    horizon: {
      endsAt: observation.outcomeHorizonEndsAt,
      requiredSeasons: [...observation.targetCalculationSeasons],
      observedSeasons: observation.targetValues.map(({ seasonYear }) => seasonYear),
    },
  };
  if (observation.outcome.state === 'unavailable') {
    return {
      ...base,
      state: 'unavailable',
      reason: observation.outcome.reason,
      seasons: [],
      totals: null,
    };
  }
  const seasons = observation.targetValues.map((value) => ({
    seasonYear: value.seasonYear,
    gamesPlayed: value.gamesPlayed,
    contribution: value.totalPav,
    contributionPerGame: perGame(value.totalPav, value.gamesPlayed),
    calculationId: value.calculationId,
    calculationSha256: value.calculationSha256,
    effectiveThrough: value.effectiveThrough,
    sourceObservationIds: [...value.sourceRowIds],
  }));
  const gamesPlayed = seasons.reduce((sum, season) => sum + season.gamesPlayed, 0);
  const contribution = seasons.reduce((sum, season) => sum + season.contribution, 0);
  return {
    ...base,
    state: observation.outcome.state,
    seasons,
    totals: {
      gamesPlayed,
      contribution,
      contributionPerGame: perGame(contribution, gamesPlayed),
    },
  };
}

/**
 * Projects the exact empirical support behind one pick estimate. The supplied benchmark is parsed
 * and content-address authenticated before any reader-facing evidence is returned.
 */
export function deriveAflTradePickCalculationEvidence(
  unparsedBenchmark: AflTradePickPavDistributionBenchmark,
  unparsedSelectionNumber: number
): AflTradePickCalculationEvidence {
  const benchmark = aflTradePickPavDistributionBenchmarkSchema.parse(unparsedBenchmark);
  const selectionNumber = selectionNumberSchema.parse(unparsedSelectionNumber);
  const curvePoint = benchmark.content.selectionCurve.find(
    (candidate) => candidate.selectionNumber === selectionNumber
  );
  if (curvePoint === undefined) {
    throw new RangeError(
      `Pick ${selectionNumber} is outside the authenticated pick-model support.`
    );
  }
  const block = benchmark.content.distributionBlocks[curvePoint.distributionBlockIndex];
  if (block === undefined) {
    throw new TypeError('The authenticated pick curve does not resolve to its empirical cohort.');
  }
  const distribution = block.distribution;
  return {
    kind: 'pick',
    benchmarkId: benchmark.benchmarkId,
    observationSetId: benchmark.content.observationSetId,
    policyId: benchmark.content.policyId,
    methodId: benchmark.content.methodId,
    valueUnit: benchmark.content.valueUnit,
    selectionNumber,
    cohort: {
      minimumSelectionNumber: block.minimumSelectionNumber,
      maximumSelectionNumber: block.maximumSelectionNumber,
      observationCount: block.observationCount,
      draftClassCount: block.draftClassCount,
      sourceSelectionNumbers: [...block.sourceSelectionNumbers],
    },
    expected: {
      contribution: distribution.expectedContribution,
      games: distribution.expectedGames,
    },
    centralRange: {
      contribution: {
        p10: distribution.p10Contribution,
        p50: distribution.p50Contribution,
        p90: distribution.p90Contribution,
      },
      games: {
        p10: distribution.p10Games,
        p50: distribution.p50Games,
        p90: distribution.p90Games,
      },
    },
    outcomeProbabilities: distribution.outcomeProbabilities.map((outcome) => ({ ...outcome })),
    empiricalSupportObservationIds: block.empiricalSupport.map(
      ({ observationId }) => observationId
    ),
    fixedHorizonSeasons: benchmark.content.fixedHorizonSeasons,
    limitation: benchmark.content.limitations[0],
  };
}
