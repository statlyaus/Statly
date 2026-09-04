import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { fitAflTradePlayerContributionBaseline } from '@/server/aflTradeIntelligence/modeling/playerContributionBaseline';
import {
  createAflTradePlayerObservationSet,
  type AflTradePlayerBaselineFit,
  type AflTradePlayerBaselineConfig,
  type AflTradePlayerObservationSetContent,
  type AflTradePlayerSeasonObservation,
} from '@/server/aflTradeIntelligence/modeling/playerContributionContracts';
import {
  aflTradePlayerPredictionSetContentSchema,
  aflTradePlayerPredictionSetSchema,
  aflTradePlayerValidationConfigSchema,
  createAflTradePlayerPredictionSet,
  evaluateAflTradePlayerPredictions,
  type AflTradePlayerPredictionSetContent,
  type AflTradePlayerValidationConfig,
} from '@/server/aflTradeIntelligence/modeling/playerContributionValidation';

const partitionYears = {
  train: 2018,
  calibration: 2020,
  validation: 2022,
  final_test: 2024,
} as const;

const baselineConfig: AflTradePlayerBaselineConfig = {
  schemaVersion: 'afl-trade-player-baseline-config/v1',
  replacementQuantile: 0.5,
  minimumGamesForReplacementFit: 1,
  minimumTrainingObservationsPerGroup: 3,
  weighting: 'games_played',
  replacementStratification: 'role_and_era',
  unavailableAndZeroTreatment: 'distinct',
  activeCareerTreatment: 'right_censored',
};

const validationConfig: AflTradePlayerValidationConfig = {
  schemaVersion: 'afl-trade-player-validation-config/v1',
  minimumComparableObservations: 1,
  acceptanceRule: 'candidate_improves_both_mae_and_rmse',
  minimumRelativeMaeImprovement: 0.1,
  minimumRelativeRmseImprovement: 0.1,
  incompletePredictionCoverage: 'fail_closed',
  governanceEffect: 'evidence_only_no_gate_or_source_approval',
};

function observation(
  id: string,
  partition: keyof typeof partitionYears,
  contribution: AflTradePlayerSeasonObservation['contribution'],
  gamesPlayed = 10
): AflTradePlayerSeasonObservation {
  const year = partitionYears[partition];
  const outcomeObservedAt = `${year}-12-31T00:00:00.000Z`;
  return {
    observationId: `fixture-observation-${id}`,
    playerId: `fixture-player-${id}`,
    season: year,
    role: 'midfielder',
    era: 'modern-era',
    partition,
    predictionCutoffAt: `${year}-01-01T00:00:00.000Z`,
    roleKnownAt: `${year - 1}-12-01T00:00:00.000Z`,
    outcomeObservedAt,
    gamesPlayed,
    gamesAvailable: 20,
    contribution,
    career: { state: 'right_censored', censoredAt: outcomeObservedAt },
  };
}

function observationContent(validationTotal = 50): AflTradePlayerObservationSetContent {
  return {
    schemaVersion: 'afl-trade-player-observation-set/v1',
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    valueUnitId: 'fixture-contribution-units',
    observations: [
      observation('train-low', 'train', { state: 'observed', total: 10 }),
      observation('train-mid', 'train', { state: 'observed', total: 30 }),
      observation('train-high', 'train', { state: 'observed', total: 50 }),
      observation('calibration', 'calibration', { state: 'observed', total: 40 }),
      observation('validation-scored', 'validation', {
        state: 'observed',
        total: validationTotal,
      }),
      observation('validation-unavailable', 'validation', {
        state: 'unavailable',
        reason: 'source_missing',
      }),
      observation('final', 'final_test', { state: 'observed', total: 60 }),
    ],
  };
}

function predictionContent(
  observationSetId: string,
  baselineFitId: string,
  candidatePrediction = 19,
  gamesOnlyPrediction = 10
): AflTradePlayerPredictionSetContent {
  return {
    schemaVersion: 'afl-trade-player-prediction-set/v1',
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    observationSetId,
    baselineFitId,
    valueUnitId: 'fixture-contribution-units',
    evaluatedPartition: 'validation',
    candidateModelId: 'fixture-candidate-model-v1',
    candidateSelectionPartitions: ['train', 'calibration'],
    finalTestRetuning: 'prohibited',
    featurePolicy: 'point_in_time_as_known_at_feature_cutoff',
    gamesOnlyComparator: 'point_in_time_expected_games_only',
    predictions: [
      {
        observationId: 'fixture-observation-validation-unavailable',
        partition: 'validation',
        featureCutoffAt: '2022-01-01T00:00:00.000Z',
        candidatePredictedContributionAboveReplacement: 5,
        gamesOnlyPredictedContributionAboveReplacement: 5,
      },
      {
        observationId: 'fixture-observation-validation-scored',
        partition: 'validation',
        featureCutoffAt: '2022-01-01T00:00:00.000Z',
        candidatePredictedContributionAboveReplacement: candidatePrediction,
        gamesOnlyPredictedContributionAboveReplacement: gamesOnlyPrediction,
      },
    ],
  };
}

function fixture() {
  const set = createAflTradePlayerObservationSet(observationContent());
  const fit = fitAflTradePlayerContributionBaseline(set, baselineConfig);
  const predictions = createAflTradePlayerPredictionSet(
    predictionContent(set.observationSetId, fit.baselineFitId)
  );
  return { set, fit, predictions };
}

describe('AFL trade-intelligence player-contribution validation', () => {
  it('produces content-addressed held-out evidence against a games-only comparator', () => {
    const { set, fit, predictions } = fixture();

    const report = evaluateAflTradePlayerPredictions(set, fit, predictions, validationConfig);

    expect(report.validationReportId).toMatch(/^player-validation-report:[a-f0-9]{64}$/);
    expect(report.content.comparableObservationIds).toEqual([
      'fixture-observation-validation-scored',
    ]);
    expect(report.content.excludedObservations).toEqual([
      {
        observationId: 'fixture-observation-validation-unavailable',
        reason: 'contribution_unavailable',
      },
    ]);
    expect(report.content.metrics).toEqual({
      candidate: { meanAbsoluteError: 1, rootMeanSquaredError: 1, meanError: -1 },
      gamesOnly: { meanAbsoluteError: 10, rootMeanSquaredError: 10, meanError: -10 },
      candidateMinusGamesOnly: { meanAbsoluteError: -9, rootMeanSquaredError: -9 },
      relativeImprovement: { meanAbsoluteError: 0.9, rootMeanSquaredError: 0.9 },
    });
    expect(report.content.acceptanceOutcome).toBe('meets_declared_predictive_thresholds');
    expect(report.content.config.governanceEffect).toBe('evidence_only_no_gate_or_source_approval');
  });

  it('records an adverse comparison without converting it into an approval', () => {
    const { set, fit } = fixture();
    const predictions = createAflTradePlayerPredictionSet(
      predictionContent(set.observationSetId, fit.baselineFitId, 40, 19)
    );

    const report = evaluateAflTradePlayerPredictions(set, fit, predictions, validationConfig);

    expect(report.content.metrics.candidate.meanAbsoluteError).toBe(20);
    expect(report.content.metrics.gamesOnly.meanAbsoluteError).toBe(1);
    expect(report.content.acceptanceOutcome).toBe('does_not_meet_declared_predictive_thresholds');
    expect(report.content.evidenceLimitation).toContain('not_source_approval');
  });

  it('requires the comparator label to preserve retrospective knowledge semantics', () => {
    const { set, fit } = fixture();
    const pointInTime = predictionContent(set.observationSetId, fit.baselineFitId);
    expect(
      aflTradePlayerPredictionSetContentSchema.safeParse({
        ...pointInTime,
        featurePolicy: 'retrospective_as_captured_at_dataset_creation',
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerPredictionSetContentSchema.safeParse({
        ...pointInTime,
        featurePolicy: 'retrospective_as_captured_at_dataset_creation',
        gamesOnlyComparator: 'retrospective_expected_games_only_as_captured_at_dataset_creation',
      }).success
    ).toBe(true);
  });

  it('seals final-test candidate selection to train, calibration, and validation partitions', () => {
    const { set, fit } = fixture();
    const base = predictionContent(set.observationSetId, fit.baselineFitId);

    expect(
      aflTradePlayerPredictionSetContentSchema.safeParse({
        ...base,
        evaluatedPartition: 'final_test',
        predictions: base.predictions.map((prediction) => ({
          ...prediction,
          observationId: 'fixture-observation-final',
          partition: 'final_test',
          featureCutoffAt: '2024-01-01T00:00:00.000Z',
        })),
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerPredictionSetContentSchema.safeParse({
        ...base,
        evaluatedPartition: 'final_test',
        candidateSelectionPartitions: ['train', 'calibration', 'validation'],
        predictions: [
          {
            ...base.predictions[0],
            observationId: 'fixture-observation-final',
            partition: 'final_test',
            featureCutoffAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      }).success
    ).toBe(true);
  });

  it('fails closed on incomplete coverage and mismatched point-in-time cutoffs', () => {
    const { set, fit } = fixture();
    const base = predictionContent(set.observationSetId, fit.baselineFitId);
    const incomplete = createAflTradePlayerPredictionSet({
      ...base,
      predictions: [base.predictions[0]],
    });
    const wrongCutoff = createAflTradePlayerPredictionSet({
      ...base,
      predictions: base.predictions.map((prediction) => ({
        ...prediction,
        featureCutoffAt:
          prediction.observationId === 'fixture-observation-validation-scored'
            ? '2022-02-01T00:00:00.000Z'
            : prediction.featureCutoffAt,
      })),
    });

    expect(() => evaluateAflTradePlayerPredictions(set, fit, incomplete, validationConfig)).toThrow(
      /coverage/i
    );
    expect(() =>
      evaluateAflTradePlayerPredictions(set, fit, wrongCutoff, validationConfig)
    ).toThrow(/cutoff/i);
  });

  it('rejects cross-artifact lineage and insufficient comparable evidence', () => {
    const { fit, predictions } = fixture();
    const differentSet = createAflTradePlayerObservationSet(observationContent(500));

    expect(() =>
      evaluateAflTradePlayerPredictions(differentSet, fit, predictions, validationConfig)
    ).toThrow(/same observation set/i);
    const { set } = fixture();
    expect(() =>
      evaluateAflTradePlayerPredictions(set, fit, predictions, {
        ...validationConfig,
        minimumComparableObservations: 2,
      })
    ).toThrow(/declared minimum/i);
  });

  it('rejects a content-addressed fit that was not produced by the deterministic fitter', () => {
    const { set, fit } = fixture();
    const removedObservationId = 'fixture-observation-validation-scored';
    const forgedContent: AflTradePlayerBaselineFit['content'] = {
      ...fit.content,
      scores: fit.content.scores.filter(
        ({ observationId }) => observationId !== removedObservationId
      ),
      unscored: [
        ...fit.content.unscored,
        { observationId: removedObservationId, reason: 'contribution_unavailable' as const },
      ].sort((left, right) => left.observationId.localeCompare(right.observationId)),
      diagnostics: {
        ...fit.content.diagnostics,
        scoredObservations: fit.content.diagnostics.scoredObservations - 1,
        unscoredObservations: fit.content.diagnostics.unscoredObservations + 1,
      },
    };
    const forgedFit: AflTradePlayerBaselineFit = {
      baselineFitId: createAflTradeContentAddress('player-baseline-fit', forgedContent),
      content: forgedContent,
    };
    const predictions = createAflTradePlayerPredictionSet(
      predictionContent(set.observationSetId, forgedFit.baselineFitId)
    );

    expect(() =>
      evaluateAflTradePlayerPredictions(set, forgedFit, predictions, validationConfig)
    ).toThrow(/deterministic fit/i);
  });

  it('rejects fantasy ownership fields and content-address mutation', () => {
    const { set, fit, predictions } = fixture();
    const content = predictionContent(set.observationSetId, fit.baselineFitId);

    expect(
      aflTradePlayerPredictionSetContentSchema.safeParse({
        ...content,
        fantasyLeagueId: 'fixture-league',
        userId: 'fixture-user',
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerPredictionSetSchema.safeParse({
        ...predictions,
        content: { ...predictions.content, candidateModelId: 'mutated-model' },
      }).success
    ).toBe(false);
    expect(
      aflTradePlayerValidationConfigSchema.safeParse({
        ...validationConfig,
        minimumRelativeMaeImprovement: 0,
      }).success
    ).toBe(false);
  });
});
