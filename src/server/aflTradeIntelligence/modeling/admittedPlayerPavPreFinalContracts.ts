import { z } from 'zod';
import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import { playerPavEmpiricalCalibrationSchema } from './playerPavForecastEvaluation';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[a-f0-9]{64}$`));
const count = z.number().int().nonnegative().max(100_000);
const vector = z.array(z.number().finite()).length(3);
const interval = z.object({ lower: z.number().finite(), upper: z.number().finite() }).strict();
const distribution = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('unavailable'),
      reason: z.enum(['short_history_calibration_unsupported', 'insufficient_calibration_support']),
    })
    .strict(),
  z
    .object({
      state: z.literal('empirical_calibration_paths'),
      nominalCoverage: z.number().gt(0).lt(1),
      calibrationObservationIds: z.array(id('player-pav-observation')).max(100_000),
      annualDraws: z.array(vector).max(100_000),
      totalDraws: z.array(z.number().finite()).max(100_000),
      annualIntervals: z.array(interval).length(3),
      totalInterval: interval,
    })
    .strict(),
]);
const metric = z
  .object({
    bias: z.number().finite(),
    mae: z.number().finite().nonnegative(),
    rmse: z.number().finite().nonnegative(),
    distributionObservationCount: count,
    crps: z.number().finite().nullable(),
    intervalCoverage: z.number().min(0).max(1).nullable(),
    intervalWidth: z.number().finite().nonnegative().nullable(),
    intervalScore: z.number().finite().nullable(),
  })
  .strict()
  .nullable();
export const aflTradeNativePavPreFinalContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-native-pav-pre-final-evaluation/v1'),
    authorityBoundary: z.literal(
      'numerical_pre_final_evidence_no_execution_or_qualification_authority'
    ),
    publicationEligible: z.literal(false),
    intentId: id('model-run-intent'),
    protocolId: id('model-protocol'),
    datasetId: id('dataset'),
    datasetAdmissionId: id('dataset-admission'),
    observationSetId: id('player-observation-set'),
    pavObservationSetId: id('player-pav-observation-set'),
    methodId: id('hpn-pav-method'),
    candidateId: id('admitted-player-pav-candidate'),
    candidateArtifact: aflTradeArtifactRefSchema,
    calibrationConfigurationArtifact: aflTradeArtifactRefSchema,
    calibrationState: playerPavEmpiricalCalibrationSchema,
    validationObservationIds: z.array(id('player-pav-observation')).max(100_000),
    validationForecasts: z
      .array(
        z
          .object({
            observationId: id('player-pav-observation'),
            playerId: z.string().min(1),
            partition: z.literal('validation'),
            predictionSeason: z.number().int(),
            annualPointPav: vector,
            totalPointPav: z.number().finite(),
            historySupport: z.enum(['short_history_unvalidated', 'complete_history']),
            distribution,
          })
          .strict()
      )
      .max(100_000),
    validationMetrics: z
      .object({ observationCount: count, annual: z.array(metric).length(3), cumulative: metric })
      .strict(),
  })
  .strict();
export const aflTradeNativePavPreFinalEvidenceSchema = z
  .object({
    evaluationId: id('native-pav-pre-final-evaluation'),
    content: aflTradeNativePavPreFinalContentSchema,
  })
  .strict()
  .refine(
    (report) =>
      report.evaluationId ===
      createAflTradeContentAddress('native-pav-pre-final-evaluation', report.content)
  );
export type AflTradeNativePavPreFinalEvidence = z.infer<
  typeof aflTradeNativePavPreFinalEvidenceSchema
>;
