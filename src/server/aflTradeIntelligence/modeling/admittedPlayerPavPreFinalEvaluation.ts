import { z } from 'zod';
import {
  aflTradeNativePavValidationPlanEvidenceSchema,
  authenticateAflTradeNativePavValidationPlanRows,
} from './admittedPlayerPavValidationPlanContracts';
import {
  interpretAflTradeNativePavValidationDefinitions,
  evaluateAflTradeNativePavValidationDefinitions,
  type AflTradeNativePavDefinitionArtifact,
} from './admittedPlayerPavValidationPlan';
import { aflTradeNativePavPreFinalEvidenceSchema } from './admittedPlayerPavPreFinalContracts';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  doesAflTradeArtifactRefMatchBytes,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  restoreAflTradeAdmittedPlayerPavCandidate,
  type AflTradeAdmittedPlayerPavFitInput,
} from './admittedPlayerPavCandidate';
import {
  playerPavForecastConfigurationSchema,
  preparePlayerPavForecastRows,
} from './playerPavForecastDesign';
import {
  applyPlayerPavEmpiricalCalibration,
  evaluatePlayerPavForecastPartition,
  fitPlayerPavEmpiricalCalibration,
} from './playerPavForecastEvaluation';

export const aflTradeNativePavPreFinalConfigurationSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-native-pav-pre-final-config/v1'),
    method: z.literal('empirical_calibration_residual_paths'),
    minimumCalibrationObservations:
      playerPavForecastConfigurationSchema.shape.minimumCalibrationObservations,
    intervalCoverage: playerPavForecastConfigurationSchema.shape.intervalCoverage,
  })
  .strict();

/** Numerical evidence only. The caller must already possess authenticated native inputs.
 * This does not consume run authority, persist a candidate lock, or grant final-test access.
 */
export interface AflTradeNativePavPreFinalInput {
  fitInput: AflTradeAdmittedPlayerPavFitInput;
  candidate: unknown;
  candidateArtifact: AflTradeArtifactRef;
  calibrationConfigurationArtifact: AflTradeArtifactRef;
  calibrationConfigurationBytes: Uint8Array;
}
function authenticateParents(input: AflTradeNativePavPreFinalInput) {
  const candidateBytes = new TextEncoder().encode(canonicalizeAflTradeJson(input.candidate));
  if (
    !doesAflTradeArtifactRefMatchBytes(
      input.candidateArtifact,
      candidateBytes,
      'application/json'
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
      'Native pre-final evaluation requires exact retained candidate and calibration configuration bytes.'
    );
  const configuration = aflTradeNativePavPreFinalConfigurationSchema.parse(
    JSON.parse(new TextDecoder().decode(input.calibrationConfigurationBytes))
  );
  const restored = restoreAflTradeAdmittedPlayerPavCandidate(input.candidate, input.fitInput);
  const historySeasons = restored.candidate.content.fitState.content.historySeasons;
  const selectedIds = new Set(
    input.fitInput.observationSet.content.observations.map(
      ({ pavObservation }) => pavObservation.observationId
    )
  );
  const rows = preparePlayerPavForecastRows(
    input.fitInput.pavObservationSet,
    {
      featureHistories: [historySeasons],
      knowledgePolicy: input.fitInput.pavObservationSet.content.knowledgePolicy
        ? 'retrospective_finalized_measurements'
        : 'calculated_by_origin',
    },
    ['calibration', 'validation'],
    [...selectedIds]
  ).filter((row) => selectedIds.has(row.observationId));
  return { configuration, restored, historySeasons, rows };
}

export function evaluateAflTradeAdmittedPlayerPavPreFinal(input: AflTradeNativePavPreFinalInput) {
  const { configuration, restored, historySeasons, rows } = authenticateParents(input);
  const fitted = {
    predict: (row: (typeof rows)[number]) => restored.predict(row.observationId).annualPav,
  };
  const calibrationState = fitPlayerPavEmpiricalCalibration(
    rows,
    fitted,
    historySeasons,
    configuration
  );
  const validationRows = rows.filter((row) => row.partition === 'validation');
  const validationForecasts = applyPlayerPavEmpiricalCalibration(
    validationRows,
    fitted,
    calibrationState
  );
  const content = {
    schemaVersion: 'afl-trade-native-pav-pre-final-evaluation/v1' as const,
    authorityBoundary:
      'numerical_pre_final_evidence_no_execution_or_qualification_authority' as const,
    publicationEligible: false as const,
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
    calibrationState,
    validationObservationIds: validationRows.map((row) => row.observationId),
    validationForecasts,
    validationMetrics: evaluatePlayerPavForecastPartition(
      validationRows,
      validationForecasts,
      configuration,
      'validation'
    ),
  };
  return aflTradeNativePavPreFinalEvidenceSchema.parse({
    evaluationId: createAflTradeContentAddress('native-pav-pre-final-evaluation', content),
    content,
  });
}

/** Authenticates retained numerical evidence; never fits, predicts, calibrates or scores. */
export function authenticateAflTradeAdmittedPlayerPavPreFinalEvidence(
  unparsed: unknown,
  input: AflTradeNativePavPreFinalInput
) {
  const report = aflTradeNativePavPreFinalEvidenceSchema.parse(unparsed);
  const { configuration, restored, historySeasons, rows } = authenticateParents(input);
  const actual = report.content;
  const same = (left: unknown, right: unknown) =>
    canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  const expectedParents = {
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
    Object.entries(expectedParents).some(
      ([key, value]) => !same(actual[key as keyof typeof actual], value)
    )
  )
    throw new RangeError('Retained native pre-final report differs from exact parents.');
  const validation = rows.filter((row) => row.partition === 'validation');
  const cutoff = Math.min(...validation.map((row) => row.cutoff));
  const calibration = rows.filter(
    (row) =>
      row.partition === 'calibration' &&
      row.target !== null &&
      row.forecastUnavailable === null &&
      row.labelAvailableAt < cutoff &&
      row.history.slice(-historySeasons).every((value) => value !== null)
  );
  const state = actual.calibrationState.content;
  if (
    state.historySeasons !== historySeasons ||
    state.minimumCalibrationObservations !== configuration.minimumCalibrationObservations ||
    state.intervalCoverage !== configuration.intervalCoverage ||
    state.evaluationCutoff !== (Number.isFinite(cutoff) ? cutoff : null) ||
    !same(
      state.residuals.map((row) => row.observationId),
      calibration.map((row) => row.observationId)
    ) ||
    !same(
      actual.validationObservationIds,
      validation.map((row) => row.observationId)
    ) ||
    !same(
      actual.validationForecasts.map((row) => row.observationId),
      validation.filter((row) => row.forecastUnavailable === null).map((row) => row.observationId)
    )
  )
    throw new RangeError(
      'Retained native pre-final report differs from exact calibration or validation membership.'
    );
  const validationById = new Map(validation.map((row) => [row.observationId, row]));
  for (const forecast of actual.validationForecasts) {
    const row = validationById.get(forecast.observationId)!;
    if (forecast.playerId !== row.playerId || forecast.predictionSeason !== row.predictionSeason)
      throw new RangeError('Retained native pre-final forecast identity differs.');
    if (
      forecast.distribution.state === 'empirical_calibration_paths' &&
      (forecast.distribution.nominalCoverage !== configuration.intervalCoverage ||
        !same(
          forecast.distribution.calibrationObservationIds,
          state.residuals.map((row) => row.observationId)
        ) ||
        forecast.distribution.annualDraws.length !== state.residuals.length ||
        forecast.distribution.totalDraws.length !== state.residuals.length)
    )
      throw new RangeError(
        'Retained native pre-final predictive paths differ from calibration membership.'
      );
  }
  return report;
}

/** Numerical pre-final report, not a durable candidate lock or scientific qualification. */
interface ValidationPlanInput {
  preFinalInput: AflTradeNativePavPreFinalInput;
  preFinalEvidence: unknown;
  definitionArtifacts: readonly AflTradeNativePavDefinitionArtifact[];
}
function validationPlanParents(input: ValidationPlanInput, fitting = false) {
  const report = authenticateAflTradeAdmittedPlayerPavPreFinalEvidence(
    input.preFinalEvidence,
    input.preFinalInput
  );
  const { fitInput } = input.preFinalInput;
  const definitions = interpretAflTradeNativePavValidationDefinitions(
    fitInput.protocol,
    input.definitionArtifacts
  );
  const configuration = aflTradeNativePavPreFinalConfigurationSchema.parse(
    JSON.parse(new TextDecoder().decode(input.preFinalInput.calibrationConfigurationBytes))
  );
  const selected = new Set(
    fitInput.observationSet.content.observations.map((row) => row.pavObservation.observationId)
  );
  const rows = preparePlayerPavForecastRows(
    fitInput.pavObservationSet,
    {
      featureHistories: [
        ...new Set(definitions.map((item) => item.definition.candidate.historySeasons)),
      ],
      knowledgePolicy: fitInput.pavObservationSet.content.knowledgePolicy
        ? 'retrospective_finalized_measurements'
        : 'calculated_by_origin',
    },
    fitting ? ['train', 'calibration', 'validation'] : ['calibration', 'validation'],
    [...selected]
  ).filter((row) => selected.has(row.observationId));
  return { report, fitInput, definitions, configuration, rows };
}
export function authenticateAflTradeAdmittedPlayerPavValidationPlan(
  unparsed: unknown,
  input: ValidationPlanInput
) {
  const parents = validationPlanParents(input);
  return authenticateAflTradeNativePavValidationPlanRows(unparsed, {
    ...parents,
    preFinal: parents.report,
  });
}
export function prepareAflTradeAdmittedPlayerPavValidationPlan(input: ValidationPlanInput) {
  const { report, fitInput, definitions, configuration, rows } = validationPlanParents(input, true);
  const content = {
    schemaVersion: 'afl-trade-native-pav-validation-plan-evidence/v1' as const,
    authorityBoundary:
      'numerical_pre_final_validation_plan_no_execution_or_qualification_authority' as const,
    publicationEligible: false as const,
    intentId: fitInput.intent.intentId,
    protocolId: fitInput.protocol.protocolId,
    datasetId: fitInput.datasetCandidate.datasetId,
    datasetAdmissionId: fitInput.intent.content.datasetAdmissionId,
    observationSetId: fitInput.observationSet.observationSetId,
    pavObservationSetId: fitInput.pavObservationSet.observationSetId,
    methodId: fitInput.hpnMethod.methodId,
    primaryCandidateId: report.content.candidateId,
    primaryPreFinalEvaluationId: report.evaluationId,
    calibrationConfigurationArtifact: input.preFinalInput.calibrationConfigurationArtifact,
    evaluations: evaluateAflTradeNativePavValidationDefinitions(
      definitions,
      rows,
      configuration,
      Date.parse(fitInput.protocol.content.windows.calibration.from)
    ),
  };
  return aflTradeNativePavValidationPlanEvidenceSchema.parse({
    evaluationId: createAflTradeContentAddress('native-pav-validation-plan-evidence', content),
    content,
  });
}
