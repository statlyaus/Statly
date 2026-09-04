import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradePlayerBaselineFitSchema,
  aflTradePlayerObservationSetSchema,
  type AflTradePlayerBaselineFit,
  type AflTradePlayerObservationSet,
} from './playerContributionContracts';
import { fitAflTradePlayerContributionBaseline } from './playerContributionBaseline';

const evaluationPartitionSchema = z.enum(['validation', 'final_test']);
const finiteNumberSchema = z.number().finite();
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

const playerPredictionSchema = z
  .object({
    observationId: publicIdSchema,
    partition: evaluationPartitionSchema,
    featureCutoffAt: z.iso.datetime({ offset: true }),
    candidatePredictedContributionAboveReplacement: finiteNumberSchema,
    gamesOnlyPredictedContributionAboveReplacement: finiteNumberSchema,
  })
  .strict();

export const aflTradePlayerPredictionSetContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-prediction-set/v1'),
    publicIdentityBoundary: z.literal('source_native_no_fantasy_ownership'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    baselineFitId: aflTradeContentAddressedIdSchema('player-baseline-fit'),
    valueUnitId: publicIdSchema,
    evaluatedPartition: evaluationPartitionSchema,
    candidateModelId: publicIdSchema,
    candidateSelectionPartitions: z.array(z.enum(['train', 'calibration', 'validation'])),
    finalTestRetuning: z.literal('prohibited'),
    featurePolicy: z.enum([
      'point_in_time_as_known_at_feature_cutoff',
      'retrospective_as_captured_at_dataset_creation',
    ]),
    gamesOnlyComparator: z.enum([
      'point_in_time_expected_games_only',
      'retrospective_expected_games_only_as_captured_at_dataset_creation',
    ]),
    predictions: z.array(playerPredictionSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((set, context) => {
    const retrospective = set.featurePolicy === 'retrospective_as_captured_at_dataset_creation';
    if (
      retrospective !==
      (set.gamesOnlyComparator ===
        'retrospective_expected_games_only_as_captured_at_dataset_creation')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['gamesOnlyComparator'],
        message: 'The comparator must use the prediction set feature-knowledge policy.',
      });
    }
    const expectedSelectionPartitions =
      set.evaluatedPartition === 'validation'
        ? ['train', 'calibration']
        : ['train', 'calibration', 'validation'];
    if (
      set.candidateSelectionPartitions.length !== expectedSelectionPartitions.length ||
      expectedSelectionPartitions.some(
        (partition, index) => set.candidateSelectionPartitions[index] !== partition
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidateSelectionPartitions'],
        message: `Candidate selection partitions must be ${expectedSelectionPartitions.join(', ')} for ${set.evaluatedPartition} evaluation.`,
      });
    }
    const observationIds = set.predictions.map((prediction) => prediction.observationId);
    if (new Set(observationIds).size !== observationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['predictions'],
        message: 'Prediction observation identifiers must be unique.',
      });
    }
    if (set.predictions.some((prediction) => prediction.partition !== set.evaluatedPartition)) {
      context.addIssue({
        code: 'custom',
        path: ['predictions'],
        message: 'Every prediction must belong to the evaluated partition.',
      });
    }
  });

export const aflTradePlayerPredictionSetSchema = z
  .object({
    predictionSetId: aflTradeContentAddressedIdSchema('player-prediction-set'),
    content: aflTradePlayerPredictionSetContentSchema,
  })
  .strict()
  .superRefine((set, context) => {
    addAflTradeContentAddressIssue(
      'player-prediction-set',
      set.predictionSetId,
      set.content,
      context,
      ['predictionSetId']
    );
  });

export const aflTradePlayerValidationConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-validation-config/v1'),
    minimumComparableObservations: z.number().int().positive().max(100_000),
    acceptanceRule: z.literal('candidate_improves_both_mae_and_rmse'),
    minimumRelativeMaeImprovement: z.number().finite().gt(0).lte(1),
    minimumRelativeRmseImprovement: z.number().finite().gt(0).lte(1),
    incompletePredictionCoverage: z.literal('fail_closed'),
    governanceEffect: z.literal('evidence_only_no_gate_or_source_approval'),
  })
  .strict();

const metricSummarySchema = z
  .object({
    meanAbsoluteError: z.number().finite().nonnegative(),
    rootMeanSquaredError: z.number().finite().nonnegative(),
    meanError: finiteNumberSchema,
  })
  .strict();

const relativeImprovementSchema = z.number().finite().nullable();

export const aflTradePlayerValidationReportContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-validation-report/v1'),
    publicIdentityBoundary: z.literal('source_native_no_fantasy_ownership'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    baselineFitId: aflTradeContentAddressedIdSchema('player-baseline-fit'),
    predictionSetId: aflTradeContentAddressedIdSchema('player-prediction-set'),
    valueUnitId: publicIdSchema,
    evaluatedPartition: evaluationPartitionSchema,
    candidateModelId: publicIdSchema,
    config: aflTradePlayerValidationConfigSchema,
    comparableObservationIds: z.array(publicIdSchema).min(1).max(100_000),
    excludedObservations: z
      .array(
        z
          .object({
            observationId: publicIdSchema,
            reason: z.enum(['contribution_unavailable', 'zero_games', 'unsupported_role_era']),
          })
          .strict()
      )
      .max(100_000),
    metrics: z
      .object({
        candidate: metricSummarySchema,
        gamesOnly: metricSummarySchema,
        candidateMinusGamesOnly: z
          .object({
            meanAbsoluteError: finiteNumberSchema,
            rootMeanSquaredError: finiteNumberSchema,
          })
          .strict(),
        relativeImprovement: z
          .object({
            meanAbsoluteError: relativeImprovementSchema,
            rootMeanSquaredError: relativeImprovementSchema,
          })
          .strict(),
      })
      .strict(),
    acceptanceOutcome: z.enum([
      'meets_declared_predictive_thresholds',
      'does_not_meet_declared_predictive_thresholds',
    ]),
    evidenceLimitation: z.literal(
      'report_is_reproducible_evidence_not_source_approval_gate_approval_or_production_readiness'
    ),
  })
  .strict()
  .superRefine((report, context) => {
    if (new Set(report.comparableObservationIds).size !== report.comparableObservationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['comparableObservationIds'],
        message: 'Comparable observation identifiers must be unique.',
      });
    }
    const excludedIds = report.excludedObservations.map(({ observationId }) => observationId);
    if (
      new Set(excludedIds).size !== excludedIds.length ||
      excludedIds.some((id) => report.comparableObservationIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['excludedObservations'],
        message: 'Excluded observations must be unique and cannot also be comparable.',
      });
    }
  });

export const aflTradePlayerValidationReportSchema = z
  .object({
    validationReportId: aflTradeContentAddressedIdSchema('player-validation-report'),
    content: aflTradePlayerValidationReportContentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue(
      'player-validation-report',
      report.validationReportId,
      report.content,
      context,
      ['validationReportId']
    );
  });

export type AflTradePlayerPredictionSetContent = z.infer<
  typeof aflTradePlayerPredictionSetContentSchema
>;
export type AflTradePlayerPredictionSet = z.infer<typeof aflTradePlayerPredictionSetSchema>;
export type AflTradePlayerValidationConfig = z.infer<typeof aflTradePlayerValidationConfigSchema>;
export type AflTradePlayerValidationReport = z.infer<typeof aflTradePlayerValidationReportSchema>;

export function createAflTradePlayerPredictionSet(
  unparsedContent: AflTradePlayerPredictionSetContent
): AflTradePlayerPredictionSet {
  const parsed = aflTradePlayerPredictionSetContentSchema.parse(unparsedContent);
  const content = {
    ...parsed,
    predictions: [...parsed.predictions].sort((left, right) =>
      left.observationId.localeCompare(right.observationId)
    ),
  };
  return aflTradePlayerPredictionSetSchema.parse({
    predictionSetId: createAflTradeContentAddress('player-prediction-set', content),
    content,
  });
}

interface Errors {
  absolute: number;
  squared: number;
  signed: number;
}

function summarizeErrors(errors: readonly Errors[]) {
  const count = errors.length;
  return {
    meanAbsoluteError: errors.reduce((total, error) => total + error.absolute, 0) / count,
    rootMeanSquaredError: Math.sqrt(
      errors.reduce((total, error) => total + error.squared, 0) / count
    ),
    meanError: errors.reduce((total, error) => total + error.signed, 0) / count,
  };
}

function relativeImprovement(candidate: number, comparator: number): number | null {
  if (comparator === 0) return candidate === 0 ? 0 : null;
  return (comparator - candidate) / comparator;
}

export function evaluateAflTradePlayerPredictions(
  unparsedObservationSet: AflTradePlayerObservationSet,
  unparsedBaselineFit: AflTradePlayerBaselineFit,
  unparsedPredictionSet: AflTradePlayerPredictionSet,
  unparsedConfig: AflTradePlayerValidationConfig
): AflTradePlayerValidationReport {
  const observationSet = aflTradePlayerObservationSetSchema.parse(unparsedObservationSet);
  const baselineFit = aflTradePlayerBaselineFitSchema.parse(unparsedBaselineFit);
  const predictionSet = aflTradePlayerPredictionSetSchema.parse(unparsedPredictionSet);
  const config = aflTradePlayerValidationConfigSchema.parse(unparsedConfig);
  if (
    baselineFit.content.observationSetId !== observationSet.observationSetId ||
    predictionSet.content.observationSetId !== observationSet.observationSetId ||
    predictionSet.content.baselineFitId !== baselineFit.baselineFitId ||
    predictionSet.content.valueUnitId !== observationSet.content.valueUnitId ||
    baselineFit.content.valueUnitId !== observationSet.content.valueUnitId
  ) {
    throw new RangeError(
      'Validation artifacts must reference the same observation set, fit, and unit.'
    );
  }
  const expectedBaselineFit = fitAflTradePlayerContributionBaseline(
    observationSet,
    baselineFit.content.config
  );
  if (expectedBaselineFit.baselineFitId !== baselineFit.baselineFitId) {
    throw new RangeError(
      'Baseline fit must equal the deterministic fit of its referenced observation set and config.'
    );
  }

  const partition = predictionSet.content.evaluatedPartition;
  const targetObservations = observationSet.content.observations
    .filter((observation) => observation.partition === partition)
    .sort((left, right) => left.observationId.localeCompare(right.observationId));
  const expectedIds = targetObservations.map(({ observationId }) => observationId);
  const predictedIds = predictionSet.content.predictions.map(({ observationId }) => observationId);
  if (
    expectedIds.length !== predictedIds.length ||
    expectedIds.some((id) => !predictedIds.includes(id))
  ) {
    throw new RangeError('Prediction coverage must exactly match the evaluated partition.');
  }
  for (const prediction of predictionSet.content.predictions) {
    const observation = targetObservations.find(
      ({ observationId }) => observationId === prediction.observationId
    )!;
    if (prediction.featureCutoffAt !== observation.predictionCutoffAt) {
      throw new RangeError('Every prediction feature cutoff must equal its observation cutoff.');
    }
  }

  const scores = baselineFit.content.scores
    .filter((score) => score.partition === partition)
    .sort((left, right) => left.observationId.localeCompare(right.observationId));
  if (scores.length < config.minimumComparableObservations) {
    throw new RangeError('Comparable observations do not meet the declared minimum.');
  }
  const candidateErrors: Errors[] = [];
  const gamesOnlyErrors: Errors[] = [];
  for (const score of scores) {
    const prediction = predictionSet.content.predictions.find(
      ({ observationId }) => observationId === score.observationId
    )!;
    const candidateSigned =
      prediction.candidatePredictedContributionAboveReplacement -
      score.observedContributionAboveReplacement;
    const gamesOnlySigned =
      prediction.gamesOnlyPredictedContributionAboveReplacement -
      score.observedContributionAboveReplacement;
    candidateErrors.push({
      absolute: Math.abs(candidateSigned),
      squared: candidateSigned ** 2,
      signed: candidateSigned,
    });
    gamesOnlyErrors.push({
      absolute: Math.abs(gamesOnlySigned),
      squared: gamesOnlySigned ** 2,
      signed: gamesOnlySigned,
    });
  }
  const candidate = summarizeErrors(candidateErrors);
  const gamesOnly = summarizeErrors(gamesOnlyErrors);
  const maeImprovement = relativeImprovement(
    candidate.meanAbsoluteError,
    gamesOnly.meanAbsoluteError
  );
  const rmseImprovement = relativeImprovement(
    candidate.rootMeanSquaredError,
    gamesOnly.rootMeanSquaredError
  );
  const meetsThresholds =
    maeImprovement !== null &&
    rmseImprovement !== null &&
    maeImprovement >= config.minimumRelativeMaeImprovement &&
    rmseImprovement >= config.minimumRelativeRmseImprovement;
  const excludedObservations = baselineFit.content.unscored
    .filter(({ observationId }) => expectedIds.includes(observationId))
    .sort((left, right) => left.observationId.localeCompare(right.observationId));
  const content: AflTradePlayerValidationReport['content'] = {
    schemaVersion: 'afl-trade-player-validation-report/v1',
    publicIdentityBoundary: 'source_native_no_fantasy_ownership',
    observationSetId: observationSet.observationSetId,
    baselineFitId: baselineFit.baselineFitId,
    predictionSetId: predictionSet.predictionSetId,
    valueUnitId: observationSet.content.valueUnitId,
    evaluatedPartition: partition,
    candidateModelId: predictionSet.content.candidateModelId,
    config,
    comparableObservationIds: scores.map(({ observationId }) => observationId),
    excludedObservations,
    metrics: {
      candidate,
      gamesOnly,
      candidateMinusGamesOnly: {
        meanAbsoluteError: candidate.meanAbsoluteError - gamesOnly.meanAbsoluteError,
        rootMeanSquaredError: candidate.rootMeanSquaredError - gamesOnly.rootMeanSquaredError,
      },
      relativeImprovement: {
        meanAbsoluteError: maeImprovement,
        rootMeanSquaredError: rmseImprovement,
      },
    },
    acceptanceOutcome: meetsThresholds
      ? 'meets_declared_predictive_thresholds'
      : 'does_not_meet_declared_predictive_thresholds',
    evidenceLimitation:
      'report_is_reproducible_evidence_not_source_approval_gate_approval_or_production_readiness',
  };
  return aflTradePlayerValidationReportSchema.parse({
    validationReportId: createAflTradeContentAddress('player-validation-report', content),
    content,
  });
}
