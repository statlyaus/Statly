import { z } from 'zod';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeNativePavPreFinalContentSchema,
  aflTradeNativePavPreFinalEvidenceSchema,
} from './admittedPlayerPavPreFinalContracts';
import { aflTradeNativePavValidationPlanEvidenceSchema } from './admittedPlayerPavValidationPlanContracts';
import { aflTradeAdmittedPlayerPavCandidateSchema } from './admittedPlayerPavCandidate';
import type { evaluateAflTradeAdmittedPlayerPavFinal } from './admittedPlayerPavFinalEvaluation';
import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  aflTradePlayerPavModelProtocolSchema,
  aflTradePlayerPavModelProtocolContentSchema,
  type AflTradePlayerPavModelProtocol,
} from '../artifacts/modelProtocol';

export const aflTradeNativePavMetricDefinitionSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-native-pav-metric-definition/v1'),
    definitionKey: z.string().trim().min(1).max(200),
    target: aflTradePlayerPavModelProtocolContentSchema.shape.target,
    evaluationPartitions: z.tuple([z.literal('validation'), z.literal('final_test')]),
    scopes: z.tuple([
      z.literal('annual_1'),
      z.literal('annual_2'),
      z.literal('annual_3'),
      z.literal('cumulative_3'),
    ]),
    metrics: z
      .array(
        z.enum([
          'bias',
          'mae',
          'rmse',
          'crps',
          'intervalCoverage',
          'intervalWidth',
          'intervalScore',
        ])
      )
      .min(1)
      .max(7)
      .refine(
        (values) => new Set(values).size === values.length,
        'Declared metrics must be unique.'
      ),
    pointError: z.literal('prediction_minus_observed'),
    distribution: z.literal('empirical_calibration_paths'),
    pointSupport: z.literal('available_forecasts_with_complete_observed_horizon'),
    distributionSupport: z.literal('point_support_with_available_calibration_paths'),
  })
  .strict();

/** Exact numerical declaration preflight, not model acceptance or a final-target access grant. */
export function interpretAflTradeNativePavMetricDefinitions(
  unparsedProtocol: AflTradePlayerPavModelProtocol,
  artifacts: readonly { reference: AflTradeArtifactRef; bytes: Uint8Array }[]
) {
  const protocol = aflTradePlayerPavModelProtocolSchema.parse(unparsedProtocol);
  const references = protocol.content.validationPlan.metricDefinitionArtifacts;
  const byId = new Map(artifacts.map((artifact) => [artifact.reference.artifactId, artifact]));
  if (
    byId.size !== artifacts.length ||
    artifacts.length !== references.length ||
    new Set(references.map((reference) => reference.artifactId)).size !== references.length
  )
    throw new RangeError('Native metric declarations require the exact registered artifact set.');
  const definitions = references.map((unparsed) => {
    const reference = aflTradeArtifactRefSchema.parse(unparsed);
    const retained = byId.get(reference.artifactId);
    if (
      !retained ||
      !doAflTradeArtifactRefsExactlyMatch(reference, retained.reference) ||
      !doesAflTradeArtifactRefMatchBytes(reference, retained.bytes, 'application/json')
    )
      throw new RangeError('Native metric declaration bytes differ from registered custody.');
    const definition = aflTradeNativePavMetricDefinitionSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(retained.bytes))
    );
    return { reference, definition };
  });
  if (
    new Set(definitions.map(({ definition }) => definition.definitionKey)).size !==
    definitions.length
  )
    throw new RangeError('Native metric declaration keys must be unique.');
  return definitions;
}

const shared = aflTradeNativePavPreFinalContentSchema.shape;
const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));
const finalForecasts = z
  .array(
    shared.validationForecasts.element.extend({
      partition: z.literal('final_test'),
    })
  )
  .max(100_000);
const baselineComparison = z
  .object({
    definitionArtifact: aflTradeArtifactRefSchema,
    definitionKey: z.string().min(1).max(200),
    fitId: id('player-pav-forecast-fit'),
    calibrationId: id('player-pav-empirical-calibration'),
    finalForecasts,
    finalMetrics: shared.validationMetrics,
    pairedObservationIds: shared.validationObservationIds,
    excludedObservationIds: shared.validationObservationIds,
    primaryMetrics: shared.validationMetrics,
    baselineMetrics: shared.validationMetrics,
  })
  .strict();
const finalContent = z
  .object({
    schemaVersion: z.literal('afl-trade-native-pav-final-evaluation/v1'),
    authorityBoundary: z.literal(
      'numerical_final_evidence_no_execution_completion_or_qualification_authority'
    ),
    publicationEligible: z.literal(false),
    intentId: shared.intentId,
    protocolId: shared.protocolId,
    datasetId: shared.datasetId,
    datasetAdmissionId: shared.datasetAdmissionId,
    observationSetId: shared.observationSetId,
    pavObservationSetId: shared.pavObservationSetId,
    methodId: shared.methodId,
    candidateId: shared.candidateId,
    candidateArtifact: shared.candidateArtifact,
    calibrationConfigurationArtifact: shared.calibrationConfigurationArtifact,
    finalTestStartedCheckpointId: id('model-run-checkpoint'),
    candidateLockedCheckpointId: id('model-run-checkpoint'),
    preFinalEvaluationId: id('native-pav-pre-final-evaluation'),
    preFinalArtifact: aflTradeArtifactRefSchema,
    calibrationId: id('player-pav-empirical-calibration'),
    finalObservationIds: shared.validationObservationIds,
    finalForecasts,
    finalMetrics: shared.validationMetrics,
    validationPlanArtifact: aflTradeArtifactRefSchema,
    validationPlanEvaluationId: id('native-pav-validation-plan-evidence'),
    baselineComparisons: z.array(baselineComparison).max(1000),
  })
  .strict();

const scoreContribution = z
  .object({
    error: z.number().finite(),
    absoluteError: z.number().finite().nonnegative(),
    squaredError: z.number().finite().nonnegative(),
    distribution: z
      .object({
        crps: z.number().finite(),
        intervalCoverage: z.union([z.literal(0), z.literal(1)]),
        intervalWidth: z.number().finite().nonnegative(),
        intervalScore: z.number().finite().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();
const observationScores = z
  .object({
    annual: z.array(scoreContribution).length(3),
    cumulative: scoreContribution,
  })
  .strict();
const pairedScore = z
  .object({
    observationId: shared.validationObservationIds.element,
    playerId: shared.validationForecasts.element.shape.playerId,
    predictionSeason: shared.validationForecasts.element.shape.predictionSeason,
    partition: z.literal('final_test'),
    primary: observationScores,
    baseline: observationScores,
  })
  .strict();
const finalContentV2 = finalContent
  .extend({
    schemaVersion: z.literal('afl-trade-native-pav-final-evaluation/v2'),
    baselineComparisons: z
      .array(
        baselineComparison
          .extend({
            pairedScores: z.array(pairedScore).max(100_000),
          })
          .strict()
          .refine(
            (comparison) =>
              new Set(comparison.pairedObservationIds).size ===
                comparison.pairedObservationIds.length &&
              canonicalizeAflTradeJson(comparison.pairedScores.map((row) => row.observationId)) ===
                canonicalizeAflTradeJson(comparison.pairedObservationIds),
            'Paired score evidence requires exact unique paired observation membership.'
          )
      )
      .max(1000),
  })
  .strict()
  .superRefine((content, context) => {
    const primary = new Map(
      content.finalForecasts.map((forecast) => [forecast.observationId, forecast])
    );
    for (const [index, comparison] of content.baselineComparisons.entries()) {
      const baseline = new Map(
        comparison.finalForecasts.map((forecast) => [forecast.observationId, forecast])
      );
      for (const [rowIndex, row] of comparison.pairedScores.entries()) {
        if (
          [primary.get(row.observationId), baseline.get(row.observationId)].some(
            (forecast) =>
              !forecast ||
              forecast.playerId !== row.playerId ||
              forecast.predictionSeason !== row.predictionSeason
          )
        )
          context.addIssue({
            code: 'custom',
            path: ['baselineComparisons', index, 'pairedScores', rowIndex],
            message: 'Paired score dependence keys must match both retained forecasts.',
          });
      }
    }
  });

/** Content custody validation only; this schema cannot certify evaluation or qualification. */
export const aflTradeNativePavFinalEvidenceSchema = z
  .object({
    evaluationId: id('native-pav-final-evaluation'),
    content: z.discriminatedUnion('schemaVersion', [finalContent, finalContentV2]),
  })
  .strict()
  .refine(
    (report) =>
      report.evaluationId ===
      createAflTradeContentAddress('native-pav-final-evaluation', report.content)
  );

/** Assemble numerical evidence only: no target extraction, refit, rescore, persistence or qualification. */
export function createAflTradeNativePavReportDocuments(input: {
  parents: Parameters<typeof evaluateAflTradeAdmittedPlayerPavFinal>[0];
  finalEvidence: unknown;
  metricDefinitionArtifacts: readonly { reference: AflTradeArtifactRef; bytes: Uint8Array }[];
}) {
  const { parents } = input;
  const protocol = aflTradePlayerPavModelProtocolSchema.parse(parents.fitInput.protocol);
  const definitions = interpretAflTradeNativePavMetricDefinitions(
    protocol,
    input.metricDefinitionArtifacts
  );
  const candidate = aflTradeAdmittedPlayerPavCandidateSchema.parse(parents.candidate);
  const preFinal = aflTradeNativePavPreFinalEvidenceSchema.parse(parents.preFinalEvidence);
  const plan = aflTradeNativePavValidationPlanEvidenceSchema.parse(parents.validationPlanEvidence);
  const final = aflTradeNativePavFinalEvidenceSchema.parse(input.finalEvidence);
  const same = (a: unknown, b: unknown) =>
    canonicalizeAflTradeJson(a) === canonicalizeAflTradeJson(b);
  const exact = (reference: AflTradeArtifactRef, document: unknown) =>
    doesAflTradeArtifactRefMatchBytes(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(document)),
      'application/json'
    );
  const bindings = {
    intentId: parents.fitInput.intent.intentId,
    protocolId: protocol.protocolId,
    datasetId: parents.fitInput.datasetCandidate.datasetId,
    datasetAdmissionId: parents.fitInput.intent.content.datasetAdmissionId,
    observationSetId: parents.fitInput.observationSet.observationSetId,
    pavObservationSetId: parents.fitInput.pavObservationSet.observationSetId,
    methodId: parents.fitInput.hpnMethod.methodId,
    candidateId: candidate.candidateId,
    candidateArtifact: parents.candidateArtifact,
    calibrationConfigurationArtifact: parents.calibrationConfigurationArtifact,
  };
  const selected = parents.fitInput.observationSet.content.observations.map(
    ({ pavObservation }) => pavObservation
  );
  const ids = (partition: string) =>
    selected.filter((row) => row.partition === partition).map((row) => row.observationId);
  const {
    candidateId: _candidateId,
    candidateArtifact: _candidateArtifact,
    calibrationConfigurationArtifact: _calibrationArtifact,
    ...commonParents
  } = bindings;
  const planParents = {
    ...commonParents,
    primaryCandidateId: candidate.candidateId,
    primaryPreFinalEvaluationId: preFinal.evaluationId,
    calibrationConfigurationArtifact: parents.calibrationConfigurationArtifact,
  };
  if (
    Object.entries(commonParents).some(
      ([key, value]) => !same(candidate.content[key as keyof typeof candidate.content], value)
    ) ||
    Object.entries(planParents).some(
      ([key, value]) => !same(plan.content[key as keyof typeof plan.content], value)
    ) ||
    !same(
      candidate.content.configurationArtifact,
      parents.fitInput.intent.content.configurationArtifact
    ) ||
    !same(candidate.content.trainingObservationIds, ids('train')) ||
    Object.entries(bindings).some(
      ([key, value]) =>
        !same(final.content[key as keyof typeof final.content], value) ||
        !same(preFinal.content[key as keyof typeof preFinal.content], value)
    ) ||
    !exact(parents.candidateArtifact, candidate) ||
    !exact(parents.preFinalArtifact, preFinal) ||
    !exact(parents.validationPlanArtifact, plan) ||
    !same(final.content.preFinalArtifact, parents.preFinalArtifact) ||
    !same(final.content.validationPlanArtifact, parents.validationPlanArtifact) ||
    final.content.preFinalEvaluationId !== preFinal.evaluationId ||
    final.content.validationPlanEvaluationId !== plan.evaluationId ||
    final.content.calibrationId !== preFinal.content.calibrationState.calibrationId ||
    final.content.candidateLockedCheckpointId !== parents.candidateLockedCheckpoint.checkpointId ||
    final.content.finalTestStartedCheckpointId !==
      parents.finalTestStartedCheckpoint.checkpointId ||
    !same(final.content.finalObservationIds, ids('final_test')) ||
    !same(preFinal.content.validationObservationIds, ids('validation'))
  )
    throw new RangeError(
      'Native reports require exact retained numerical parents and selected membership.'
    );
  const baselineStates = plan.content.evaluations.filter((item) => item.kind === 'baseline');
  if (
    baselineStates.length !== final.content.baselineComparisons.length ||
    baselineStates.some((state, index) => {
      const result = final.content.baselineComparisons[index]!;
      return (
        result.fitId !== state.fitState.fitId ||
        result.calibrationId !== state.calibrationState.calibrationId ||
        result.definitionKey !== state.definition.definitionKey ||
        !same(result.definitionArtifact, state.definitionArtifact)
      );
    })
  )
    throw new RangeError('Native baseline reports differ from retained pre-final states.');
  const report = <K extends string, P extends object>(kind: K, payload: P) => {
    const content = {
      schemaVersion: `afl-trade-native-pav-${kind}-report/v1` as const,
      authorityBoundary: 'numerical_evidence_no_execution_or_qualification_authority' as const,
      publicationEligible: false as const,
      ...bindings,
      finalEvaluationId: final.evaluationId,
      ...payload,
    };
    return { reportId: createAflTradeContentAddress('native-pav-report', content), content };
  };
  const forecastIds = new Set(final.content.finalForecasts.map((row) => row.observationId));
  return {
    modelArtifact: candidate,
    selectionValidationReportArtifact: preFinal,
    validationReportArtifact: final,
    baselineComparisonArtifact: report('baseline-comparison', {
      evaluatedPartition: 'final_test' as const,
      comparisons: final.content.baselineComparisons,
    }),
    calibrationReportArtifact: report('calibration', {
      fitPartition: 'calibration' as const,
      state: preFinal.content.calibrationState,
    }),
    intervalCoverageArtifact: report('interval-coverage', {
      evaluatedPartition: 'final_test' as const,
      declaredMetrics: definitions,
      metrics: final.content.finalMetrics,
      forecasts: final.content.finalForecasts.map(
        ({ observationId, historySupport, distribution }) => ({
          observationId,
          historySupport,
          distributionSupport:
            distribution.state === 'unavailable'
              ? distribution
              : {
                  state: distribution.state,
                  calibrationObservationCount: distribution.calibrationObservationIds.length,
                  nominalCoverage: distribution.nominalCoverage,
                },
        })
      ),
    }),
    subgroupReportArtifact: report('subgroup', {
      evaluatedPartition: 'final_test' as const,
      dimensions: protocol.content.validationPlan.subgroupDimensions.map((dimension) => ({
        dimension,
        state: 'unsupported' as const,
        reason: 'no_admitted_grouping_evidence' as const,
      })),
    }),
    sensitivityReportArtifact: report('sensitivity', {
      evaluatedPartition: 'validation' as const,
      evaluations: plan.content.evaluations.filter((item) => item.kind === 'sensitivity'),
    }),
    leakageAuditArtifact: report('leakage-audit', {
      state: 'retained_partition_membership' as const,
      knowledgePolicy: parents.fitInput.observationSet.content.featureKnowledgePolicy,
      trainingObservationIds: candidate.content.trainingObservationIds,
      calibrationObservationIds: preFinal.content.calibrationState.content.residuals.map(
        (row) => row.observationId
      ),
      validationObservationIds: preFinal.content.validationObservationIds,
      finalObservationIds: final.content.finalObservationIds,
      calibrationEvaluationCutoff: preFinal.content.calibrationState.content.evaluationCutoff,
      candidateLockedCheckpointId: final.content.candidateLockedCheckpointId,
      finalTestStartedCheckpointId: final.content.finalTestStartedCheckpointId,
    }),
    modelCardArtifact: report('model-card', {
      target: protocol.content.target,
      fitStateId: candidate.content.fitState.fitId,
      configurationArtifact: candidate.content.configurationArtifact,
      limitations: protocol.content.limitations,
      qualificationState: 'not_evaluated' as const,
    }),
    diagnosticsArtifact: report('diagnostics', {
      selectedObservations: selected.length,
      finalObservationIds: final.content.finalObservationIds,
      forecastObservationIds: final.content.finalForecasts.map((row) => row.observationId),
      unforecastObservationIds: final.content.finalObservationIds.filter(
        (id) => !forecastIds.has(id)
      ),
      comparableObservations: final.content.finalMetrics.observationCount,
      unsupportedDistributions: final.content.finalForecasts
        .filter((row) => row.distribution.state === 'unavailable')
        .map((row) => ({ observationId: row.observationId, distribution: row.distribution })),
    }),
  };
}
export type AflTradeNativePavReportDocuments = ReturnType<
  typeof createAflTradeNativePavReportDocuments
>;

/** Exact full-family readback, including unknown-field rejection, without numerical reexecution. */
export function authenticateAflTradeNativePavReportDocuments(
  unparsed: unknown,
  input: Parameters<typeof createAflTradeNativePavReportDocuments>[0]
): AflTradeNativePavReportDocuments {
  const expected = createAflTradeNativePavReportDocuments(input);
  if (canonicalizeAflTradeJson(unparsed) !== canonicalizeAflTradeJson(expected))
    throw new RangeError('Retained bytes must contain the exact native report documents.');
  return expected;
}
