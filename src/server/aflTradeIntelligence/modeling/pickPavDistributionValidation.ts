import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  aflTradePickPavObservationSetSchema,
  type AflTradePickPavObservation,
  type AflTradePickPavObservationSet,
} from './pickOutcomeContracts';
import {
  aflTradePickPavDistributionBenchmarkSchema,
  fitAflTradePickPavDistributionBenchmark,
  type AflTradePickPavDistributionBenchmark,
} from './pickPavDistributionBenchmark';

export const AFL_TRADE_PICK_PAV_VALIDATION_REPORT_SCHEMA_VERSION =
  'afl-trade-pick-pav-validation-report/v1' as const;
export const AFL_TRADE_PICK_PAV_VALIDATION_AUTHORITY_BOUNDARY =
  'private_temporal_pick_pav_benchmark_evaluation_not_model_approval_grade_publication_or_fantasy_ownership' as const;

const finite = z.number().finite();
const probability = finite.min(0).max(1);
const isoInstant = z.iso.datetime({ offset: true });
const FLOAT_TOLERANCE = 1e-10;
const EVALUATION_SCOPES = ['all_held_out', 'calibration', 'validation', 'final_test'] as const;
const HELD_OUT_PARTITIONS = ['calibration', 'validation', 'final_test'] as const;

export const AFL_TRADE_PICK_PAV_VALIDATION_EXCLUSION_REASONS = [
  'training_partition',
  'right_censored',
  'outcome_unavailable',
  'non_national_pathway',
  'selection_access_not_open',
  'outside_training_domain',
] as const;

export const aflTradePickPavValidationConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-pav-validation-config/v1'),
    evaluatedAt: isoInstant,
    minimumEligibleObservations: z.number().int().positive().max(100_000),
    minimumPartitionObservations: z.number().int().positive().max(100_000),
    nominalIntervalCoverage: z.literal(0.8),
  })
  .strict();

const supportSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('pick-pav-observation'),
    contribution: finite,
    gamesPlayed: z.number().int().nonnegative().max(500),
  })
  .strict();

const categoryProbabilitySchema = z
  .object({
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    probability,
  })
  .strict();

const predictionSchema = z
  .object({
    observationId: aflTradeContentAddressedIdSchema('pick-pav-observation'),
    partition: z.enum(HELD_OUT_PARTITIONS),
    draftYear: z.number().int().min(1897).max(2200),
    actualSelectionNumber: z.number().int().positive().max(500),
    outcomeObservedAt: isoInstant,
    distributionBlockIndex: z.number().int().nonnegative(),
    supportObservationCount: z.number().int().positive().max(100_000),
    empiricalSupport: z.array(supportSchema).min(1).max(100_000),
    predictedExpectedContribution: finite,
    p10Contribution: finite,
    p50Contribution: finite,
    p90Contribution: finite,
    predictedExpectedGames: finite.nonnegative(),
    p10Games: z.number().int().nonnegative(),
    p50Games: z.number().int().nonnegative(),
    p90Games: z.number().int().nonnegative(),
    categoryProbabilities: z
      .array(categoryProbabilitySchema)
      .length(AFL_TRADE_PICK_OUTCOME_CATEGORIES.length),
    observedContribution: finite,
    observedGames: z.number().int().nonnegative().max(500),
    observedCategory: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
  })
  .strict()
  .superRefine((prediction, context) => {
    const support = [...prediction.empiricalSupport].sort((left, right) =>
      left.observationId.localeCompare(right.observationId)
    );
    const categoryTotal = prediction.categoryProbabilities.reduce(
      (sum, entry) => sum + entry.probability,
      0
    );
    if (
      prediction.supportObservationCount !== support.length ||
      new Set(support.map(({ observationId }) => observationId)).size !== support.length ||
      support.some((entry, index) => entry !== prediction.empiricalSupport[index]) ||
      prediction.categoryProbabilities.some(
        ({ category }, index) => category !== AFL_TRADE_PICK_OUTCOME_CATEGORIES[index]
      ) ||
      Math.abs(categoryTotal - 1) > FLOAT_TOLERANCE ||
      prediction.p10Contribution > prediction.p50Contribution ||
      prediction.p50Contribution > prediction.p90Contribution ||
      prediction.p10Games > prediction.p50Games ||
      prediction.p50Games > prediction.p90Games
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Held-out prediction support and probability mass must be exact and canonical.',
      });
    }
  });

const metricsSchema = z
  .object({
    multiclassBrierScore: finite.nonnegative(),
    multiclassLogLoss: finite.nonnegative().nullable(),
    rankedProbabilityScore: finite.nonnegative(),
    contributionCrps: finite.nonnegative(),
    meanAbsoluteContributionError: finite.nonnegative(),
    rootMeanSquaredContributionError: finite.nonnegative(),
    meanAbsoluteGamesError: finite.nonnegative(),
    rootMeanSquaredGamesError: finite.nonnegative(),
    empiricalP10P90Coverage: probability,
    meanEmpiricalIntervalWidth: finite.nonnegative(),
    zeroProbabilityObservationCount: z.number().int().nonnegative(),
  })
  .strict();

const scoreScopeSchema = z
  .object({
    scope: z.enum(EVALUATION_SCOPES),
    observationCount: z.number().int().nonnegative().max(100_000),
    observationIds: z.array(aflTradeContentAddressedIdSchema('pick-pav-observation')).max(100_000),
    metrics: metricsSchema.nullable(),
  })
  .strict();

const reportContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PICK_PAV_VALIDATION_REPORT_SCHEMA_VERSION),
    authorityBoundary: z.literal(AFL_TRADE_PICK_PAV_VALIDATION_AUTHORITY_BOUNDARY),
    publicationEligible: z.literal(false),
    approvalStatus: z.literal('not_assessed_by_validation_harness'),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    observationSetId: aflTradeContentAddressedIdSchema('pick-pav-observation-set'),
    benchmarkId: aflTradeContentAddressedIdSchema('pick-pav-benchmark'),
    releaseId: aflTradeContentAddressedIdSchema('outcome-release'),
    policyId: aflTradeContentAddressedIdSchema('pick-pav-policy'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    valueUnit: z.literal('fixed_horizon_pav'),
    fixedHorizonSeasons: z.number().int().positive().max(15),
    config: aflTradePickPavValidationConfigSchema,
    evaluationStatus: z.enum([
      'scored_not_approved',
      'insufficient_eligible_observations_not_approved',
      'invalid_zero_probability_not_approved',
    ]),
    inputObservationCount: z.number().int().positive().max(100_000),
    predictions: z.array(predictionSchema).max(100_000),
    excludedObservations: z
      .array(
        z
          .object({
            observationId: aflTradeContentAddressedIdSchema('pick-pav-observation'),
            reason: z.enum(AFL_TRADE_PICK_PAV_VALIDATION_EXCLUSION_REASONS),
          })
          .strict()
      )
      .max(100_000),
    scoreScopes: z.array(scoreScopeSchema).length(EVALUATION_SCOPES.length),
    limitation: z.literal(
      'Validation evidence is not Gate approval, deployment approval, a grade, or public numerical authority.'
    ),
  })
  .strict()
  .superRefine((report, context) => {
    const predictionIds = report.predictions.map(({ observationId }) => observationId);
    const excludedIds = report.excludedObservations.map(({ observationId }) => observationId);
    const allIds = [...predictionIds, ...excludedIds];
    if (
      new Set(allIds).size !== allIds.length ||
      allIds.length !== report.inputObservationCount ||
      !orderedPredictions(report.predictions) ||
      report.excludedObservations.some(
        (entry, index) =>
          index > 0 &&
          entry.observationId.localeCompare(report.excludedObservations[index - 1]!.observationId) <
            0
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['predictions'],
        message: 'Validation predictions and exclusions must partition the input exactly.',
      });
    }
    const expectedScopes = createScoreScopes(report.predictions);
    if (
      report.scoreScopes.some(
        (scope, index) =>
          scope.scope !== EVALUATION_SCOPES[index] ||
          JSON.stringify(scope) !== JSON.stringify(expectedScopes[index])
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['scoreScopes'],
        message: 'Validation metrics must exactly match the canonical held-out predictions.',
      });
    }
  });

export const aflTradePickPavValidationReportSchema = z
  .object({
    validationReportId: aflTradeContentAddressedIdSchema('pick-pav-validation-report'),
    content: reportContentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-validation-report',
      report.validationReportId,
      report.content,
      context,
      ['validationReportId']
    );
  });

export type AflTradePickPavValidationConfig = z.infer<typeof aflTradePickPavValidationConfigSchema>;
export type AflTradePickPavValidationReport = z.infer<typeof aflTradePickPavValidationReportSchema>;
type Prediction = z.infer<typeof predictionSchema>;
type Metrics = z.infer<typeof metricsSchema>;

function partitionRank(partition: Prediction['partition']): number {
  return HELD_OUT_PARTITIONS.indexOf(partition);
}

function orderedPredictions(predictions: readonly Prediction[]): boolean {
  return predictions.every((prediction, index) => {
    if (index === 0) return true;
    const previous = predictions[index - 1]!;
    return (
      partitionRank(previous.partition) < partitionRank(prediction.partition) ||
      (previous.partition === prediction.partition &&
        previous.observationId.localeCompare(prediction.observationId) < 0)
    );
  });
}

function rankedProbabilityScore(prediction: Prediction): number {
  const observedIndex = AFL_TRADE_PICK_OUTCOME_CATEGORIES.indexOf(prediction.observedCategory);
  let predictedCumulative = 0;
  let score = 0;
  for (let index = 0; index < AFL_TRADE_PICK_OUTCOME_CATEGORIES.length - 1; index += 1) {
    predictedCumulative += prediction.categoryProbabilities[index]!.probability;
    score += (predictedCumulative - (observedIndex <= index ? 1 : 0)) ** 2;
  }
  return score / (AFL_TRADE_PICK_OUTCOME_CATEGORIES.length - 1);
}

function empiricalCrps(prediction: Prediction): number {
  const support = prediction.empiricalSupport.map(({ contribution }) => contribution);
  const first =
    support.reduce((sum, value) => sum + Math.abs(value - prediction.observedContribution), 0) /
    support.length;
  let pairwise = 0;
  for (const left of support) for (const right of support) pairwise += Math.abs(left - right);
  return first - pairwise / (2 * support.length ** 2);
}

function computeMetrics(predictions: readonly Prediction[]): Metrics {
  let brier = 0;
  let logLoss = 0;
  let rps = 0;
  let crps = 0;
  let absoluteContributionError = 0;
  let squaredContributionError = 0;
  let absoluteGamesError = 0;
  let squaredGamesError = 0;
  let coverage = 0;
  let intervalWidth = 0;
  let zeroProbabilityObservationCount = 0;
  for (const prediction of predictions) {
    const observedIndex = AFL_TRADE_PICK_OUTCOME_CATEGORIES.indexOf(prediction.observedCategory);
    for (const [index, entry] of prediction.categoryProbabilities.entries()) {
      brier += (entry.probability - (index === observedIndex ? 1 : 0)) ** 2;
    }
    const observedProbability = prediction.categoryProbabilities[observedIndex]!.probability;
    if (observedProbability === 0) zeroProbabilityObservationCount += 1;
    else logLoss -= Math.log(observedProbability);
    rps += rankedProbabilityScore(prediction);
    crps += empiricalCrps(prediction);
    const contributionError =
      prediction.predictedExpectedContribution - prediction.observedContribution;
    const gamesError = prediction.predictedExpectedGames - prediction.observedGames;
    absoluteContributionError += Math.abs(contributionError);
    squaredContributionError += contributionError ** 2;
    absoluteGamesError += Math.abs(gamesError);
    squaredGamesError += gamesError ** 2;
    coverage +=
      prediction.observedContribution >= prediction.p10Contribution &&
      prediction.observedContribution <= prediction.p90Contribution
        ? 1
        : 0;
    intervalWidth += prediction.p90Contribution - prediction.p10Contribution;
  }
  return {
    multiclassBrierScore: brier / predictions.length,
    multiclassLogLoss: zeroProbabilityObservationCount === 0 ? logLoss / predictions.length : null,
    rankedProbabilityScore: rps / predictions.length,
    contributionCrps: crps / predictions.length,
    meanAbsoluteContributionError: absoluteContributionError / predictions.length,
    rootMeanSquaredContributionError: Math.sqrt(squaredContributionError / predictions.length),
    meanAbsoluteGamesError: absoluteGamesError / predictions.length,
    rootMeanSquaredGamesError: Math.sqrt(squaredGamesError / predictions.length),
    empiricalP10P90Coverage: coverage / predictions.length,
    meanEmpiricalIntervalWidth: intervalWidth / predictions.length,
    zeroProbabilityObservationCount,
  };
}

function scoreScope(scope: (typeof EVALUATION_SCOPES)[number], predictions: Prediction[]) {
  const selected = predictions
    .filter((prediction) => scope === 'all_held_out' || prediction.partition === scope)
    .sort((left, right) => left.observationId.localeCompare(right.observationId));
  return {
    scope,
    observationCount: selected.length,
    observationIds: selected.map(({ observationId }) => observationId),
    metrics: selected.length === 0 ? null : computeMetrics(selected),
  };
}

function createScoreScopes(predictions: readonly Prediction[]) {
  return EVALUATION_SCOPES.map((scope) => scoreScope(scope, [...predictions]));
}

function exclusionReason(
  observation: AflTradePickPavObservation,
  minimumSelection: number,
  maximumSelection: number
): (typeof AFL_TRADE_PICK_PAV_VALIDATION_EXCLUSION_REASONS)[number] | null {
  if (observation.partition === 'train') return 'training_partition';
  if (observation.outcome.state === 'right_censored') return 'right_censored';
  if (observation.outcome.state === 'unavailable') return 'outcome_unavailable';
  if (observation.selection.pathway !== 'national') return 'non_national_pathway';
  if (observation.selection.access.state !== 'open') return 'selection_access_not_open';
  if (
    observation.selection.actualSelectionNumber < minimumSelection ||
    observation.selection.actualSelectionNumber > maximumSelection
  ) {
    return 'outside_training_domain';
  }
  return null;
}

function createPrediction(
  observation: AflTradePickPavObservation,
  benchmark: AflTradePickPavDistributionBenchmark
): Prediction {
  if (observation.partition === 'train' || observation.outcome.state !== 'mature_observed') {
    throw new TypeError('Only mature held-out observations can be scored.');
  }
  const point = benchmark.content.selectionCurve.find(
    ({ selectionNumber }) => selectionNumber === observation.selection.actualSelectionNumber
  );
  const block = point
    ? benchmark.content.distributionBlocks[point.distributionBlockIndex]
    : undefined;
  if (!point || !block) throw new TypeError('Held-out selection has no trained distribution.');
  return predictionSchema.parse({
    observationId: observation.observationId,
    partition: observation.partition,
    draftYear: observation.selection.draftYear,
    actualSelectionNumber: observation.selection.actualSelectionNumber,
    outcomeObservedAt: observation.outcomeObservedAt,
    distributionBlockIndex: point.distributionBlockIndex,
    supportObservationCount: block.observationCount,
    empiricalSupport: block.empiricalSupport
      .map(({ observationId, contribution, gamesPlayed }) => ({
        observationId,
        contribution,
        gamesPlayed,
      }))
      .sort((left, right) => left.observationId.localeCompare(right.observationId)),
    predictedExpectedContribution: point.distribution.expectedContribution,
    p10Contribution: point.distribution.p10Contribution,
    p50Contribution: point.distribution.p50Contribution,
    p90Contribution: point.distribution.p90Contribution,
    predictedExpectedGames: point.distribution.expectedGames,
    p10Games: point.distribution.p10Games,
    p50Games: point.distribution.p50Games,
    p90Games: point.distribution.p90Games,
    categoryProbabilities: point.distribution.outcomeProbabilities,
    observedContribution: observation.outcome.contribution,
    observedGames: observation.outcome.gamesPlayed,
    observedCategory: observation.outcome.category,
  });
}

export function validateAflTradePickPavDistributionBenchmark(
  unparsedObservationSet: AflTradePickPavObservationSet,
  unparsedBenchmark: AflTradePickPavDistributionBenchmark,
  unparsedConfig: AflTradePickPavValidationConfig
): AflTradePickPavValidationReport {
  const observationSet = aflTradePickPavObservationSetSchema.parse(unparsedObservationSet);
  const benchmark = aflTradePickPavDistributionBenchmarkSchema.parse(unparsedBenchmark);
  const config = aflTradePickPavValidationConfigSchema.parse(unparsedConfig);
  if (
    benchmark.content.observationSetId !== observationSet.observationSetId ||
    benchmark.content.observationSetSha256 !== observationSet.content.observationSetSha256 ||
    benchmark.content.environment !== observationSet.content.environment ||
    benchmark.content.releaseId !== observationSet.content.releaseId ||
    benchmark.content.policyId !== observationSet.content.policy.policyId ||
    benchmark.content.methodId !== observationSet.content.policy.content.methodId
  ) {
    throw new TypeError('Validation requires the exact fitted observation-set ancestry.');
  }
  const expectedBenchmark = fitAflTradePickPavDistributionBenchmark(
    observationSet,
    benchmark.content.config
  );
  if (expectedBenchmark.benchmarkId !== benchmark.benchmarkId) {
    throw new TypeError(
      'Validation requires the exact fitted benchmark re-derived from the observation set.'
    );
  }
  if (Date.parse(config.evaluatedAt) < Date.parse(observationSet.content.createdAt)) {
    throw new RangeError('Validation evaluation time must follow observation-set creation.');
  }
  const predictions: Prediction[] = [];
  const excludedObservations: Array<{
    observationId: string;
    reason: (typeof AFL_TRADE_PICK_PAV_VALIDATION_EXCLUSION_REASONS)[number];
  }> = [];
  for (const observation of observationSet.content.observations) {
    const reason = exclusionReason(
      observation,
      benchmark.content.diagnostics.minimumTrainingSelection,
      benchmark.content.diagnostics.maximumTrainingSelection
    );
    if (reason === null) predictions.push(createPrediction(observation, benchmark));
    else excludedObservations.push({ observationId: observation.observationId, reason });
  }
  predictions.sort(
    (left, right) =>
      partitionRank(left.partition) - partitionRank(right.partition) ||
      left.observationId.localeCompare(right.observationId)
  );
  excludedObservations.sort((left, right) => left.observationId.localeCompare(right.observationId));
  if (
    predictions.some(
      ({ outcomeObservedAt }) => Date.parse(outcomeObservedAt) > Date.parse(config.evaluatedAt)
    )
  ) {
    throw new RangeError('A held-out outcome was observed after the validation evaluation time.');
  }
  const scoreScopes = createScoreScopes(predictions);
  const partitionCoverageIsSufficient = HELD_OUT_PARTITIONS.every(
    (partition) =>
      predictions.filter((prediction) => prediction.partition === partition).length >=
      config.minimumPartitionObservations
  );
  const allMetrics = scoreScopes[0]!.metrics;
  const evaluationStatus =
    predictions.length < config.minimumEligibleObservations || !partitionCoverageIsSufficient
      ? 'insufficient_eligible_observations_not_approved'
      : (allMetrics?.zeroProbabilityObservationCount ?? 0) > 0
        ? 'invalid_zero_probability_not_approved'
        : 'scored_not_approved';
  const content = reportContentSchema.parse({
    schemaVersion: AFL_TRADE_PICK_PAV_VALIDATION_REPORT_SCHEMA_VERSION,
    authorityBoundary: AFL_TRADE_PICK_PAV_VALIDATION_AUTHORITY_BOUNDARY,
    publicationEligible: false,
    approvalStatus: 'not_assessed_by_validation_harness',
    environment: observationSet.content.environment,
    competition: observationSet.content.competition,
    observationSetId: observationSet.observationSetId,
    benchmarkId: benchmark.benchmarkId,
    releaseId: observationSet.content.releaseId,
    policyId: observationSet.content.policy.policyId,
    methodId: observationSet.content.policy.content.methodId,
    valueUnit: observationSet.content.policy.content.outcomeValueUnit,
    fixedHorizonSeasons: observationSet.content.policy.content.fixedHorizonSeasons,
    config,
    evaluationStatus,
    inputObservationCount: observationSet.content.observations.length,
    predictions,
    excludedObservations,
    scoreScopes,
    limitation:
      'Validation evidence is not Gate approval, deployment approval, a grade, or public numerical authority.',
  });
  return aflTradePickPavValidationReportSchema.parse({
    validationReportId: createAflTradeContentAddress('pick-pav-validation-report', content),
    content,
  });
}
