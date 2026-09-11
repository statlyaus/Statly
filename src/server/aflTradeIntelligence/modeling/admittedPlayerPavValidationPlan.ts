import { z } from 'zod';
import {
  aflTradePlayerPavModelProtocolSchema,
  type AflTradePlayerPavModelProtocol,
} from '../artifacts/modelProtocol';
import {
  doesAflTradeArtifactRefMatchBytes,
  doAflTradeArtifactRefsExactlyMatch,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import { aflTradeAdmittedPlayerPavFitConfigurationSchema } from './admittedPlayerPavCandidate';
import { fitPlayerPavForecast, restorePlayerPavForecast } from './playerPavForecastFit';
import type { AflTradeNativePavValidationPlanEvidence } from './admittedPlayerPavValidationPlanContracts';
import type {
  PlayerPavResearchRow,
  PlayerPavForecastConfiguration,
} from './playerPavForecastDesign';
import {
  fitPlayerPavEmpiricalCalibration,
  applyPlayerPavEmpiricalCalibration,
  evaluatePlayerPavForecastPartition,
  evaluatePlayerPavPairedObservationScores,
} from './playerPavForecastEvaluation';

const shared = {
  definitionKey: z.string().trim().min(1).max(200),
  candidate: aflTradeAdmittedPlayerPavFitConfigurationSchema.shape.candidate,
  fitPartition: z.literal('train'),
};
export const aflTradeNativePavBaselineDefinitionSchema = z
  .object({
    ...shared,
    schemaVersion: z.literal('afl-trade-native-pav-baseline-definition/v1'),
    evaluatedPartitions: z.tuple([z.literal('validation'), z.literal('final_test')]),
  })
  .strict();
export const aflTradeNativePavSensitivityDefinitionSchema = z
  .object({
    ...shared,
    schemaVersion: z.literal('afl-trade-native-pav-sensitivity-definition/v1'),
    evaluatedPartition: z.literal('validation'),
    purpose: z.literal('sensitivity_not_candidate_selection'),
  })
  .strict();
export type AflTradeNativePavDefinitionArtifact = {
  reference: AflTradeArtifactRef;
  bytes: Uint8Array;
};

/** Interprets exact declarations, never inventing parameters or granting scientific approval. */
export function interpretAflTradeNativePavValidationDefinitions(
  unparsed: AflTradePlayerPavModelProtocol,
  artifacts: readonly AflTradeNativePavDefinitionArtifact[]
) {
  const protocol = aflTradePlayerPavModelProtocolSchema.parse(unparsed);
  const expected = [
    ...protocol.content.validationPlan.baselineDefinitionArtifacts,
    ...protocol.content.validationPlan.sensitivityAnalysisArtifacts,
  ];
  const byId = new Map(artifacts.map((item) => [item.reference.artifactId, item]));
  if (
    byId.size !== artifacts.length ||
    expected.length !== artifacts.length ||
    new Set(expected.map((ref) => ref.artifactId)).size !== expected.length
  )
    throw new RangeError(
      'Native validation definitions require each exact registered artifact once.'
    );
  const read = (reference: AflTradeArtifactRef) => {
    const artifact = byId.get(reference.artifactId);
    if (
      !artifact ||
      !doAflTradeArtifactRefsExactlyMatch(reference, artifact.reference) ||
      !doesAflTradeArtifactRefMatchBytes(reference, artifact.bytes, 'application/json')
    )
      throw new RangeError('Native validation definition bytes differ from registered artifacts.');
    return JSON.parse(new TextDecoder().decode(artifact.bytes)) as unknown;
  };
  const definitions = [
    ...protocol.content.validationPlan.baselineDefinitionArtifacts.map((reference) => ({
      kind: 'baseline' as const,
      reference,
      definition: aflTradeNativePavBaselineDefinitionSchema.parse(read(reference)),
    })),
    ...protocol.content.validationPlan.sensitivityAnalysisArtifacts.map((reference) => ({
      kind: 'sensitivity' as const,
      reference,
      definition: aflTradeNativePavSensitivityDefinitionSchema.parse(read(reference)),
    })),
  ];
  if (
    new Set(definitions.map((item) => `${item.kind}:${item.definition.definitionKey}`)).size !==
    definitions.length
  )
    throw new RangeError(
      'Native validation definition keys must be unique within their declared role.'
    );
  return definitions;
}

/** Numerical fits only: declarations do not confer review, custody or target-access authority. */
export function evaluateAflTradeNativePavValidationDefinitions(
  definitions: ReturnType<typeof interpretAflTradeNativePavValidationDefinitions>,
  rows: readonly PlayerPavResearchRow[],
  configuration: Pick<
    PlayerPavForecastConfiguration,
    'minimumCalibrationObservations' | 'intervalCoverage'
  >,
  calibrationStartsAt: number
) {
  const training = rows.filter((row) => row.partition === 'train');
  if (
    training.some(
      (row) =>
        row.target === null ||
        row.forecastUnavailable !== null ||
        row.labelAvailableAt >= calibrationStartsAt
    )
  )
    throw new RangeError(
      'Declared native fits require every selected training target before calibration.'
    );
  const validation = rows.filter((row) => row.partition === 'validation');
  return definitions.map((item) => {
    const fitted = fitPlayerPavForecast(training, item.definition.candidate);
    const calibrationState = fitPlayerPavEmpiricalCalibration(
      rows,
      fitted,
      item.definition.candidate.historySeasons,
      configuration
    );
    const validationForecasts = applyPlayerPavEmpiricalCalibration(
      validation,
      fitted,
      calibrationState
    );
    return {
      kind: item.kind,
      definitionArtifact: item.reference,
      definition: item.definition,
      trainingObservationIds: training.map((row) => row.observationId),
      fitState: fitted.state,
      calibrationState,
      validationForecasts,
      validationMetrics: evaluatePlayerPavForecastPartition(
        validation,
        validationForecasts,
        configuration,
        'validation'
      ),
    };
  });
}

/** Uses previously authenticated locked states. No sensitivity final test, fit or calibration. */
export function evaluateAflTradeNativePavFinalBaselines(
  report: AflTradeNativePavValidationPlanEvidence,
  rows: readonly PlayerPavResearchRow[],
  primaryForecasts: ReturnType<typeof applyPlayerPavEmpiricalCalibration>,
  configuration: Pick<
    PlayerPavForecastConfiguration,
    'minimumCalibrationObservations' | 'intervalCoverage'
  >
) {
  return report.content.evaluations
    .filter((item) => item.kind === 'baseline')
    .map((item) => {
      const fitted = restorePlayerPavForecast(item.fitState);
      const forecasts = applyPlayerPavEmpiricalCalibration(rows, fitted, item.calibrationState);
      const primaryIds = new Set(primaryForecasts.map((row) => row.observationId));
      const baselineIds = new Set(forecasts.map((row) => row.observationId));
      const paired = rows.filter(
        (row) =>
          row.target !== null &&
          primaryIds.has(row.observationId) &&
          baselineIds.has(row.observationId)
      );
      const pairedIds = new Set(paired.map((row) => row.observationId));
      return {
        definitionArtifact: item.definitionArtifact,
        definitionKey: item.definition.definitionKey,
        fitId: item.fitState.fitId,
        calibrationId: item.calibrationState.calibrationId,
        finalForecasts: forecasts,
        finalMetrics: evaluatePlayerPavForecastPartition(
          rows,
          forecasts,
          configuration,
          'final_test'
        ),
        pairedObservationIds: [...pairedIds],
        pairedScores: evaluatePlayerPavPairedObservationScores(
          rows,
          primaryForecasts,
          forecasts,
          configuration,
          'final_test'
        ),
        excludedObservationIds: rows
          .filter((row) => !pairedIds.has(row.observationId))
          .map((row) => row.observationId),
        primaryMetrics: evaluatePlayerPavForecastPartition(
          paired,
          primaryForecasts.filter((row) => pairedIds.has(row.observationId)),
          configuration,
          'final_test'
        ),
        baselineMetrics: evaluatePlayerPavForecastPartition(
          paired,
          forecasts.filter((row) => pairedIds.has(row.observationId)),
          configuration,
          'final_test'
        ),
      };
    });
}
