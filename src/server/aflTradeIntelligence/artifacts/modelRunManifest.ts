import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { aflTradeArtifactRefSchema } from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from './contentAddress';

const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const AFL_TRADE_MODEL_RUN_SCHEMA_VERSION_V3 = 'afl-trade-model-run/v3' as const;
export const AFL_TRADE_MODEL_RUN_INTENT_SCHEMA_VERSION = 'afl-trade-model-run-intent/v1' as const;

const temporalWindowSchema = z
  .object({ from: isoDateTimeSchema, to: isoDateTimeSchema })
  .strict()
  .superRefine((window, context) => {
    if (Date.parse(window.to) <= Date.parse(window.from)) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Window must be non-empty.' });
    }
  });

const successfulOutcomeSchema = z
  .object({
    status: z.literal('succeeded'),
    modelArtifact: aflTradeArtifactRefSchema,
    selectionValidationReportArtifact: aflTradeArtifactRefSchema.optional(),
    validationReportArtifact: aflTradeArtifactRefSchema,
    baselineComparisonArtifact: aflTradeArtifactRefSchema,
    calibrationReportArtifact: aflTradeArtifactRefSchema,
    intervalCoverageArtifact: aflTradeArtifactRefSchema,
    subgroupReportArtifact: aflTradeArtifactRefSchema,
    sensitivityReportArtifact: aflTradeArtifactRefSchema,
    leakageAuditArtifact: aflTradeArtifactRefSchema,
    modelCardArtifact: aflTradeArtifactRefSchema,
    diagnosticsArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

const unsuccessfulOutcomeSchema = z
  .object({
    status: z.enum(['failed', 'cancelled']),
    failureClassification: z.enum([
      'invalid_input',
      'data_quality',
      'training_failure',
      'validation_failure',
      'infrastructure_failure',
      'operator_cancelled',
    ]),
    failureArtifact: aflTradeArtifactRefSchema,
    diagnosticsArtifact: aflTradeArtifactRefSchema,
  })
  .strict();

export const aflTradeModelRunManifestContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-model-run/v2'),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    modelId: publicIdSchema,
    modelVersion: publicIdSchema,
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    codeCommitSha: gitCommitSchema,
    cleanWorktree: z.literal(true),
    seed: z.number().int().nonnegative(),
    job: z
      .object({
        jobId: publicIdSchema,
        attempt: z.number().int().positive(),
        initiatedBy: publicIdSchema,
        workerIdentity: publicIdSchema,
      })
      .strict(),
    startedAt: isoDateTimeSchema,
    candidateLockedAt: isoDateTimeSchema.nullable(),
    finalTestEvaluatedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema,
    windows: z
      .object({
        train: temporalWindowSchema,
        calibration: temporalWindowSchema,
        validation: temporalWindowSchema,
        finalTest: temporalWindowSchema,
        embargoDays: z.number().int().nonnegative(),
      })
      .strict(),
    sourceCodeArtifact: aflTradeArtifactRefSchema,
    dependencyLockArtifact: aflTradeArtifactRefSchema,
    runtimeArtifact: aflTradeArtifactRefSchema,
    containerArtifact: aflTradeArtifactRefSchema,
    configurationArtifact: aflTradeArtifactRefSchema,
    environmentArtifact: aflTradeArtifactRefSchema,
    featureDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(1000),
    outcome: z.discriminatedUnion('status', [successfulOutcomeSchema, unsuccessfulOutcomeSchema]),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'A model run cannot finish before it starts.',
      });
    }
    const candidateLockedAt =
      manifest.candidateLockedAt === null ? null : Date.parse(manifest.candidateLockedAt);
    const finalTestEvaluatedAt =
      manifest.finalTestEvaluatedAt === null ? null : Date.parse(manifest.finalTestEvaluatedAt);
    if (
      (manifest.outcome.status === 'succeeded' &&
        (candidateLockedAt === null || finalTestEvaluatedAt === null)) ||
      (finalTestEvaluatedAt !== null && candidateLockedAt === null) ||
      (candidateLockedAt !== null && candidateLockedAt < Date.parse(manifest.startedAt)) ||
      (candidateLockedAt !== null && Date.parse(manifest.finishedAt) < candidateLockedAt) ||
      (candidateLockedAt !== null &&
        finalTestEvaluatedAt !== null &&
        finalTestEvaluatedAt < candidateLockedAt) ||
      (finalTestEvaluatedAt !== null && Date.parse(manifest.finishedAt) < finalTestEvaluatedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidateLockedAt'],
        message:
          'The candidate must be locked before final-test evaluation and before the run finishes.',
      });
    }
    const windows = [
      manifest.windows.train,
      manifest.windows.calibration,
      manifest.windows.validation,
      manifest.windows.finalTest,
    ];
    for (let index = 1; index < windows.length; index += 1) {
      const requiredFrom =
        Date.parse(windows[index - 1].to) + manifest.windows.embargoDays * 86_400_000;
      if (Date.parse(windows[index].from) < requiredFrom) {
        context.addIssue({
          code: 'custom',
          path: ['windows'],
          message: 'Model windows must be chronological and respect the declared embargo.',
        });
        break;
      }
    }
  });

export const aflTradeModelRunManifestSchema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('model-run'),
    content: aflTradeModelRunManifestContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('model-run', manifest.runId, manifest.content, context, [
      'runId',
    ]);
  });

export const aflTradeModelRunIntentContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_MODEL_RUN_INTENT_SCHEMA_VERSION),
    authorityBoundary: z.literal(
      'pre_execution_model_intent_no_fit_grade_publication_or_fantasy_ownership'
    ),
    publicationEligible: z.literal(false),
    environment: z.enum(AFL_TRADE_DECISION_ENVIRONMENTS),
    modelId: publicIdSchema,
    modelVersion: publicIdSchema,
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    modelProtocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    codeCommitSha: gitCommitSchema,
    cleanWorktree: z.literal(true),
    seed: z.number().int().nonnegative(),
    job: aflTradeModelRunManifestContentSchema.shape.job,
    startedAt: isoDateTimeSchema,
    windows: aflTradeModelRunManifestContentSchema.shape.windows,
    sourceCodeArtifact: aflTradeArtifactRefSchema,
    dependencyLockArtifact: aflTradeArtifactRefSchema,
    runtimeArtifact: aflTradeArtifactRefSchema,
    containerArtifact: aflTradeArtifactRefSchema,
    configurationArtifact: aflTradeArtifactRefSchema,
    environmentArtifact: aflTradeArtifactRefSchema,
    featureDefinitionArtifacts: z.array(aflTradeArtifactRefSchema).min(1).max(1000),
    modelTrainingEvaluationReceiptIds: z
      .array(aflTradeContentAddressedIdSchema('gate0a-evaluation'))
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((intent, context) => {
    const receiptIds = intent.modelTrainingEvaluationReceiptIds;
    if (
      new Set(receiptIds).size !== receiptIds.length ||
      receiptIds.some((receiptId, index) => index > 0 && receiptIds[index - 1]! > receiptId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modelTrainingEvaluationReceiptIds'],
        message: 'Run-start model-training receipts must be unique and canonically ordered.',
      });
    }
  });

export const aflTradeModelRunIntentSchema = z
  .object({
    intentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    content: aflTradeModelRunIntentContentSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    addAflTradeContentAddressIssue('model-run-intent', intent.intentId, intent.content, context, [
      'intentId',
    ]);
  });

export const aflTradeModelRunManifestV3ContentSchema = z
  .object({
    ...aflTradeModelRunManifestContentSchema.shape,
    schemaVersion: z.literal(AFL_TRADE_MODEL_RUN_SCHEMA_VERSION_V3),
    runIntentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    runAuthorizationId: aflTradeContentAddressedIdSchema('model-run-authorization'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    modelTrainingEvaluationReceiptIds: z
      .array(aflTradeContentAddressedIdSchema('gate0a-evaluation'))
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((manifest, context) => {
    const {
      datasetAdmissionId: _datasetAdmissionId,
      runIntentId: _runIntentId,
      runAuthorizationId: _runAuthorizationId,
      observationSetId: _observationSetId,
      modelTrainingEvaluationReceiptIds: _modelTrainingEvaluationReceiptIds,
      ...legacyContent
    } = manifest;
    const legacyResult = aflTradeModelRunManifestContentSchema.safeParse({
      ...legacyContent,
      schemaVersion: 'afl-trade-model-run/v2',
    });
    if (!legacyResult.success) {
      for (const issue of legacyResult.error.issues) {
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }
    const receiptIds = manifest.modelTrainingEvaluationReceiptIds;
    if (
      new Set(receiptIds).size !== receiptIds.length ||
      receiptIds.some((receiptId, index) => index > 0 && receiptIds[index - 1]! > receiptId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modelTrainingEvaluationReceiptIds'],
        message: 'Run-start model-training receipts must be unique and canonically ordered.',
      });
    }
  });

export const aflTradeModelRunManifestV3Schema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('model-run'),
    content: aflTradeModelRunManifestV3ContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('model-run', manifest.runId, manifest.content, context, [
      'runId',
    ]);
  });

export const aflTradeAnyModelRunManifestSchema = z.union([
  aflTradeModelRunManifestSchema,
  aflTradeModelRunManifestV3Schema,
]);

export type AflTradeModelRunManifest = z.infer<typeof aflTradeModelRunManifestSchema>;
export type AflTradeModelRunManifestV3 = z.infer<typeof aflTradeModelRunManifestV3Schema>;
export type AflTradeModelRunIntent = z.infer<typeof aflTradeModelRunIntentSchema>;

export function createAflTradeModelRunIntent(
  input: Omit<
    z.input<typeof aflTradeModelRunIntentContentSchema>,
    'schemaVersion' | 'authorityBoundary' | 'publicationEligible'
  >
): AflTradeModelRunIntent {
  const content = aflTradeModelRunIntentContentSchema.parse({
    ...input,
    schemaVersion: AFL_TRADE_MODEL_RUN_INTENT_SCHEMA_VERSION,
    authorityBoundary: 'pre_execution_model_intent_no_fit_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
  });
  return aflTradeModelRunIntentSchema.parse({
    intentId: createAflTradeContentAddress('model-run-intent', content),
    content,
  });
}
