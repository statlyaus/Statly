import { z } from 'zod';

import { AFL_TRADE_DECISION_ENVIRONMENTS } from '../governance/gateDecisionTypes';
import { AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID } from '../valuation/automatedPrivateEvaluationPolicy';
import {
  aflTradeModelRunCheckpointSchema,
  aflTradeModelRunCheckpointV2Schema,
  AFL_TRADE_MODEL_RUN_PROGRESS_STAGES,
  aflTradeAnyModelRunCheckpointSchema,
  type AflTradeAnyModelRunCheckpoint,
  type AflTradeModelRunCheckpoint,
} from './modelRunCheckpoint';
import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  createAflTradeCanonicalJsonArtifactRef,
} from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
  canonicalizeAflTradeJson,
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

/** Retained execution evidence only: parsing neither authorizes evaluation nor qualifies a model. */
const nativeFinalTestCompletionContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-native-final-test-completion/v1'),
    authorityBoundary: z.literal(
      'retained_execution_evidence_no_execution_or_qualification_authority'
    ),
    publicationEligible: z.literal(false),
    environment: z.literal('non_production'),
    finalTestStartedCheckpoint: aflTradeModelRunCheckpointSchema,
    evaluatedAt: isoDateTimeSchema,
    recordedAt: isoDateTimeSchema,
    outcome: successfulOutcomeSchema,
  })
  .strict();

function validateNativeFinalTestCompletion(
  evidence: {
    finalTestStartedCheckpoint: AflTradeAnyModelRunCheckpoint;
    evaluatedAt: string;
    recordedAt: string;
    outcome: z.infer<typeof successfulOutcomeSchema>;
  },
  context: z.RefinementCtx
) {
  const start = evidence.finalTestStartedCheckpoint.content;
  if (start.stage !== 'final_test_started') {
    context.addIssue({
      code: 'custom',
      path: ['finalTestStartedCheckpoint'],
      message: 'Completion evidence requires the exact final-test-started checkpoint.',
    });
  }
  if (
    Date.parse(evidence.evaluatedAt) < Date.parse(start.recordedAt) ||
    Date.parse(evidence.recordedAt) < Date.parse(evidence.evaluatedAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['evaluatedAt'],
      message: 'Evaluation must finish after its start checkpoint and before evidence retention.',
    });
  }
  if (
    start.candidateArtifact === null ||
    !doAflTradeArtifactRefsExactlyMatch(start.candidateArtifact, evidence.outcome.modelArtifact)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['outcome', 'modelArtifact'],
      message: 'Completed native evaluation must preserve the exact locked candidate reference.',
    });
  }
  for (const [key, value] of Object.entries(evidence.outcome)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      Date.parse(value.createdAt) > Date.parse(evidence.recordedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome', key, 'createdAt'],
        message: 'Output artifacts must exist by completion-evidence retention.',
      });
    }
  }
}

export const aflTradeNativeFinalTestCompletionEvidenceSchema =
  nativeFinalTestCompletionContentSchema.superRefine(validateNativeFinalTestCompletion);

export const aflTradeNativeFinalTestCompletionEvidenceV2Schema =
  nativeFinalTestCompletionContentSchema
    .extend({
      schemaVersion: z.literal('afl-trade-native-final-test-completion/v2'),
      finalTestStartedCheckpoint: aflTradeModelRunCheckpointV2Schema,
    })
    .strict()
    .superRefine(validateNativeFinalTestCompletion);
export type AflTradeNativeFinalTestCompletionEvidenceV2 = z.infer<
  typeof aflTradeNativeFinalTestCompletionEvidenceV2Schema
>;

export function createAflTradeNativeFinalTestCompletionEvidenceV2(
  input: Pick<
    AflTradeNativeFinalTestCompletionEvidenceV2,
    'finalTestStartedCheckpoint' | 'evaluatedAt' | 'recordedAt' | 'outcome'
  >
): AflTradeNativeFinalTestCompletionEvidenceV2 {
  return aflTradeNativeFinalTestCompletionEvidenceV2Schema.parse({
    ...input,
    schemaVersion: 'afl-trade-native-final-test-completion/v2',
    authorityBoundary: 'retained_execution_evidence_no_execution_or_qualification_authority',
    publicationEligible: false,
    environment: 'non_production',
  });
}

export type AflTradeNativeFinalTestCompletionEvidence = z.infer<
  typeof aflTradeNativeFinalTestCompletionEvidenceSchema
>;

/** The executor supplies its actual completion time, never a recovery checkpoint's timestamp. */
export function createAflTradeNativeFinalTestCompletionEvidence(
  input: Pick<
    AflTradeNativeFinalTestCompletionEvidence,
    'finalTestStartedCheckpoint' | 'evaluatedAt' | 'recordedAt' | 'outcome'
  >
): AflTradeNativeFinalTestCompletionEvidence {
  return aflTradeNativeFinalTestCompletionEvidenceSchema.parse({
    ...input,
    schemaVersion: 'afl-trade-native-final-test-completion/v1',
    authorityBoundary: 'retained_execution_evidence_no_execution_or_qualification_authority',
    publicationEligible: false,
    environment: 'non_production',
  });
}

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

const continuationBindingSchema = z
  .object({
    rootIntentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    previousIntentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    checkpointId: aflTradeContentAddressedIdSchema('model-run-checkpoint'),
    dispatchRequestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    substantiveOperationId: aflTradeContentAddressedIdSchema('private-valuation-model-operation'),
    dispatchClaimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
    dispatchLeaseTokenSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    dispatchAttemptNumber: z.number().int().min(1).max(3),
  })
  .strict();

const continuationIntentContentSchema = z
  .object({
    ...aflTradeModelRunIntentContentSchema.shape,
    schemaVersion: z.literal('afl-trade-model-run-intent/v2'),
    environment: z.literal('non_production'),
    continuation: continuationBindingSchema,
  })
  .strict()
  .superRefine((intent, context) => {
    const { continuation, ...base } = intent;
    const legacyShape = aflTradeModelRunIntentContentSchema.safeParse({
      ...base,
      schemaVersion: AFL_TRADE_MODEL_RUN_INTENT_SCHEMA_VERSION,
    });
    if (!legacyShape.success)
      for (const issue of legacyShape.error.issues)
        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    if (
      intent.job.jobId !== continuation.substantiveOperationId ||
      intent.job.attempt !== continuation.dispatchAttemptNumber ||
      intent.job.initiatedBy !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID ||
      intent.job.workerIdentity !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID
    ) {
      context.addIssue({
        code: 'custom',
        path: ['job'],
        message: 'Continuation job must bind its exact private operation and attempt.',
      });
    }
  });

export const aflTradeModelRunIntentSchema = z
  .object({
    intentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    content: z.union([aflTradeModelRunIntentContentSchema, continuationIntentContentSchema]),
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

/** Constructs lineage only; durable claim, checkpoint and current-source authorization remain required. */
export function createAflTradeModelRunContinuationIntent(input: {
  previousIntent: AflTradeModelRunIntent;
  checkpoint: AflTradeAnyModelRunCheckpoint;
  startedAt: string;
  dispatchClaimId: string;
  dispatchLeaseTokenSha256: string;
  dispatchAttemptNumber: number;
  modelTrainingEvaluationReceiptIds: string[];
}): AflTradeModelRunIntent {
  const previous = aflTradeModelRunIntentSchema.parse(input.previousIntent);
  const checkpoint = aflTradeAnyModelRunCheckpointSchema.parse(input.checkpoint);
  const rootIntentId =
    previous.content.schemaVersion === 'afl-trade-model-run-intent/v2'
      ? previous.content.continuation.rootIntentId
      : previous.intentId;
  if (
    previous.content.environment !== 'non_production' ||
    previous.content.job.initiatedBy !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID ||
    previous.content.job.workerIdentity !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID ||
    checkpoint.content.rootIntentId !== rootIntentId ||
    checkpoint.content.substantiveOperationId !== previous.content.job.jobId ||
    checkpoint.content.stage === 'final_test_started' ||
    Date.parse(input.startedAt) < Date.parse(previous.content.startedAt) ||
    Date.parse(input.startedAt) < Date.parse(checkpoint.content.recordedAt) ||
    (previous.content.schemaVersion === 'afl-trade-model-run-intent/v2' &&
      checkpoint.content.dispatchRequestId !== previous.content.continuation.dispatchRequestId)
  ) {
    throw new RangeError(
      'Continuation requires the same private run and an unambiguous retained checkpoint.'
    );
  }
  const content = continuationIntentContentSchema.parse({
    ...previous.content,
    schemaVersion: 'afl-trade-model-run-intent/v2',
    startedAt: input.startedAt,
    job: { ...previous.content.job, attempt: input.dispatchAttemptNumber },
    modelTrainingEvaluationReceiptIds: input.modelTrainingEvaluationReceiptIds,
    continuation: {
      rootIntentId,
      previousIntentId: previous.intentId,
      checkpointId: checkpoint.checkpointId,
      dispatchRequestId: checkpoint.content.dispatchRequestId,
      substantiveOperationId: checkpoint.content.substantiveOperationId,
      dispatchClaimId: input.dispatchClaimId,
      dispatchLeaseTokenSha256: input.dispatchLeaseTokenSha256,
      dispatchAttemptNumber: input.dispatchAttemptNumber,
    },
  });
  return aflTradeModelRunIntentSchema.parse({
    intentId: createAflTradeContentAddress('model-run-intent', content),
    content,
  });
}

const persistenceRecoveryAncestrySchema = z
  .object({
    intentChain: z.array(aflTradeModelRunIntentSchema).min(2).max(1000),
    checkpoints: z.tuple([
      aflTradeModelRunCheckpointSchema,
      aflTradeModelRunCheckpointSchema,
      aflTradeModelRunCheckpointSchema,
      aflTradeModelRunCheckpointSchema,
    ]),
    completionEvidence: aflTradeNativeFinalTestCompletionEvidenceSchema,
  })
  .strict();

const progressPersistenceRecoveryAncestrySchema = persistenceRecoveryAncestrySchema
  .extend({
    checkpoints: z.tuple([
      aflTradeAnyModelRunCheckpointSchema,
      aflTradeModelRunCheckpointV2Schema,
      aflTradeModelRunCheckpointV2Schema,
      aflTradeModelRunCheckpointV2Schema,
      aflTradeModelRunCheckpointV2Schema,
      aflTradeModelRunCheckpointV2Schema,
      aflTradeModelRunCheckpointV2Schema,
    ]),
    completionEvidence: aflTradeNativeFinalTestCompletionEvidenceV2Schema,
  })
  .strict();

function reconstructPersistenceRecoveryContent(
  recovery:
    | z.infer<typeof persistenceRecoveryAncestrySchema>
    | z.infer<typeof progressPersistenceRecoveryAncestrySchema>,
  runAuthorizationId: string,
  finishedAt: string,
  progress = false
) {
  const { intentChain, checkpoints, completionEvidence } = recovery;
  const root = intentChain[0]!;
  const child = intentChain[intentChain.length - 1]!;
  const fail = (): never => {
    throw new RangeError('Persistence recovery requires exact completed native run ancestry.');
  };
  const exact = (left: unknown, right: unknown) =>
    canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  if (
    root.content.schemaVersion !== 'afl-trade-model-run-intent/v1' ||
    root.content.environment !== 'non_production' ||
    root.content.job.initiatedBy !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID ||
    root.content.job.workerIdentity !== AUTOMATED_PRIVATE_EVALUATION_PRINCIPAL_ID ||
    child.content.schemaVersion !== 'afl-trade-model-run-intent/v2'
  )
    return fail();
  const ownerIndices = new Map(intentChain.map((intent, index) => [intent.intentId, index]));
  if (ownerIndices.size !== intentChain.length) return fail();
  const stages = progress
    ? AFL_TRADE_MODEL_RUN_PROGRESS_STAGES
    : ['started', 'candidate_locked', 'final_test_started', 'final_test_completed'];
  const started = checkpoints[0];
  const locked = checkpoints[progress ? 4 : 1]!;
  const completed = checkpoints[progress ? 6 : 3]!;
  const authorizationOwners = new Map<string, string>();
  const ownerAuthorizations = new Map<string, string>();
  let previousOwner = 0;
  for (const [index, checkpoint] of checkpoints.entries()) {
    const content = checkpoint.content;
    const ownerIndex = ownerIndices.get(content.intentId);
    if (
      ownerIndex === undefined ||
      ownerIndex >= intentChain.length - 1 ||
      ownerIndex < previousOwner
    )
      return fail();
    const owner = intentChain[ownerIndex]!;
    const successor = intentChain[ownerIndex + 1]!;
    const binding =
      owner.content.schemaVersion === 'afl-trade-model-run-intent/v2'
        ? owner.content.continuation
        : started.content;
    const expectedClaim = 'dispatchClaimId' in binding ? binding.dispatchClaimId : null;
    if (
      content.stage !== stages[index] ||
      content.rootIntentId !== root.intentId ||
      content.previousCheckpointId !== (checkpoints[index - 1]?.checkpointId ?? null) ||
      content.dispatchRequestId !== started.content.dispatchRequestId ||
      content.substantiveOperationId !== root.content.job.jobId ||
      content.dispatchClaimId !== expectedClaim ||
      content.dispatchAttemptNumber !== owner.content.job.attempt ||
      content.dispatchRequestId !== binding.dispatchRequestId ||
      Date.parse(content.recordedAt) < Date.parse(owner.content.startedAt) ||
      Date.parse(content.recordedAt) > Date.parse(successor.content.startedAt) ||
      (index > 0 &&
        Date.parse(content.recordedAt) < Date.parse(checkpoints[index - 1]!.content.recordedAt)) ||
      (index > 0 && !exact(content.candidateArtifact, locked.content.candidateArtifact)) ||
      (progress &&
        (content.stage === 'candidate_locked' || content.stage === 'final_test_started') &&
        !exact(content.evidenceArtifact, checkpoints[index - 1]!.content.evidenceArtifact)) ||
      (authorizationOwners.has(content.authorizationId) &&
        authorizationOwners.get(content.authorizationId) !== owner.intentId) ||
      (ownerAuthorizations.has(owner.intentId) &&
        ownerAuthorizations.get(owner.intentId) !== content.authorizationId)
    )
      return fail();
    authorizationOwners.set(content.authorizationId, owner.intentId);
    ownerAuthorizations.set(owner.intentId, content.authorizationId);
    previousOwner = ownerIndex;
  }
  if (authorizationOwners.has(runAuthorizationId)) return fail();
  for (let index = 1; index < intentChain.length; index++) {
    const intent = intentChain[index]!;
    if (intent.content.schemaVersion !== 'afl-trade-model-run-intent/v2') return fail();
    const binding = intent.content.continuation;
    const preceding = checkpoints.filter(
      (checkpoint) => ownerIndices.get(checkpoint.content.intentId)! < index
    );
    const checkpoint = preceding[preceding.length - 1];
    if (
      !checkpoint ||
      binding.checkpointId !== checkpoint.checkpointId ||
      intent.content.job.attempt < intentChain[index - 1]!.content.job.attempt
    )
      return fail();
    const expected = createAflTradeModelRunContinuationIntent({
      previousIntent: intentChain[index - 1]!,
      checkpoint,
      startedAt: intent.content.startedAt,
      dispatchClaimId: binding.dispatchClaimId,
      dispatchLeaseTokenSha256: binding.dispatchLeaseTokenSha256,
      dispatchAttemptNumber: binding.dispatchAttemptNumber,
      modelTrainingEvaluationReceiptIds: intent.content.modelTrainingEvaluationReceiptIds,
    });
    if (!exact(expected, intent)) return fail();
  }
  if (
    child.content.continuation.checkpointId !== completed.checkpointId ||
    !exact(completionEvidence.finalTestStartedCheckpoint, checkpoints[progress ? 5 : 2]) ||
    !exact(
      completed.content.evidenceArtifact,
      createAflTradeCanonicalJsonArtifactRef(completionEvidence, completionEvidence.recordedAt)
    ) ||
    Date.parse(completionEvidence.recordedAt) > Date.parse(completed.content.recordedAt) ||
    Date.parse(child.content.startedAt) < Date.parse(completed.content.recordedAt) ||
    Date.parse(finishedAt) < Date.parse(child.content.startedAt)
  )
    return fail();
  const {
    schemaVersion: _version,
    authorityBoundary: _boundary,
    publicationEligible: _eligible,
    continuation: _continuation,
    ...execution
  } = child.content;
  return {
    ...execution,
    schemaVersion: progress
      ? ('afl-trade-model-run/v5' as const)
      : ('afl-trade-model-run/v4' as const),
    authorityBoundary: 'persistence_recovery_only_no_execution_or_qualification_authority' as const,
    publicationEligible: false as const,
    runIntentId: child.intentId,
    runAuthorizationId,
    candidateLockedAt: locked.content.recordedAt,
    finalTestEvaluatedAt: completionEvidence.evaluatedAt,
    finishedAt,
    outcome: completionEvidence.outcome,
    recovery,
  };
}

export const aflTradeModelRunManifestV4ContentSchema = z
  .object({
    ...aflTradeModelRunManifestV3ContentSchema.shape,
    schemaVersion: z.literal('afl-trade-model-run/v4'),
    authorityBoundary: z.literal(
      'persistence_recovery_only_no_execution_or_qualification_authority'
    ),
    publicationEligible: z.literal(false),
    environment: z.literal('non_production'),
    outcome: successfulOutcomeSchema,
    recovery: persistenceRecoveryAncestrySchema,
  })
  .strict()
  .superRefine((content, context) => {
    try {
      const expected = reconstructPersistenceRecoveryContent(
        content.recovery,
        content.runAuthorizationId,
        content.finishedAt
      );
      if (canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(content)) {
        throw new RangeError(
          'Persistence recovery manifest differs from its exact retained ancestry.'
        );
      }
      const {
        recovery,
        authorityBoundary: _boundary,
        publicationEligible: _eligible,
        ...chronology
      } = expected;
      // Validation-only projection: serialized startedAt always remains the actual child's start.
      aflTradeModelRunManifestV3ContentSchema.parse({
        ...chronology,
        schemaVersion: 'afl-trade-model-run/v3',
        startedAt: recovery.intentChain[0]!.content.startedAt,
      });
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['recovery'],
        message: error instanceof Error ? error.message : 'Invalid persistence recovery ancestry.',
      });
    }
  });

export const aflTradeModelRunManifestV4Schema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('model-run'),
    content: aflTradeModelRunManifestV4ContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('model-run', manifest.runId, manifest.content, context, [
      'runId',
    ]);
  });
export type AflTradeModelRunManifestV4 = z.infer<typeof aflTradeModelRunManifestV4Schema>;

/** Constructs persistence evidence only; consumed child authority must be authenticated by its durable owner. */
export function createAflTradeModelRunPersistenceRecoveryManifest(input: {
  intentChain: readonly AflTradeModelRunIntent[];
  checkpoints: readonly AflTradeModelRunCheckpoint[];
  completionEvidence: AflTradeNativeFinalTestCompletionEvidence;
  runAuthorizationId: string;
  finishedAt: string;
}): AflTradeModelRunManifestV4 {
  const recovery = persistenceRecoveryAncestrySchema.parse({
    intentChain: input.intentChain,
    checkpoints: input.checkpoints,
    completionEvidence: input.completionEvidence,
  });
  const content = reconstructPersistenceRecoveryContent(
    recovery,
    aflTradeContentAddressedIdSchema('model-run-authorization').parse(input.runAuthorizationId),
    isoDateTimeSchema.parse(input.finishedAt)
  );
  return aflTradeModelRunManifestV4Schema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}

/** Seven-stage recovery retains every accepted numerical phase; it adds no execution authority. */
export const aflTradeModelRunManifestV5ContentSchema = z
  .object({
    ...aflTradeModelRunManifestV3ContentSchema.shape,
    schemaVersion: z.literal('afl-trade-model-run/v5'),
    authorityBoundary: z.literal(
      'persistence_recovery_only_no_execution_or_qualification_authority'
    ),
    publicationEligible: z.literal(false),
    environment: z.literal('non_production'),
    outcome: successfulOutcomeSchema,
    recovery: progressPersistenceRecoveryAncestrySchema,
  })
  .strict()
  .superRefine((content, context) => {
    try {
      const expected = reconstructPersistenceRecoveryContent(
        content.recovery,
        content.runAuthorizationId,
        content.finishedAt,
        true
      );
      if (canonicalizeAflTradeJson(expected) !== canonicalizeAflTradeJson(content))
        throw new RangeError(
          'Progress recovery manifest differs from its exact retained ancestry.'
        );
      const {
        recovery,
        authorityBoundary: _boundary,
        publicationEligible: _eligible,
        ...chronology
      } = expected;
      aflTradeModelRunManifestV3ContentSchema.parse({
        ...chronology,
        schemaVersion: 'afl-trade-model-run/v3',
        startedAt: recovery.intentChain[0]!.content.startedAt,
      });
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['recovery'],
        message: error instanceof Error ? error.message : 'Invalid progress recovery ancestry.',
      });
    }
  });
export const aflTradeModelRunManifestV5Schema = z
  .object({
    runId: aflTradeContentAddressedIdSchema('model-run'),
    content: aflTradeModelRunManifestV5ContentSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    addAflTradeContentAddressIssue('model-run', manifest.runId, manifest.content, context, [
      'runId',
    ]);
  });
export type AflTradeModelRunManifestV5 = z.infer<typeof aflTradeModelRunManifestV5Schema>;

export function createAflTradeModelRunProgressPersistenceRecoveryManifest(input: {
  intentChain: readonly AflTradeModelRunIntent[];
  checkpoints: readonly AflTradeAnyModelRunCheckpoint[];
  completionEvidence: AflTradeNativeFinalTestCompletionEvidenceV2;
  runAuthorizationId: string;
  finishedAt: string;
}): AflTradeModelRunManifestV5 {
  const recovery = progressPersistenceRecoveryAncestrySchema.parse({
    intentChain: input.intentChain,
    checkpoints: input.checkpoints,
    completionEvidence: input.completionEvidence,
  });
  const content = reconstructPersistenceRecoveryContent(
    recovery,
    aflTradeContentAddressedIdSchema('model-run-authorization').parse(input.runAuthorizationId),
    isoDateTimeSchema.parse(input.finishedAt),
    true
  );
  return aflTradeModelRunManifestV5Schema.parse({
    runId: createAflTradeContentAddress('model-run', content),
    content,
  });
}
