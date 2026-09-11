import { z } from 'zod';
import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeNativePavPreFinalContentSchema,
  type AflTradeNativePavPreFinalEvidence,
} from './admittedPlayerPavPreFinalContracts';
import {
  aflTradeNativePavBaselineDefinitionSchema,
  aflTradeNativePavSensitivityDefinitionSchema,
  type interpretAflTradeNativePavValidationDefinitions,
} from './admittedPlayerPavValidationPlan';
import { playerPavForecastFitStateSchema, restorePlayerPavForecast } from './playerPavForecastFit';
import type { PlayerPavResearchRow } from './playerPavForecastDesign';

const shared = aflTradeNativePavPreFinalContentSchema.shape;
const evaluation = {
  definitionArtifact: aflTradeArtifactRefSchema,
  trainingObservationIds: shared.validationObservationIds,
  fitState: playerPavForecastFitStateSchema,
  calibrationState: shared.calibrationState,
  validationForecasts: shared.validationForecasts,
  validationMetrics: shared.validationMetrics,
};
const content = z
  .object({
    schemaVersion: z.literal('afl-trade-native-pav-validation-plan-evidence/v1'),
    authorityBoundary: z.literal(
      'numerical_pre_final_validation_plan_no_execution_or_qualification_authority'
    ),
    publicationEligible: z.literal(false),
    intentId: shared.intentId,
    protocolId: shared.protocolId,
    datasetId: shared.datasetId,
    datasetAdmissionId: shared.datasetAdmissionId,
    observationSetId: shared.observationSetId,
    pavObservationSetId: shared.pavObservationSetId,
    methodId: shared.methodId,
    primaryCandidateId: shared.candidateId,
    primaryPreFinalEvaluationId: z.string().regex(/^native-pav-pre-final-evaluation:[a-f0-9]{64}$/),
    calibrationConfigurationArtifact: aflTradeArtifactRefSchema,
    evaluations: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              ...evaluation,
              kind: z.literal('baseline'),
              definition: aflTradeNativePavBaselineDefinitionSchema,
            })
            .strict(),
          z
            .object({
              ...evaluation,
              kind: z.literal('sensitivity'),
              definition: aflTradeNativePavSensitivityDefinitionSchema,
            })
            .strict(),
        ])
      )
      .max(1000),
  })
  .strict();
export const aflTradeNativePavValidationPlanEvidenceSchema = z
  .object({
    evaluationId: z.string().regex(/^native-pav-validation-plan-evidence:[a-f0-9]{64}$/),
    content,
  })
  .strict()
  .refine(
    (report) =>
      report.evaluationId ===
      createAflTradeContentAddress('native-pav-validation-plan-evidence', report.content)
  );
export type AflTradeNativePavValidationPlanEvidence = z.infer<
  typeof aflTradeNativePavValidationPlanEvidenceSchema
>;

/** Exact retained ancestry and numerical-state structure, without fitting or scoring. */
export function authenticateAflTradeNativePavValidationPlanRows(
  unparsed: unknown,
  input: {
    preFinal: AflTradeNativePavPreFinalEvidence;
    definitions: ReturnType<typeof interpretAflTradeNativePavValidationDefinitions>;
    rows: readonly PlayerPavResearchRow[];
  }
) {
  const report = aflTradeNativePavValidationPlanEvidenceSchema.parse(unparsed);
  const same = (a: unknown, b: unknown) =>
    canonicalizeAflTradeJson(a) === canonicalizeAflTradeJson(b);
  const primary = input.preFinal.content;
  const expected = {
    intentId: primary.intentId,
    protocolId: primary.protocolId,
    datasetId: primary.datasetId,
    datasetAdmissionId: primary.datasetAdmissionId,
    observationSetId: primary.observationSetId,
    pavObservationSetId: primary.pavObservationSetId,
    methodId: primary.methodId,
    primaryCandidateId: primary.candidateId,
    primaryPreFinalEvaluationId: input.preFinal.evaluationId,
    calibrationConfigurationArtifact: primary.calibrationConfigurationArtifact,
  };
  if (
    Object.entries(expected).some(
      ([key, value]) => !same(report.content[key as keyof typeof report.content], value)
    ) ||
    report.content.evaluations.length !== input.definitions.length
  )
    throw new RangeError('Native validation plan differs from exact parents or declarations.');
  const trainingIds = input.rows
    .filter((row) => row.partition === 'train')
    .map((row) => row.observationId);
  const validation = input.rows.filter(
    (row) => row.partition === 'validation' && row.forecastUnavailable === null
  );
  for (const [index, item] of report.content.evaluations.entries()) {
    const definition = input.definitions[index]!;
    const params = item.definition.candidate;
    const state = restorePlayerPavForecast(item.fitState).state.content;
    if (
      item.kind !== definition.kind ||
      !same(item.definition, definition.definition) ||
      !same(item.definitionArtifact, definition.reference) ||
      !same(item.trainingObservationIds, trainingIds) ||
      Object.entries(params).some(([key, value]) => !same(state[key as keyof typeof state], value))
    )
      throw new RangeError(
        'Native validation plan differs from declared fit or training membership.'
      );
    const calibration = item.calibrationState.content;
    const expectedCalibration = input.rows.filter(
      (row) =>
        row.partition === 'calibration' &&
        row.target !== null &&
        row.forecastUnavailable === null &&
        row.labelAvailableAt < (primary.calibrationState.content.evaluationCutoff ?? -Infinity) &&
        row.history.slice(-params.historySeasons).every((value) => value !== null)
    );
    if (
      calibration.historySeasons !== params.historySeasons ||
      calibration.evaluationCutoff !== primary.calibrationState.content.evaluationCutoff ||
      calibration.minimumCalibrationObservations !==
        primary.calibrationState.content.minimumCalibrationObservations ||
      calibration.intervalCoverage !== primary.calibrationState.content.intervalCoverage ||
      !same(
        calibration.residuals.map((row) => row.observationId),
        expectedCalibration.map((row) => row.observationId)
      ) ||
      !same(
        item.validationForecasts.map((row) => row.observationId),
        validation.map((row) => row.observationId)
      )
    )
      throw new RangeError(
        'Native validation plan differs from calibration or validation membership.'
      );
    for (const [i, forecast] of item.validationForecasts.entries()) {
      const row = validation[i]!;
      if (
        forecast.playerId !== row.playerId ||
        forecast.predictionSeason !== row.predictionSeason ||
        (forecast.distribution.state === 'empirical_calibration_paths' &&
          (forecast.distribution.nominalCoverage !== calibration.intervalCoverage ||
            !same(
              forecast.distribution.calibrationObservationIds,
              calibration.residuals.map((value) => value.observationId)
            ) ||
            forecast.distribution.annualDraws.length !== calibration.residuals.length ||
            forecast.distribution.totalDraws.length !== calibration.residuals.length))
      )
        throw new RangeError(
          'Native validation forecast differs from exact identity or calibration.'
        );
    }
  }
  return report;
}
