import { z } from 'zod';

import { aflTradeArtifactRefSchema } from './artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from './contentAddress';

const checkpointIdSchema = aflTradeContentAddressedIdSchema('model-run-checkpoint');
const checkpointArtifactSchema = aflTradeArtifactRefSchema.refine(
  (artifact) => artifact.mediaType === 'application/json' && artifact.byteLength > 0,
  { message: 'Checkpoint artifacts must contain nonempty JSON.' }
);
const contentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-model-run-checkpoint/v1'),
    authorityBoundary: z.literal('durable_model_run_stage_no_execution_or_qualification_authority'),
    publicationEligible: z.literal(false),
    environment: z.literal('non_production'),
    intentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    rootIntentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    authorizationId: aflTradeContentAddressedIdSchema('model-run-authorization'),
    dispatchRequestId: aflTradeContentAddressedIdSchema('private-valuation-dispatch'),
    substantiveOperationId: aflTradeContentAddressedIdSchema('private-valuation-model-operation'),
    dispatchClaimId: aflTradeContentAddressedIdSchema('private-valuation-dispatch-claim'),
    dispatchAttemptNumber: z.number().int().min(1).max(3),
    stage: z.enum(['started', 'candidate_locked', 'final_test_started', 'final_test_completed']),
    previousCheckpointId: checkpointIdSchema.nullable(),
    recordedAt: z.iso.datetime(),
    candidateArtifact: checkpointArtifactSchema.nullable(),
    evidenceArtifact: checkpointArtifactSchema.nullable(),
  })
  .strict();

function validateCheckpoint(
  checkpoint: {
    checkpointId: string;
    content: Omit<z.infer<typeof contentSchema>, 'schemaVersion' | 'stage'> & {
      schemaVersion: string;
      stage: string;
    };
  },
  context: z.RefinementCtx
) {
  addAflTradeContentAddressIssue(
    'model-run-checkpoint',
    checkpoint.checkpointId,
    checkpoint.content,
    context,
    ['checkpointId']
  );
  const content = checkpoint.content;
  if (content.stage === 'started' && content.intentId !== content.rootIntentId) {
    context.addIssue({
      code: 'custom',
      path: ['content', 'rootIntentId'],
      message: 'A started checkpoint must name its own intent as the root.',
    });
  }
  for (const field of ['previousCheckpointId', 'candidateArtifact', 'evidenceArtifact'] as const) {
    if ((content[field] === null) !== (content.stage === 'started')) {
      context.addIssue({
        code: 'custom',
        path: ['content', field],
        message:
          'Started checkpoints require null predecessors and artifacts; later stages require all three.',
      });
    }
  }
  for (const field of ['candidateArtifact', 'evidenceArtifact'] as const) {
    const artifact = content[field];
    if (artifact !== null && Date.parse(artifact.createdAt) > Date.parse(content.recordedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['content', field, 'createdAt'],
        message: 'Checkpoint artifacts must exist by the checkpoint recording time.',
      });
    }
  }
}

/** Structural evidence only; SQL owns predecessor order, live claims and current authority. */
export const aflTradeModelRunCheckpointSchema = z
  .object({ checkpointId: checkpointIdSchema, content: contentSchema })
  .strict()
  .superRefine(validateCheckpoint);

export const AFL_TRADE_MODEL_RUN_PROGRESS_STAGES = [
  'started',
  'candidate_fitted',
  'pre_final_retained',
  'validation_plan_retained',
  'candidate_locked',
  'final_test_started',
  'final_test_completed',
] as const;
const progressContentSchema = contentSchema
  .extend({
    schemaVersion: z.literal('afl-trade-model-run-checkpoint/v2'),
    stage: z.enum(AFL_TRADE_MODEL_RUN_PROGRESS_STAGES),
  })
  .strict();
export const aflTradeModelRunCheckpointV2Schema = z
  .object({
    checkpointId: checkpointIdSchema,
    content: progressContentSchema,
  })
  .strict()
  .superRefine(validateCheckpoint);
export const aflTradeAnyModelRunCheckpointSchema = z.union([
  aflTradeModelRunCheckpointSchema,
  aflTradeModelRunCheckpointV2Schema,
]);
export type AflTradeModelRunCheckpointV2 = z.infer<typeof aflTradeModelRunCheckpointV2Schema>;
export type AflTradeAnyModelRunCheckpoint = z.infer<typeof aflTradeAnyModelRunCheckpointSchema>;

export function createAflTradeModelRunCheckpointV2(
  unparsed: Omit<
    z.input<typeof progressContentSchema>,
    'schemaVersion' | 'authorityBoundary' | 'publicationEligible' | 'environment'
  >
): AflTradeModelRunCheckpointV2 {
  const content = progressContentSchema.parse({
    ...unparsed,
    schemaVersion: 'afl-trade-model-run-checkpoint/v2',
    authorityBoundary: 'durable_model_run_stage_no_execution_or_qualification_authority',
    publicationEligible: false,
    environment: 'non_production',
  });
  return aflTradeModelRunCheckpointV2Schema.parse({
    checkpointId: createAflTradeContentAddress('model-run-checkpoint', content),
    content,
  });
}

export type AflTradeModelRunCheckpoint = z.infer<typeof aflTradeModelRunCheckpointSchema>;

export function createAflTradeModelRunCheckpoint(
  unparsed: Omit<
    z.input<typeof contentSchema>,
    'schemaVersion' | 'authorityBoundary' | 'publicationEligible' | 'environment'
  >
): AflTradeModelRunCheckpoint {
  const content = contentSchema.parse({
    schemaVersion: 'afl-trade-model-run-checkpoint/v1',
    authorityBoundary: 'durable_model_run_stage_no_execution_or_qualification_authority',
    publicationEligible: false,
    environment: 'non_production',
    ...unparsed,
  });
  return aflTradeModelRunCheckpointSchema.parse({
    checkpointId: createAflTradeContentAddress('model-run-checkpoint', content),
    content,
  });
}
