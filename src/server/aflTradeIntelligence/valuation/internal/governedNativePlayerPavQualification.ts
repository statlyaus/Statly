import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../../artifacts/contentAddress';
import {
  aflTradeNativePavAcceptanceAssessmentSchema,
  aflTradeNativePavAcceptanceCriteriaContentSchema,
  aflTradeNativePavAcceptanceInputSchema,
  assessAflTradeNativePavAcceptance,
  createAflTradeNativePavAcceptanceCriteria,
} from '../../modeling/admittedPlayerPavAcceptance';
import { aflTradeNativePavPreFinalConfigurationSchema } from '../../modeling/admittedPlayerPavPreFinalEvaluation';
import { aflTradeNativePavFinalEvidenceSchema } from '../../modeling/admittedPlayerPavReports';

const observationIdSchema = z.string().regex(/^player-pav-observation:[a-f0-9]{64}$/);
const selectedBaselineSchema = z
  .object({
    definitionKey: z.string().trim().min(1).max(200),
    definitionArtifact: aflTradeArtifactRefSchema,
    fitId: aflTradeContentAddressedIdSchema('player-pav-forecast-fit'),
    calibrationId: aflTradeContentAddressedIdSchema('player-pav-empirical-calibration'),
  })
  .strict();

export const governedNativePlayerPavQualificationCriteriaContentSchema = z
  .object({
    schemaVersion: z.literal('governed-native-player-pav-qualification-criteria/v1'),
    authorityBoundary: z.literal('review_required_no_qualification_authority'),
    acceptanceCriteriaId: aflTradeContentAddressedIdSchema('native-pav-acceptance-criteria'),
    acceptanceCriteria: aflTradeNativePavAcceptanceCriteriaContentSchema,
    selectedBaselineDefinitionArtifact: aflTradeArtifactRefSchema,
    distributionSupportRule: z.literal('exact_common_paired_distribution_support_no_dropping'),
    precisionRequirement: z.literal('reviewed_simultaneous_all_nine_criteria_required_for_pass'),
    precisionEvidenceState: z.literal('not_supplied'),
    qualificationGranted: z.literal(false),
  })
  .strict()
  .superRefine((criteria, context) => {
    if (
      criteria.acceptanceCriteriaId !==
      createAflTradeContentAddress('native-pav-acceptance-criteria', criteria.acceptanceCriteria)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acceptanceCriteriaId'],
        message: 'Native qualification criteria require the exact acceptance definition.',
      });
    }
  });

export const governedNativePlayerPavQualificationCriteriaSchema = z
  .object({
    criteriaId: aflTradeContentAddressedIdSchema('native-player-pav-qualification-criteria'),
    content: governedNativePlayerPavQualificationCriteriaContentSchema,
  })
  .strict()
  .superRefine((criteria, context) => {
    addAflTradeContentAddressIssue(
      'native-player-pav-qualification-criteria',
      criteria.criteriaId,
      criteria.content,
      context,
      ['criteriaId']
    );
  });

export function createGovernedNativePlayerPavQualificationCriteria(input: {
  readonly selectedBaselineDefinitionArtifact: AflTradeArtifactRef;
}) {
  const acceptance = createAflTradeNativePavAcceptanceCriteria();
  const content = governedNativePlayerPavQualificationCriteriaContentSchema.parse({
    schemaVersion: 'governed-native-player-pav-qualification-criteria/v1',
    authorityBoundary: 'review_required_no_qualification_authority',
    acceptanceCriteriaId: acceptance.criteriaId,
    acceptanceCriteria: acceptance.content,
    selectedBaselineDefinitionArtifact: input.selectedBaselineDefinitionArtifact,
    distributionSupportRule: 'exact_common_paired_distribution_support_no_dropping',
    precisionRequirement: 'reviewed_simultaneous_all_nine_criteria_required_for_pass',
    precisionEvidenceState: 'not_supplied',
    qualificationGranted: false,
  });
  return governedNativePlayerPavQualificationCriteriaSchema.parse({
    criteriaId: createAflTradeContentAddress('native-player-pav-qualification-criteria', content),
    content,
  });
}

const supportSchema = z
  .object({
    status: z.enum([
      'complete_common_distribution_support',
      'incomplete_distribution_support',
      'empty_paired_support',
    ]),
    pairedObservationIds: z.array(observationIdSchema).max(100_000),
    excludedObservationIds: z.array(observationIdSchema).max(100_000),
    missingDistributionObservationIds: z.array(observationIdSchema).max(100_000),
  })
  .strict()
  .superRefine((support, context) => {
    for (const key of [
      'pairedObservationIds',
      'excludedObservationIds',
      'missingDistributionObservationIds',
    ] as const) {
      if (new Set(support[key]).size !== support[key].length) {
        context.addIssue({ code: 'custom', path: [key], message: 'Support IDs must be unique.' });
      }
    }
    const paired = new Set(support.pairedObservationIds);
    if (support.missingDistributionObservationIds.some((id) => !paired.has(id))) {
      context.addIssue({
        code: 'custom',
        path: ['missingDistributionObservationIds'],
        message: 'Missing distribution support must be a subset of paired support.',
      });
    }
    if (support.excludedObservationIds.some((id) => paired.has(id))) {
      context.addIssue({
        code: 'custom',
        path: ['excludedObservationIds'],
        message: 'Paired and excluded support must be disjoint.',
      });
    }
    const expectedStatus =
      support.pairedObservationIds.length === 0
        ? 'empty_paired_support'
        : support.missingDistributionObservationIds.length === 0
          ? 'complete_common_distribution_support'
          : 'incomplete_distribution_support';
    if (support.status !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Distribution support status must match the exact missing-member set.',
      });
    }
  });

export const governedNativePlayerPavQualificationEvidenceContentSchema = z
  .object({
    schemaVersion: z.literal('governed-native-player-pav-qualification-evidence/v1'),
    authorityBoundary: z.literal('authenticated_inconclusive_no_qualification_authority'),
    finalEvaluationId: aflTradeContentAddressedIdSchema('native-pav-final-evaluation'),
    finalEvidenceArtifact: aflTradeArtifactRefSchema,
    criteriaId: governedNativePlayerPavQualificationCriteriaSchema.shape.criteriaId,
    criteriaArtifact: aflTradeArtifactRefSchema,
    acceptanceCriteriaId: aflTradeContentAddressedIdSchema('native-pav-acceptance-criteria'),
    calibrationConfigurationArtifact: aflTradeArtifactRefSchema,
    nominalIntervalCoverage: z.literal(0.8),
    selectedBaseline: selectedBaselineSchema,
    support: supportSchema,
    acceptanceInput: aflTradeNativePavAcceptanceInputSchema,
    assessment: aflTradeNativePavAcceptanceAssessmentSchema,
    qualificationGranted: z.literal(false),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.acceptanceInput.precision !== null) {
      context.addIssue({
        code: 'custom',
        path: ['acceptanceInput', 'precision'],
        message: 'V1 native qualification evidence cannot contain unreviewed precision.',
      });
    }
    const hasPairedSupport = evidence.support.pairedObservationIds.length > 0;
    const hasCompleteDistributionSupport =
      evidence.support.status === 'complete_common_distribution_support';
    if (evidence.acceptanceInput.horizons.some(({ mae }) => (mae !== null) !== hasPairedSupport)) {
      context.addIssue({
        code: 'custom',
        path: ['acceptanceInput', 'horizons'],
        message: 'Point metrics must match the declared paired support.',
      });
    }
    if (
      (evidence.acceptanceInput.cumulativeCrps !== null) !== hasCompleteDistributionSupport ||
      evidence.acceptanceInput.horizons.some(
        ({ coverage }) => (coverage !== null) !== hasCompleteDistributionSupport
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acceptanceInput'],
        message: 'Distribution metrics must match exact common distribution support.',
      });
    }
    if (evidence.assessment.criteriaId !== evidence.acceptanceCriteriaId) {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'criteriaId'],
        message: 'Native assessment criteria identity is invalid.',
      });
    }
    if (
      canonicalizeAflTradeJson(evidence.assessment) !==
      canonicalizeAflTradeJson(assessAflTradeNativePavAcceptance(evidence.acceptanceInput))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assessment'],
        message: 'Native assessment must equal exact recomputation from retained point evidence.',
      });
    }
    if (evidence.assessment.status !== 'inconclusive') {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'status'],
        message: 'Evidence without reviewed simultaneous precision must remain inconclusive.',
      });
    }
  });

export const governedNativePlayerPavQualificationEvidenceSchema = z
  .object({
    evidenceId: aflTradeContentAddressedIdSchema('native-player-pav-qualification-evidence'),
    content: governedNativePlayerPavQualificationEvidenceContentSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    addAflTradeContentAddressIssue(
      'native-player-pav-qualification-evidence',
      evidence.evidenceId,
      evidence.content,
      context,
      ['evidenceId']
    );
  });

const mean = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

type NativeFinalEvidence = z.infer<typeof aflTradeNativePavFinalEvidenceSchema>;
type NativeFinalEvidenceV2 = Extract<
  NativeFinalEvidence['content'],
  { schemaVersion: 'afl-trade-native-pav-final-evaluation/v2' }
>;
type PairedScore = NativeFinalEvidenceV2['baselineComparisons'][number]['pairedScores'][number];
type ScoreContribution = PairedScore['primary']['annual'][number];

function aggregateScoreContributions(scores: readonly ScoreContribution[]) {
  if (scores.length === 0) return null;
  const distributions = scores.flatMap(({ distribution }) =>
    distribution === null ? [] : [distribution]
  );
  return {
    bias: mean(scores.map(({ error }) => error)),
    mae: mean(scores.map(({ absoluteError }) => absoluteError)),
    rmse: Math.sqrt(mean(scores.map(({ squaredError }) => squaredError))!),
    distributionObservationCount: distributions.length,
    crps: mean(distributions.map(({ crps }) => crps)),
    intervalCoverage: mean(distributions.map(({ intervalCoverage }) => intervalCoverage)),
    intervalWidth: mean(distributions.map(({ intervalWidth }) => intervalWidth)),
    intervalScore: mean(distributions.map(({ intervalScore }) => intervalScore)),
  };
}

function aggregatePairedScores(rows: readonly PairedScore[], side: 'primary' | 'baseline') {
  return {
    observationCount: rows.length,
    annual: [0, 1, 2].map((index) =>
      aggregateScoreContributions(rows.map((row) => row[side].annual[index]!))
    ),
    cumulative: aggregateScoreContributions(rows.map((row) => row[side].cumulative)),
  };
}

/**
 * Authenticates and derives point evidence from one exact retained V5 final evaluation.
 * The v1 contract intentionally accepts no precision evidence, so it can only retain an
 * inconclusive assessment and cannot grant model, Gate or publication authority.
 */
export function deriveGovernedNativePlayerPavQualificationEvidence(input: {
  readonly finalEvidence: unknown;
  readonly finalEvidenceArtifact: AflTradeArtifactRef;
  readonly calibrationConfiguration: unknown;
  readonly calibrationConfigurationArtifact: AflTradeArtifactRef;
  readonly criteria: unknown;
  readonly criteriaArtifact: AflTradeArtifactRef;
}) {
  const finalEvidence = aflTradeNativePavFinalEvidenceSchema.parse(input.finalEvidence);
  const criteria = governedNativePlayerPavQualificationCriteriaSchema.parse(input.criteria);
  const configuration = aflTradeNativePavPreFinalConfigurationSchema.parse(
    input.calibrationConfiguration
  );
  if (
    finalEvidence.content.schemaVersion !== 'afl-trade-native-pav-final-evaluation/v2' ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.finalEvidenceArtifact, finalEvidence) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(input.criteriaArtifact, criteria) ||
    !doesAflTradeArtifactRefMatchCanonicalJson(
      input.calibrationConfigurationArtifact,
      configuration
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      finalEvidence.content.calibrationConfigurationArtifact,
      input.calibrationConfigurationArtifact
    ) ||
    configuration.intervalCoverage !== criteria.content.acceptanceCriteria.nominalIntervalCoverage
  ) {
    throw new RangeError(
      'Native player-PAV qualification evidence requires exact V5 parents and nominal coverage.'
    );
  }
  const selected = finalEvidence.content.baselineComparisons.filter(({ definitionArtifact }) =>
    doAflTradeArtifactRefsExactlyMatch(
      definitionArtifact,
      criteria.content.selectedBaselineDefinitionArtifact
    )
  );
  if (selected.length !== 1) {
    throw new RangeError('Native player-PAV qualification requires one exact selected baseline.');
  }
  const baseline = selected[0]!;
  const finalObservationIds = new Set(finalEvidence.content.finalObservationIds);
  const pairedObservationIds = new Set(baseline.pairedObservationIds);
  const excludedObservationIds = new Set(baseline.excludedObservationIds);
  if (
    finalObservationIds.size !== finalEvidence.content.finalObservationIds.length ||
    excludedObservationIds.size !== baseline.excludedObservationIds.length ||
    baseline.pairedObservationIds.some((id) => excludedObservationIds.has(id)) ||
    pairedObservationIds.size + excludedObservationIds.size !== finalObservationIds.size ||
    [...pairedObservationIds, ...excludedObservationIds].some(
      (id) => !finalObservationIds.has(id)
    ) ||
    canonicalizeAflTradeJson(aggregatePairedScores(baseline.pairedScores, 'primary')) !==
      canonicalizeAflTradeJson(baseline.primaryMetrics) ||
    canonicalizeAflTradeJson(aggregatePairedScores(baseline.pairedScores, 'baseline')) !==
      canonicalizeAflTradeJson(baseline.baselineMetrics)
  ) {
    throw new RangeError(
      'Native player-PAV qualification requires exhaustive paired support and exact comparison metrics.'
    );
  }
  const missingDistributionObservationIds = baseline.pairedScores
    .filter((row) =>
      [
        ...row.primary.annual,
        row.primary.cumulative,
        ...row.baseline.annual,
        row.baseline.cumulative,
      ].some((score) => score.distribution === null)
    )
    .map(({ observationId }) => observationId);
  const commonDistributionSupport =
    baseline.pairedScores.length > 0 && missingDistributionObservationIds.length === 0;
  const maePair = (index: 0 | 1 | 2 | 'cumulative') => {
    const candidate = mean(
      baseline.pairedScores.map((row) =>
        index === 'cumulative'
          ? row.primary.cumulative.absoluteError
          : row.primary.annual[index].absoluteError
      )
    );
    const baselineScore = mean(
      baseline.pairedScores.map((row) =>
        index === 'cumulative'
          ? row.baseline.cumulative.absoluteError
          : row.baseline.annual[index].absoluteError
      )
    );
    return candidate === null || baselineScore === null
      ? null
      : { candidate, baseline: baselineScore };
  };
  const coverage = (index: 0 | 1 | 2 | 'cumulative') =>
    commonDistributionSupport
      ? mean(
          baseline.pairedScores.map(
            (row) =>
              (index === 'cumulative'
                ? row.primary.cumulative.distribution
                : row.primary.annual[index].distribution)!.intervalCoverage
          )
        )
      : null;
  const cumulativeCrps = (() => {
    if (!commonDistributionSupport) return null;
    const candidate = mean(
      baseline.pairedScores.map((row) => row.primary.cumulative.distribution!.crps)
    );
    const baselineScore = mean(
      baseline.pairedScores.map((row) => row.baseline.cumulative.distribution!.crps)
    );
    return candidate === null || baselineScore === null
      ? null
      : { candidate, baseline: baselineScore };
  })();
  const acceptanceInput = aflTradeNativePavAcceptanceInputSchema.parse({
    schemaVersion: 'afl-trade-native-pav-acceptance-input/v1',
    cumulativeCrps,
    horizons: [
      { horizon: 'annual_1', coverage: coverage(0), mae: maePair(0) },
      { horizon: 'annual_2', coverage: coverage(1), mae: maePair(1) },
      { horizon: 'annual_3', coverage: coverage(2), mae: maePair(2) },
      { horizon: 'cumulative_3', coverage: coverage('cumulative'), mae: maePair('cumulative') },
    ],
    precision: null,
  });
  const assessment = assessAflTradeNativePavAcceptance(acceptanceInput);
  const content = governedNativePlayerPavQualificationEvidenceContentSchema.parse({
    schemaVersion: 'governed-native-player-pav-qualification-evidence/v1',
    authorityBoundary: 'authenticated_inconclusive_no_qualification_authority',
    finalEvaluationId: finalEvidence.evaluationId,
    finalEvidenceArtifact: input.finalEvidenceArtifact,
    criteriaId: criteria.criteriaId,
    criteriaArtifact: input.criteriaArtifact,
    acceptanceCriteriaId: criteria.content.acceptanceCriteriaId,
    calibrationConfigurationArtifact: input.calibrationConfigurationArtifact,
    nominalIntervalCoverage: configuration.intervalCoverage,
    selectedBaseline: {
      definitionKey: baseline.definitionKey,
      definitionArtifact: baseline.definitionArtifact,
      fitId: baseline.fitId,
      calibrationId: baseline.calibrationId,
    },
    support: {
      status:
        baseline.pairedScores.length === 0
          ? 'empty_paired_support'
          : commonDistributionSupport
            ? 'complete_common_distribution_support'
            : 'incomplete_distribution_support',
      pairedObservationIds: baseline.pairedObservationIds,
      excludedObservationIds: baseline.excludedObservationIds,
      missingDistributionObservationIds,
    },
    acceptanceInput,
    assessment,
    qualificationGranted: false,
  });
  return governedNativePlayerPavQualificationEvidenceSchema.parse({
    evidenceId: createAflTradeContentAddress('native-player-pav-qualification-evidence', content),
    content,
  });
}
