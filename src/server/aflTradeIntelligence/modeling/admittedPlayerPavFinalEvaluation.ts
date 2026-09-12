import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  aflTradeAnyModelRunCheckpointSchema as aflTradeModelRunCheckpointSchema,
  createAflTradeModelRunCheckpoint,
  createAflTradeModelRunCheckpointV2,
  type AflTradeAnyModelRunCheckpoint as AflTradeModelRunCheckpoint,
} from '../artifacts/modelRunCheckpoint';
import {
  aflTradeModelRunIntentSchema,
  type AflTradeModelRunIntent,
} from '../artifacts/modelRunManifest';
import { restoreAflTradeAdmittedPlayerPavCandidate } from './admittedPlayerPavCandidate';
import { aflTradeNativePavPreFinalEvidenceSchema } from './admittedPlayerPavPreFinalContracts';
import {
  aflTradeNativePavPreFinalConfigurationSchema,
  type AflTradeNativePavPreFinalInput,
} from './admittedPlayerPavPreFinalEvaluation';
import { preparePlayerPavForecastRows } from './playerPavForecastDesign';
import { aflTradeNativePavValidationPlanEvidenceSchema } from './admittedPlayerPavValidationPlanContracts';
import { evaluateAflTradeNativePavFinalBaselines } from './admittedPlayerPavValidationPlan';
import {
  applyPlayerPavEmpiricalCalibration,
  evaluatePlayerPavForecastPartition,
} from './playerPavForecastEvaluation';

/** Numerical utility only. The caller must already hold authenticated committed-start context.
 * A caller-supplied checkpoint is not an execution grant. This utility does not persist completion,
 * fit, select, recalibrate, or qualify a model. Canonical parent custody is still authenticated.
 */
export function evaluateAflTradeAdmittedPlayerPavFinal(
  input: AflTradeNativePavPreFinalInput & {
    preFinalEvidence: unknown;
    preFinalArtifact: AflTradeArtifactRef;
    validationPlanEvidence: unknown;
    validationPlanArtifact: AflTradeArtifactRef;
    candidateCustodyBytes: Uint8Array;
    candidateLockedCheckpoint: AflTradeModelRunCheckpoint;
    finalTestStartedCheckpoint: AflTradeModelRunCheckpoint;
    executionIntent?: AflTradeModelRunIntent;
  }
) {
  const locked = aflTradeModelRunCheckpointSchema.parse(input.candidateLockedCheckpoint);
  const start = aflTradeModelRunCheckpointSchema.parse(input.finalTestStartedCheckpoint);
  const executionIntent = aflTradeModelRunIntentSchema.parse(
    input.executionIntent ?? input.fitInput.intent
  );
  const continuation =
    executionIntent.content.schemaVersion === 'afl-trade-model-run-intent/v2'
      ? executionIntent.content.continuation
      : null;
  const immutableInputs = (intent: AflTradeModelRunIntent) => ({
    ...intent.content,
    schemaVersion: 'numerical-root-inputs',
    continuation: null,
    startedAt: null,
    modelTrainingEvaluationReceiptIds: [],
    job: { ...intent.content.job, attempt: 0 },
  });
  const preFinal = aflTradeNativePavPreFinalEvidenceSchema.parse(input.preFinalEvidence);
  const preFinalArtifact = aflTradeArtifactRefSchema.parse(input.preFinalArtifact);
  const validationPlan = aflTradeNativePavValidationPlanEvidenceSchema.parse(
    input.validationPlanEvidence
  );
  const validationPlanArtifact = aflTradeArtifactRefSchema.parse(input.validationPlanArtifact);
  const same = (left: unknown, right: unknown) =>
    canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  const exactDocument = (reference: AflTradeArtifactRef, document: unknown) =>
    doesAflTradeArtifactRefMatchBytes(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(document)),
      'application/json'
    );
  if (
    locked.content.stage !== 'candidate_locked' ||
    start.content.stage !== 'final_test_started' ||
    !same(immutableInputs(executionIntent), immutableInputs(input.fitInput.intent)) ||
    (continuation
      ? continuation.rootIntentId !== input.fitInput.intent.intentId
      : executionIntent.intentId !== input.fitInput.intent.intentId ||
        locked.content.intentId !== executionIntent.intentId) ||
    start.content.intentId !== executionIntent.intentId ||
    start.content.substantiveOperationId !== executionIntent.content.job.jobId ||
    start.content.dispatchAttemptNumber !== executionIntent.content.job.attempt ||
    (continuation &&
      (start.content.dispatchRequestId !== continuation.dispatchRequestId ||
        start.content.dispatchClaimId !== continuation.dispatchClaimId ||
        start.content.dispatchAttemptNumber !== continuation.dispatchAttemptNumber)) ||
    Date.parse(start.content.recordedAt) < Date.parse(executionIntent.content.startedAt) ||
    locked.content.rootIntentId !== input.fitInput.intent.intentId ||
    Date.parse(start.content.recordedAt) < Date.parse(locked.content.recordedAt) ||
    !same(
      start,
      (locked.content.schemaVersion === 'afl-trade-model-run-checkpoint/v2'
        ? createAflTradeModelRunCheckpointV2
        : createAflTradeModelRunCheckpoint)({
        ...locked.content,
        ...(continuation
          ? {
              intentId: executionIntent.intentId,
              authorizationId: start.content.authorizationId,
              dispatchClaimId: continuation.dispatchClaimId,
              dispatchAttemptNumber: continuation.dispatchAttemptNumber,
            }
          : {}),
        stage: 'final_test_started',
        previousCheckpointId: locked.checkpointId,
        recordedAt: start.content.recordedAt,
      })
    ) ||
    !locked.content.candidateArtifact ||
    !locked.content.evidenceArtifact ||
    !doAflTradeArtifactRefsExactlyMatch(
      locked.content.candidateArtifact,
      input.candidateArtifact
    ) ||
    !exactDocument(input.candidateArtifact, input.candidate) ||
    !exactDocument(preFinalArtifact, preFinal) ||
    !exactDocument(validationPlanArtifact, validationPlan) ||
    Date.parse(validationPlanArtifact.createdAt) > Date.parse(locked.content.recordedAt) ||
    Date.parse(preFinalArtifact.createdAt) > Date.parse(locked.content.recordedAt) ||
    !doesAflTradeArtifactRefMatchBytes(
      locked.content.evidenceArtifact,
      input.candidateCustodyBytes,
      'application/json'
    )
  )
    throw new RangeError(
      'Native final evaluation requires exact locked candidate, pre-final custody and start bindings.'
    );
  const restored = restoreAflTradeAdmittedPlayerPavCandidate(input.candidate, input.fitInput);
  const custody = {
    schemaVersion: 'afl-trade-native-pav-candidate-custody/v3',
    authorityBoundary: 'pre_final_numerical_evidence_no_final_test_or_qualification',
    rootIntentId: input.fitInput.intent.intentId,
    fitIntentId: input.fitInput.intent.intentId,
    candidateId: restored.candidate.candidateId,
    candidateArtifact: input.candidateArtifact,
    preFinalArtifact,
    validationPlanArtifact,
  };
  if (!same(JSON.parse(new TextDecoder().decode(input.candidateCustodyBytes)), custody))
    throw new RangeError('Native final evaluation requires exact v3 pre-final candidate custody.');
  const expected = {
    intentId: input.fitInput.intent.intentId,
    protocolId: input.fitInput.protocol.protocolId,
    datasetId: input.fitInput.datasetCandidate.datasetId,
    datasetAdmissionId: input.fitInput.intent.content.datasetAdmissionId,
    observationSetId: input.fitInput.observationSet.observationSetId,
    pavObservationSetId: input.fitInput.pavObservationSet.observationSetId,
    methodId: input.fitInput.hpnMethod.methodId,
    candidateId: restored.candidate.candidateId,
    candidateArtifact: input.candidateArtifact,
    calibrationConfigurationArtifact: input.calibrationConfigurationArtifact,
  };
  if (
    Object.entries(expected).some(
      ([key, value]) => !same(preFinal.content[key as keyof typeof preFinal.content], value)
    ) ||
    !doAflTradeArtifactRefsExactlyMatch(
      input.calibrationConfigurationArtifact,
      input.fitInput.protocol.content.validationPlan.intervalCalibrationArtifact
    ) ||
    !doesAflTradeArtifactRefMatchBytes(
      input.calibrationConfigurationArtifact,
      input.calibrationConfigurationBytes,
      'application/json'
    )
  )
    throw new RangeError(
      'Native final evaluation differs from exact pre-final parents or configuration.'
    );
  const configuration = aflTradeNativePavPreFinalConfigurationSchema.parse(
    JSON.parse(new TextDecoder().decode(input.calibrationConfigurationBytes))
  );
  const historySeasons = restored.candidate.content.fitState.content.historySeasons;
  const state = preFinal.content.calibrationState;
  if (
    state.content.historySeasons !== historySeasons ||
    state.content.minimumCalibrationObservations !== configuration.minimumCalibrationObservations ||
    state.content.intervalCoverage !== configuration.intervalCoverage
  )
    throw new RangeError(
      'Native final evaluation calibration differs from declared configuration.'
    );
  const selected = new Set(
    input.fitInput.observationSet.content.observations.map(
      ({ pavObservation }) => pavObservation.observationId
    )
  );
  const selectedOriginal = input.fitInput.pavObservationSet.content.observations.filter((row) =>
    selected.has(row.observationId)
  );
  const validation = selectedOriginal.filter((row) => row.partition === 'validation');
  const cutoff = Math.min(...validation.map((row) => Date.parse(row.predictionCutoffAt)));
  const calibrationIds = new Set(
    selectedOriginal
      .filter((row) => row.partition === 'calibration')
      .map((row) => row.observationId)
  );
  const planParents = {
    ...expected,
    primaryCandidateId: expected.candidateId,
    primaryPreFinalEvaluationId: preFinal.evaluationId,
  };
  const {
    candidateId: _candidateId,
    candidateArtifact: _candidateArtifact,
    ...expectedPlanParents
  } = planParents;
  const declarations = [
    ...input.fitInput.protocol.content.validationPlan.baselineDefinitionArtifacts.map(
      (reference) => ({ kind: 'baseline', reference })
    ),
    ...input.fitInput.protocol.content.validationPlan.sensitivityAnalysisArtifacts.map(
      (reference) => ({ kind: 'sensitivity', reference })
    ),
  ];
  const trainingIds = selectedOriginal
    .filter((row) => row.partition === 'train')
    .map((row) => row.observationId);
  if (
    Object.entries(expectedPlanParents).some(
      ([key, value]) =>
        !same(validationPlan.content[key as keyof typeof validationPlan.content], value)
    ) ||
    validationPlan.content.evaluations.length !== declarations.length
  )
    throw new RangeError('Native final validation plan differs from exact pre-final parents.');
  for (const [index, item] of validationPlan.content.evaluations.entries()) {
    const declaration = declarations[index]!;
    const calibrated = item.calibrationState.content;
    if (
      item.kind !== declaration.kind ||
      !same(item.definitionArtifact, declaration.reference) ||
      !same(item.trainingObservationIds, trainingIds) ||
      Object.entries(item.definition.candidate).some(
        ([key, value]) =>
          !same(item.fitState.content[key as keyof typeof item.fitState.content], value)
      ) ||
      calibrated.historySeasons !== item.definition.candidate.historySeasons ||
      calibrated.evaluationCutoff !== state.content.evaluationCutoff ||
      calibrated.minimumCalibrationObservations !== configuration.minimumCalibrationObservations ||
      calibrated.intervalCoverage !== configuration.intervalCoverage ||
      new Set(calibrated.residuals.map((row) => row.observationId)).size !==
        calibrated.residuals.length ||
      calibrated.residuals.some((row) => !calibrationIds.has(row.observationId))
    )
      throw new RangeError(
        'Native final baseline differs from locked declaration, fit or calibration.'
      );
  }
  if (
    state.content.evaluationCutoff !== (Number.isFinite(cutoff) ? cutoff : null) ||
    !same(
      preFinal.content.validationObservationIds,
      validation.map((row) => row.observationId)
    ) ||
    new Set(state.content.residuals.map((row) => row.observationId)).size !==
      state.content.residuals.length ||
    state.content.residuals.some((row) => !calibrationIds.has(row.observationId)) ||
    selectedOriginal.some(
      (row) =>
        row.partition === 'final_test' &&
        (state.content.evaluationCutoff === null ||
          Date.parse(row.predictionCutoffAt) < state.content.evaluationCutoff)
    )
  )
    throw new RangeError(
      'Native final evaluation requires exact retained calibration membership and cutoff.'
    );
  // No calibration/validation numerical targets are opened here; their retained evidence was
  // authenticated before the start by the execution owner, not recreated after the lock.
  const rows = preparePlayerPavForecastRows(
    input.fitInput.pavObservationSet,
    {
      featureHistories: [
        ...new Set([
          historySeasons,
          ...validationPlan.content.evaluations
            .filter((item) => item.kind === 'baseline')
            .map((item) => item.definition.candidate.historySeasons),
        ]),
      ],
      knowledgePolicy: input.fitInput.pavObservationSet.content.knowledgePolicy
        ? 'retrospective_finalized_measurements'
        : 'calculated_by_origin',
    },
    ['final_test'],
    [...selected]
  ).filter((row) => row.partition === 'final_test' && selected.has(row.observationId));
  const forecasts = applyPlayerPavEmpiricalCalibration(
    rows,
    { predict: (row) => restored.predict(row.observationId).annualPav },
    state
  );
  const content = {
    schemaVersion: 'afl-trade-native-pav-final-evaluation/v2' as const,
    authorityBoundary:
      'numerical_final_evidence_no_execution_completion_or_qualification_authority' as const,
    publicationEligible: false as const,
    ...expected,
    finalTestStartedCheckpointId: start.checkpointId,
    candidateLockedCheckpointId: locked.checkpointId,
    preFinalEvaluationId: preFinal.evaluationId,
    preFinalArtifact,
    calibrationId: state.calibrationId,
    finalObservationIds: rows.map((row) => row.observationId),
    finalForecasts: forecasts,
    finalMetrics: evaluatePlayerPavForecastPartition(rows, forecasts, configuration, 'final_test'),
    validationPlanArtifact,
    validationPlanEvaluationId: validationPlan.evaluationId,
    baselineComparisons: evaluateAflTradeNativePavFinalBaselines(
      validationPlan,
      rows,
      forecasts,
      configuration
    ),
  };
  return {
    evaluationId: createAflTradeContentAddress('native-pav-final-evaluation', content),
    content,
  };
}
