import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeModelRunManifestSchema,
  type AflTradeModelRunManifest,
} from '../artifacts/modelRunManifest';
import {
  aflTradePickDistributionBenchmarkFitSchema,
  type AflTradePickDistributionBenchmarkFit,
} from './pickDistributionBenchmark';
import {
  AFL_TRADE_PICK_OUTCOME_CATEGORIES,
  aflTradePickOutcomeObservationSetSchema,
  type AflTradePickOutcomeObservation,
  type AflTradePickOutcomeObservationSet,
} from './pickOutcomeContracts';

const FLOAT_TOLERANCE = 1e-8;
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const finiteNumberSchema = z.number().finite();
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_PICK_VALIDATION_EXCLUSION_REASONS = [
  'training_partition',
  'right_censored',
  'outcome_unavailable',
  'non_national_pathway',
  'restricted_access',
  'actual_selection_unavailable',
  'outside_pick_curve_domain',
] as const;

export const aflTradePickValidationConfigSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-validation-config/v1'),
    evaluatedAt: isoDateTimeSchema,
    minimumEligibleObservations: z.number().int().positive().max(10_000),
    minimumSubgroupObservations: z.number().int().positive().max(10_000),
    logLossZeroProbabilityPolicy: z.literal('invalidate_without_probability_floor'),
    rankedProbabilityScoreNormalization: z.literal('divide_by_ordered_category_boundaries'),
    contributionScore: z.literal('empirical_distribution_crps'),
    intervalCoverage: z.literal('empirical_p10_p90_outcome_interval_not_model_interval'),
  })
  .strict();

const probabilitySchema = z
  .object({
    category: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    probability: finiteNumberSchema.min(0).max(1),
  })
  .strict();

const contributionSupportSchema = z
  .object({
    contribution: finiteNumberSchema,
    probability: finiteNumberSchema.positive().max(1),
  })
  .strict();

const heldOutPredictionSchema = z
  .object({
    observationId: publicIdSchema,
    partition: z.enum(['calibration', 'validation', 'final_test']),
    draftClassId: publicIdSchema,
    draftYear: z.number().int().min(1897).max(2100),
    outcomeObservedAt: isoDateTimeSchema,
    era: publicIdSchema,
    playerPosition: publicIdSchema,
    evidenceQuality: z.enum(['high', 'medium', 'low']),
    actualSelectionNumber: z.number().int().positive().max(500),
    distributionBlockIndex: z.number().int().nonnegative().max(499),
    observedCategory: z.enum(AFL_TRADE_PICK_OUTCOME_CATEGORIES),
    observedContribution: finiteNumberSchema,
    categoryProbabilities: z
      .array(probabilitySchema)
      .length(AFL_TRADE_PICK_OUTCOME_CATEGORIES.length),
    contributionSupport: z.array(contributionSupportSchema).min(1).max(100_000),
    predictedExpectedContribution: finiteNumberSchema,
    p10Contribution: finiteNumberSchema,
    p90Contribution: finiteNumberSchema,
  })
  .strict()
  .superRefine((prediction, context) => {
    const categoryProbabilityMass = prediction.categoryProbabilities.reduce(
      (sum, item) => sum + item.probability,
      0
    );
    const supportProbabilityMass = prediction.contributionSupport.reduce(
      (sum, item) => sum + item.probability,
      0
    );
    const supportMean = prediction.contributionSupport.reduce(
      (sum, item) => sum + item.contribution * item.probability,
      0
    );
    if (
      prediction.categoryProbabilities.some(
        ({ category }, index) => category !== AFL_TRADE_PICK_OUTCOME_CATEGORIES[index]
      ) ||
      Math.abs(categoryProbabilityMass - 1) > FLOAT_TOLERANCE ||
      Math.abs(supportProbabilityMass - 1) > FLOAT_TOLERANCE ||
      Math.abs(supportMean - prediction.predictedExpectedContribution) > FLOAT_TOLERANCE ||
      prediction.p10Contribution > prediction.p90Contribution
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Held-out predictions require ordered normalized distributions and derived means.',
      });
    }
  });

const validationMetricsSchema = z
  .object({
    multiclassBrierScore: finiteNumberSchema.nonnegative(),
    logLoss: finiteNumberSchema.nonnegative().nullable(),
    rankedProbabilityScore: finiteNumberSchema.nonnegative(),
    contributionCrps: finiteNumberSchema.nonnegative(),
    meanAbsoluteError: finiteNumberSchema.nonnegative(),
    rootMeanSquaredError: finiteNumberSchema.nonnegative(),
    empiricalP10P90Coverage: finiteNumberSchema.min(0).max(1),
    meanEmpiricalIntervalWidth: finiteNumberSchema.nonnegative(),
    zeroProbabilityObservationCount: z.number().int().nonnegative(),
  })
  .strict();

const scoreScopeSchema = z
  .object({
    scope: z.enum(['all_held_out', 'calibration', 'validation', 'final_test']),
    observationCount: z.number().int().nonnegative(),
    status: z.enum(['scored', 'no_eligible_observations']),
    metrics: validationMetricsSchema.nullable(),
  })
  .strict()
  .superRefine((scope, context) => {
    if (
      (scope.status === 'scored' && (scope.observationCount === 0 || scope.metrics === null)) ||
      (scope.status === 'no_eligible_observations' &&
        (scope.observationCount !== 0 || scope.metrics !== null))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Score scope status and metrics must reconcile.',
      });
    }
  });

const subgroupSchema = z
  .object({
    dimension: z.enum(['era', 'player_position', 'evidence_quality']),
    value: publicIdSchema,
    observationCount: z.number().int().positive(),
    status: z.enum(['scored', 'insufficient_observations']),
    metrics: validationMetricsSchema.nullable(),
  })
  .strict()
  .superRefine((subgroup, context) => {
    if (
      (subgroup.status === 'scored' && subgroup.metrics === null) ||
      (subgroup.status === 'insufficient_observations' && subgroup.metrics !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Subgroup status and metrics must reconcile.' });
    }
  });

const excludedObservationSchema = z
  .object({
    observationId: publicIdSchema,
    reason: z.enum(AFL_TRADE_PICK_VALIDATION_EXCLUSION_REASONS),
  })
  .strict();

const stabilityComparisonSchema = z
  .object({
    referenceBenchmarkFitId: aflTradeContentAddressedIdSchema('pick-benchmark-fit'),
    referenceDatasetId: aflTradeContentAddressedIdSchema('dataset'),
    sharedSelectionCount: z.number().int().positive().max(500),
    meanAbsoluteExpectedContributionDrift: finiteNumberSchema.nonnegative(),
    maximumAbsoluteExpectedContributionDrift: finiteNumberSchema.nonnegative(),
    meanOutcomeDistributionTotalVariation: finiteNumberSchema.min(0).max(1),
  })
  .strict();

export const aflTradePickValidationReportContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-validation-report/v1'),
    publicAssetBoundary: z.literal('source_native_afl_draft_selection_no_fantasy_ownership'),
    observationSetId: aflTradeContentAddressedIdSchema('pick-observation-set'),
    pickBenchmarkFitId: aflTradeContentAddressedIdSchema('pick-benchmark-fit'),
    modelRunId: aflTradeContentAddressedIdSchema('model-run'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    valueUnitId: publicIdSchema,
    fixedHorizonDefinitionArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    outcomeDefinitionArtifactId: aflTradeContentAddressedIdSchema('artifact'),
    candidateLockedAt: isoDateTimeSchema,
    finalTestEvaluatedAt: isoDateTimeSchema,
    config: aflTradePickValidationConfigSchema,
    inputObservationCount: z.number().int().positive().max(100_000),
    evaluationStatus: z.enum([
      'scored_not_approved',
      'invalid_zero_probability_not_approved',
      'insufficient_eligible_observations_not_approved',
    ]),
    approvalStatus: z.literal('not_assessed_by_validation_harness'),
    predictions: z.array(heldOutPredictionSchema).max(100_000),
    excludedObservations: z.array(excludedObservationSchema).max(100_000),
    scoreScopes: z.array(scoreScopeSchema).length(4),
    subgroups: z.array(subgroupSchema).max(100_000),
    curveStability: z
      .object({
        status: z.enum(['evaluated_against_explicit_references', 'no_reference_fits_supplied']),
        comparisons: z.array(stabilityComparisonSchema).max(100),
      })
      .strict(),
    expectedCurveMonotonicity: z.literal('verified_non_increasing'),
    limitation: z.literal(
      'Validation harness output is evidence, not source approval, model approval, Gate approval, or deployment approval.'
    ),
  })
  .strict()
  .superRefine((report, context) => {
    const predictionIds = report.predictions.map(({ observationId }) => observationId);
    const exclusionIds = report.excludedObservations.map(({ observationId }) => observationId);
    if (
      new Set(predictionIds).size !== predictionIds.length ||
      new Set(exclusionIds).size !== exclusionIds.length ||
      new Set([...predictionIds, ...exclusionIds]).size !==
        predictionIds.length + exclusionIds.length ||
      predictionIds.length + exclusionIds.length !== report.inputObservationCount ||
      predictionIds.some((id, index) => id !== [...predictionIds].sort()[index]) ||
      exclusionIds.some((id, index) => id !== [...exclusionIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['predictions'],
        message: 'Validated and excluded observation identities must be unique and disjoint.',
      });
    }
    if (
      Date.parse(report.candidateLockedAt) > Date.parse(report.finalTestEvaluatedAt) ||
      Date.parse(report.finalTestEvaluatedAt) > Date.parse(report.config.evaluatedAt) ||
      report.predictions.some(
        ({ outcomeObservedAt }) =>
          Date.parse(outcomeObservedAt) > Date.parse(report.config.evaluatedAt)
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['config', 'evaluatedAt'],
        message:
          'Candidate lock, final-test evaluation, labels, and report time must be chronological.',
      });
    }
    const expectedScopes = ['all_held_out', 'calibration', 'validation', 'final_test'];
    for (const [scopeIndex, scope] of report.scoreScopes.entries()) {
      const scopedPredictions =
        scope.scope === 'all_held_out'
          ? report.predictions
          : report.predictions.filter(({ partition }) => partition === scope.scope);
      const recomputedMetrics =
        scopedPredictions.length === 0 ? null : computeValidationMetrics(scopedPredictions);
      if (
        scope.scope !== expectedScopes[scopeIndex] ||
        scope.observationCount !== scopedPredictions.length ||
        !metricsMatch(scope.metrics, recomputedMetrics)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['scoreScopes', scopeIndex],
          message: 'Score scopes must be ordered and derived from held-out predictions.',
        });
      }
    }
    const allMetrics = report.scoreScopes[0].metrics;
    const expectedStatus =
      report.predictions.length < report.config.minimumEligibleObservations
        ? 'insufficient_eligible_observations_not_approved'
        : (allMetrics?.zeroProbabilityObservationCount ?? 0) > 0
          ? 'invalid_zero_probability_not_approved'
          : 'scored_not_approved';
    if (report.evaluationStatus !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        path: ['evaluationStatus'],
        message: 'Evaluation status must reflect sample sufficiency and zero-probability failures.',
      });
    }
    const expectedSubgroups = createSubgroups(
      report.predictions,
      report.config.minimumSubgroupObservations
    );
    if (
      report.subgroups.length !== expectedSubgroups.length ||
      report.subgroups.some((subgroup, index) => {
        const expected = expectedSubgroups[index];
        return (
          subgroup.dimension !== expected.dimension ||
          subgroup.value !== expected.value ||
          subgroup.observationCount !== expected.observationCount ||
          subgroup.status !== expected.status ||
          !metricsMatch(subgroup.metrics, expected.metrics)
        );
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['subgroups'],
        message: 'Subgroup scores must be derived canonically from held-out predictions.',
      });
    }
    if (
      (report.curveStability.status === 'no_reference_fits_supplied' &&
        report.curveStability.comparisons.length !== 0) ||
      (report.curveStability.status === 'evaluated_against_explicit_references' &&
        report.curveStability.comparisons.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['curveStability'],
        message: 'Curve-stability status and explicit reference comparisons must reconcile.',
      });
    }
  });

export const aflTradePickValidationReportSchema = z
  .object({
    validationReportId: aflTradeContentAddressedIdSchema('pick-validation-report'),
    content: aflTradePickValidationReportContentSchema,
  })
  .strict()
  .superRefine((report, context) => {
    addAflTradeContentAddressIssue(
      'pick-validation-report',
      report.validationReportId,
      report.content,
      context,
      ['validationReportId']
    );
  });

export type AflTradePickValidationConfig = z.infer<typeof aflTradePickValidationConfigSchema>;
export type AflTradePickValidationReport = z.infer<typeof aflTradePickValidationReportSchema>;
type HeldOutPrediction = z.infer<typeof heldOutPredictionSchema>;
type ValidationMetrics = z.infer<typeof validationMetricsSchema>;

function contributionCrps(prediction: HeldOutPrediction): number {
  const firstTerm = prediction.contributionSupport.reduce(
    (sum, support) =>
      sum + support.probability * Math.abs(support.contribution - prediction.observedContribution),
    0
  );
  const secondTerm = prediction.contributionSupport.reduce(
    (outerSum, left) =>
      outerSum +
      prediction.contributionSupport.reduce(
        (innerSum, right) =>
          innerSum +
          left.probability * right.probability * Math.abs(left.contribution - right.contribution),
        0
      ),
    0
  );
  return Math.max(0, firstTerm - secondTerm / 2);
}

function rankedProbabilityScore(prediction: HeldOutPrediction): number {
  const observedIndex = AFL_TRADE_PICK_OUTCOME_CATEGORIES.indexOf(prediction.observedCategory);
  let predictedCumulative = 0;
  let score = 0;
  for (let index = 0; index < AFL_TRADE_PICK_OUTCOME_CATEGORIES.length - 1; index += 1) {
    predictedCumulative += prediction.categoryProbabilities[index].probability;
    const observedCumulative = observedIndex <= index ? 1 : 0;
    score += (predictedCumulative - observedCumulative) ** 2;
  }
  return score / (AFL_TRADE_PICK_OUTCOME_CATEGORIES.length - 1);
}

function computeValidationMetrics(predictions: readonly HeldOutPrediction[]): ValidationMetrics {
  let brier = 0;
  let logLoss = 0;
  let rps = 0;
  let crps = 0;
  let absoluteError = 0;
  let squaredError = 0;
  let coverage = 0;
  let intervalWidth = 0;
  let zeroProbabilityObservationCount = 0;
  for (const prediction of predictions) {
    const observedIndex = AFL_TRADE_PICK_OUTCOME_CATEGORIES.indexOf(prediction.observedCategory);
    for (const [index, probability] of prediction.categoryProbabilities.entries()) {
      brier += (probability.probability - (index === observedIndex ? 1 : 0)) ** 2;
    }
    const observedProbability = prediction.categoryProbabilities[observedIndex].probability;
    if (observedProbability === 0) zeroProbabilityObservationCount += 1;
    else logLoss -= Math.log(observedProbability);
    rps += rankedProbabilityScore(prediction);
    crps += contributionCrps(prediction);
    const error = prediction.predictedExpectedContribution - prediction.observedContribution;
    absoluteError += Math.abs(error);
    squaredError += error ** 2;
    coverage +=
      prediction.observedContribution >= prediction.p10Contribution &&
      prediction.observedContribution <= prediction.p90Contribution
        ? 1
        : 0;
    intervalWidth += prediction.p90Contribution - prediction.p10Contribution;
  }
  return {
    multiclassBrierScore: brier / predictions.length,
    logLoss: zeroProbabilityObservationCount === 0 ? logLoss / predictions.length : null,
    rankedProbabilityScore: rps / predictions.length,
    contributionCrps: crps / predictions.length,
    meanAbsoluteError: absoluteError / predictions.length,
    rootMeanSquaredError: Math.sqrt(squaredError / predictions.length),
    empiricalP10P90Coverage: coverage / predictions.length,
    meanEmpiricalIntervalWidth: intervalWidth / predictions.length,
    zeroProbabilityObservationCount,
  };
}

function metricsMatch(left: ValidationMetrics | null, right: ValidationMetrics | null): boolean {
  if (left === null || right === null) return left === right;
  return Object.entries(left).every(([key, value]) => {
    const other = right[key as keyof ValidationMetrics];
    if (value === null || other === null) return value === other;
    return Math.abs(value - other) <= FLOAT_TOLERANCE;
  });
}

function exclusionReason(
  observation: AflTradePickOutcomeObservation,
  minimumSelection: number,
  maximumSelection: number
): (typeof AFL_TRADE_PICK_VALIDATION_EXCLUSION_REASONS)[number] | null {
  if (observation.partition === 'train') return 'training_partition';
  if (observation.outcome.state === 'right_censored') return 'right_censored';
  if (observation.outcome.state === 'unavailable') return 'outcome_unavailable';
  if (observation.selection.pathway !== 'national') return 'non_national_pathway';
  if (observation.selection.access !== 'open') return 'restricted_access';
  const selection = observation.selection.actualSelectionNumber;
  if (selection === null) return 'actual_selection_unavailable';
  if (selection < minimumSelection || selection > maximumSelection) {
    return 'outside_pick_curve_domain';
  }
  return null;
}

function createPrediction(
  observation: AflTradePickOutcomeObservation,
  benchmark: AflTradePickDistributionBenchmarkFit
): HeldOutPrediction {
  if (observation.partition === 'train' || observation.outcome.state !== 'mature_observed') {
    throw new TypeError('Held-out prediction requires a mature non-training observation.');
  }
  const actualSelectionNumber = observation.selection.actualSelectionNumber!;
  const curvePoint = benchmark.content.selectionCurve.find(
    ({ selectionNumber }) => selectionNumber === actualSelectionNumber
  )!;
  const block = benchmark.content.distributionBlocks[curvePoint.distributionBlockIndex];
  return heldOutPredictionSchema.parse({
    observationId: observation.observationId,
    partition: observation.partition,
    draftClassId: observation.draftClassId,
    draftYear: observation.draftYear,
    outcomeObservedAt: observation.outcomeObservedAt,
    era: observation.era,
    playerPosition: observation.playerPosition,
    evidenceQuality: observation.evidenceQuality,
    actualSelectionNumber,
    distributionBlockIndex: block.blockIndex,
    observedCategory: observation.outcome.category,
    observedContribution: observation.outcome.contribution,
    categoryProbabilities: block.outcomeProbabilities,
    contributionSupport: block.empiricalSupport.map(({ contribution, probability }) => ({
      contribution,
      probability,
    })),
    predictedExpectedContribution: block.fittedExpectedContribution,
    p10Contribution: block.p10Contribution,
    p90Contribution: block.p90Contribution,
  });
}

function createScoreScope(
  scope: 'all_held_out' | 'calibration' | 'validation' | 'final_test',
  predictions: HeldOutPrediction[]
) {
  return {
    scope,
    observationCount: predictions.length,
    status: predictions.length === 0 ? ('no_eligible_observations' as const) : ('scored' as const),
    metrics: predictions.length === 0 ? null : computeValidationMetrics(predictions),
  };
}

function createSubgroups(predictions: HeldOutPrediction[], minimumObservations: number) {
  const dimensions = [
    { dimension: 'era' as const, value: (prediction: HeldOutPrediction) => prediction.era },
    {
      dimension: 'player_position' as const,
      value: (prediction: HeldOutPrediction) => prediction.playerPosition,
    },
    {
      dimension: 'evidence_quality' as const,
      value: (prediction: HeldOutPrediction) => prediction.evidenceQuality,
    },
  ];
  return dimensions.flatMap(({ dimension, value }) => {
    const values = [...new Set(predictions.map(value))].sort();
    return values.map((subgroupValue) => {
      const members = predictions.filter((prediction) => value(prediction) === subgroupValue);
      const sufficient = members.length >= minimumObservations;
      return {
        dimension,
        value: subgroupValue,
        observationCount: members.length,
        status: sufficient ? ('scored' as const) : ('insufficient_observations' as const),
        metrics: sufficient ? computeValidationMetrics(members) : null,
      };
    });
  });
}

function probabilityVectorAtSelection(
  fit: AflTradePickDistributionBenchmarkFit,
  selectionNumber: number
): number[] {
  const curvePoint = fit.content.selectionCurve.find(
    (point) => point.selectionNumber === selectionNumber
  )!;
  return fit.content.distributionBlocks[curvePoint.distributionBlockIndex].outcomeProbabilities.map(
    ({ probability }) => probability
  );
}

function createStabilityComparison(
  candidate: AflTradePickDistributionBenchmarkFit,
  reference: AflTradePickDistributionBenchmarkFit
) {
  const referenceSelections = new Set(
    reference.content.selectionCurve.map(({ selectionNumber }) => selectionNumber)
  );
  const sharedSelections = candidate.content.selectionCurve
    .map(({ selectionNumber }) => selectionNumber)
    .filter((selection) => referenceSelections.has(selection));
  if (sharedSelections.length === 0) {
    throw new RangeError('Curve-stability references require at least one shared selection.');
  }
  const expectedDrifts = sharedSelections.map((selection) => {
    const candidatePoint = candidate.content.selectionCurve.find(
      (point) => point.selectionNumber === selection
    )!;
    const referencePoint = reference.content.selectionCurve.find(
      (point) => point.selectionNumber === selection
    )!;
    return Math.abs(candidatePoint.expectedContribution - referencePoint.expectedContribution);
  });
  const totalVariations = sharedSelections.map((selection) => {
    const candidateProbabilities = probabilityVectorAtSelection(candidate, selection);
    const referenceProbabilities = probabilityVectorAtSelection(reference, selection);
    return (
      candidateProbabilities.reduce(
        (sum, probability, index) => sum + Math.abs(probability - referenceProbabilities[index]),
        0
      ) / 2
    );
  });
  return {
    referenceBenchmarkFitId: reference.benchmarkFitId,
    referenceDatasetId: reference.content.datasetId,
    sharedSelectionCount: sharedSelections.length,
    meanAbsoluteExpectedContributionDrift:
      expectedDrifts.reduce((sum, drift) => sum + drift, 0) / expectedDrifts.length,
    maximumAbsoluteExpectedContributionDrift: Math.max(...expectedDrifts),
    meanOutcomeDistributionTotalVariation:
      totalVariations.reduce((sum, variation) => sum + variation, 0) / totalVariations.length,
  };
}

export function validateAflTradePickDistributionBenchmark(
  unparsedObservationSet: AflTradePickOutcomeObservationSet,
  unparsedBenchmark: AflTradePickDistributionBenchmarkFit,
  unparsedModelRunManifest: AflTradeModelRunManifest,
  unparsedConfig: AflTradePickValidationConfig,
  unparsedReferenceFits: readonly AflTradePickDistributionBenchmarkFit[] = []
): AflTradePickValidationReport {
  const observationSet = aflTradePickOutcomeObservationSetSchema.parse(unparsedObservationSet);
  const benchmark = aflTradePickDistributionBenchmarkFitSchema.parse(unparsedBenchmark);
  const modelRunManifest = aflTradeModelRunManifestSchema.parse(unparsedModelRunManifest);
  const config = aflTradePickValidationConfigSchema.parse(unparsedConfig);
  const references = unparsedReferenceFits
    .map((fit) => aflTradePickDistributionBenchmarkFitSchema.parse(fit))
    .sort((left, right) => left.benchmarkFitId.localeCompare(right.benchmarkFitId));
  if (
    benchmark.content.observationSetId !== observationSet.observationSetId ||
    benchmark.content.datasetId !== observationSet.content.datasetId ||
    benchmark.content.modelProtocolId !== observationSet.content.modelProtocolId ||
    modelRunManifest.content.datasetId !== benchmark.content.datasetId ||
    modelRunManifest.content.modelProtocolId !== benchmark.content.modelProtocolId ||
    modelRunManifest.content.outcome.status !== 'succeeded' ||
    modelRunManifest.content.candidateLockedAt === null ||
    modelRunManifest.content.finalTestEvaluatedAt === null
  ) {
    throw new TypeError('Validation requires one successful locked candidate provenance chain.');
  }
  if (
    Date.parse(config.evaluatedAt) < Date.parse(modelRunManifest.content.finishedAt) ||
    Date.parse(config.evaluatedAt) < Date.parse(modelRunManifest.content.finalTestEvaluatedAt)
  ) {
    throw new RangeError(
      'Validation time must follow candidate lock, final-test evaluation, and run completion.'
    );
  }
  const referenceIds = references.map(({ benchmarkFitId }) => benchmarkFitId);
  if (
    new Set(referenceIds).size !== referenceIds.length ||
    references.some(
      (reference) =>
        reference.benchmarkFitId === benchmark.benchmarkFitId ||
        reference.content.modelProtocolId !== benchmark.content.modelProtocolId ||
        reference.content.valueUnitId !== benchmark.content.valueUnitId ||
        reference.content.fixedHorizonDefinitionArtifactId !==
          benchmark.content.fixedHorizonDefinitionArtifactId ||
        reference.content.outcomeDefinitionArtifactId !==
          benchmark.content.outcomeDefinitionArtifactId
    )
  ) {
    throw new TypeError('Curve-stability references must be unique and definition-compatible.');
  }

  const predictions: HeldOutPrediction[] = [];
  const excludedObservations: Array<{
    observationId: string;
    reason: (typeof AFL_TRADE_PICK_VALIDATION_EXCLUSION_REASONS)[number];
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
  predictions.sort((left, right) => left.observationId.localeCompare(right.observationId));
  excludedObservations.sort((left, right) => left.observationId.localeCompare(right.observationId));
  if (
    predictions.some(
      ({ outcomeObservedAt }) => Date.parse(outcomeObservedAt) > Date.parse(config.evaluatedAt)
    )
  ) {
    throw new RangeError('Validation cannot use outcomes observed after the evaluation timestamp.');
  }
  const scoreScopes = [
    createScoreScope('all_held_out', predictions),
    createScoreScope(
      'calibration',
      predictions.filter(({ partition }) => partition === 'calibration')
    ),
    createScoreScope(
      'validation',
      predictions.filter(({ partition }) => partition === 'validation')
    ),
    createScoreScope(
      'final_test',
      predictions.filter(({ partition }) => partition === 'final_test')
    ),
  ];
  const allMetrics = scoreScopes[0].metrics;
  const evaluationStatus =
    predictions.length < config.minimumEligibleObservations
      ? 'insufficient_eligible_observations_not_approved'
      : (allMetrics?.zeroProbabilityObservationCount ?? 0) > 0
        ? 'invalid_zero_probability_not_approved'
        : 'scored_not_approved';
  const stabilityComparisons = references.map((reference) =>
    createStabilityComparison(benchmark, reference)
  );
  const content = aflTradePickValidationReportContentSchema.parse({
    schemaVersion: 'afl-trade-pick-validation-report/v1',
    publicAssetBoundary: observationSet.content.publicAssetBoundary,
    observationSetId: observationSet.observationSetId,
    pickBenchmarkFitId: benchmark.benchmarkFitId,
    modelRunId: modelRunManifest.runId,
    datasetId: benchmark.content.datasetId,
    modelProtocolId: benchmark.content.modelProtocolId,
    valueUnitId: benchmark.content.valueUnitId,
    fixedHorizonDefinitionArtifactId: benchmark.content.fixedHorizonDefinitionArtifactId,
    outcomeDefinitionArtifactId: benchmark.content.outcomeDefinitionArtifactId,
    candidateLockedAt: modelRunManifest.content.candidateLockedAt,
    finalTestEvaluatedAt: modelRunManifest.content.finalTestEvaluatedAt,
    config,
    inputObservationCount: observationSet.content.observations.length,
    evaluationStatus,
    approvalStatus: 'not_assessed_by_validation_harness',
    predictions,
    excludedObservations,
    scoreScopes,
    subgroups: createSubgroups(predictions, config.minimumSubgroupObservations),
    curveStability: {
      status:
        stabilityComparisons.length === 0
          ? 'no_reference_fits_supplied'
          : 'evaluated_against_explicit_references',
      comparisons: stabilityComparisons,
    },
    expectedCurveMonotonicity: 'verified_non_increasing',
    limitation:
      'Validation harness output is evidence, not source approval, model approval, Gate approval, or deployment approval.',
  });
  return aflTradePickValidationReportSchema.parse({
    validationReportId: createAflTradeContentAddress('pick-validation-report', content),
    content,
  });
}
