import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  aflTradeExternalHistoricalCapturePlanSchema,
  type AflTradeExternalHistoricalCapturePlan,
} from './externalDraftTradeDiscoveryContracts';

export const AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_COMPLETION_SCHEMA_VERSION =
  'afl-trade-external-historical-capture-completion/v1' as const;

const instantSchema = z.iso.datetime({ offset: true });

const completionResultSchema = z
  .object({
    ordinal: z.number().int().positive().max(200_000),
    targetId: aflTradeContentAddressedIdSchema('external-capture-target'),
    scheduleId: aflTradeContentAddressedIdSchema('external-capture-schedule'),
    dispatchKey: aflTradeContentAddressedIdSchema('external-capture-dispatch'),
    occurrenceEventId: aflTradeContentAddressedIdSchema('external-capture-occurrence-event'),
    occurrenceRevision: z.number().int().positive(),
    captureMode: z.enum(['captured', 'not_modified']),
    resultId: z.string().trim().min(1).max(240),
    captureId: aflTradeContentAddressedIdSchema('source-capture'),
    evidenceBatchId: aflTradeContentAddressedIdSchema('external-evidence-batch'),
    evidenceBatchSha256: aflTradeSha256Schema,
    evidenceCount: z.number().int().positive().max(1_000_000),
    finalizedAt: instantSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const batchSha256 = result.evidenceBatchId.slice('external-evidence-batch:'.length);
    if (result.evidenceBatchSha256 !== batchSha256) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceBatchSha256'],
        message: 'Evidence-batch digest must match its content-addressed identity.',
      });
    }
    if (
      result.captureMode === 'captured'
        ? result.resultId !== result.evidenceBatchId
        : !/^source-capture-attempt:[a-f0-9]{64}$/.test(result.resultId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resultId'],
        message: 'Capture result identity must match the scheduler completion mode.',
      });
    }
  });

const completionContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_COMPLETION_SCHEMA_VERSION),
    environment: z.enum(['test_fixture', 'non_production', 'production']),
    competition: z.literal('AFLM'),
    planId: aflTradeContentAddressedIdSchema('external-historical-capture-plan'),
    planSha256: aflTradeSha256Schema,
    targetCount: z.number().int().positive().max(200_000),
    targetSetSha256: aflTradeSha256Schema,
    results: z.array(completionResultSchema).min(1).max(200_000),
    sourceBatchIds: z
      .array(aflTradeContentAddressedIdSchema('external-evidence-batch'))
      .min(1)
      .max(200_000),
    resultSetSha256: aflTradeSha256Schema,
    sourceBatchSetSha256: aflTradeSha256Schema,
    completedAt: instantSchema,
    status: z.literal('complete'),
    reconciliationEligible: z.literal(true),
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((completion, context) => {
    if (
      completion.targetCount !== completion.results.length ||
      completion.targetCount !== completion.sourceBatchIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetCount'],
        message: 'Completion must account for every target and source batch exactly once.',
      });
    }
    const sourceBatchIds = completion.results.map(({ evidenceBatchId }) => evidenceBatchId);
    if (
      new Set(sourceBatchIds).size !== sourceBatchIds.length ||
      sourceBatchIds.some((batchId, index) => completion.sourceBatchIds[index] !== batchId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBatchIds'],
        message: 'Source batches must be unique and ordered exactly with completed targets.',
      });
    }
    if (completion.resultSetSha256 !== sha256AflTradeCanonicalJson(completion.results)) {
      context.addIssue({
        code: 'custom',
        path: ['resultSetSha256'],
        message: 'Completion result-set digest mismatch.',
      });
    }
    if (
      completion.sourceBatchSetSha256 !== sha256AflTradeCanonicalJson(completion.sourceBatchIds)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceBatchSetSha256'],
        message: 'Completion source-batch-set digest mismatch.',
      });
    }
    completion.results.forEach((result, index) => {
      if (result.ordinal !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['results', index, 'ordinal'],
          message: 'Completion results must have contiguous one-based ordinals.',
        });
      }
      if (Date.parse(result.finalizedAt) > Date.parse(completion.completedAt)) {
        context.addIssue({
          code: 'custom',
          path: ['results', index, 'finalizedAt'],
          message: 'Evidence batches must finalize before the completion record.',
        });
      }
    });
  });

export const aflTradeExternalHistoricalCaptureCompletionSchema = z
  .object({
    completionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
    content: completionContentSchema,
  })
  .strict()
  .superRefine((completion, context) => {
    addAflTradeContentAddressIssue(
      'external-historical-capture-completion',
      completion.completionId,
      completion.content,
      context,
      ['completionId']
    );
  });

export type AflTradeExternalHistoricalCaptureCompletion = z.infer<
  typeof aflTradeExternalHistoricalCaptureCompletionSchema
>;
export type AflTradeExternalHistoricalCaptureCompletionResult = z.infer<
  typeof completionResultSchema
>;

export function createAflTradeExternalHistoricalCaptureCompletion(input: {
  plan: AflTradeExternalHistoricalCapturePlan;
  completedAt: string;
  results: readonly AflTradeExternalHistoricalCaptureCompletionResult[];
}): AflTradeExternalHistoricalCaptureCompletion {
  const plan = aflTradeExternalHistoricalCapturePlanSchema.parse(input.plan);
  const results = z.array(completionResultSchema).parse(input.results);
  if (Date.parse(input.completedAt) < Date.parse(plan.content.plannedAt)) {
    throw new TypeError('Historical capture cannot complete before its plan was created.');
  }
  if (results.length !== plan.content.targets.length) {
    throw new TypeError('Historical capture completion must include every planned target.');
  }
  results.forEach((result, index) => {
    const target = plan.content.targets[index];
    if (
      !target ||
      result.ordinal !== target.content.ordinal ||
      result.targetId !== target.targetId ||
      result.scheduleId !== target.content.schedule.scheduleId
    ) {
      throw new TypeError('Historical capture result does not match its exact planned target.');
    }
  });
  const sourceBatchIds = results.map(({ evidenceBatchId }) => evidenceBatchId);
  const content = completionContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_HISTORICAL_CAPTURE_COMPLETION_SCHEMA_VERSION,
    environment: plan.content.environment,
    competition: plan.content.competition,
    planId: plan.planId,
    planSha256: sha256AflTradeCanonicalJson(plan.content),
    targetCount: plan.content.targetCount,
    targetSetSha256: plan.content.targetSetSha256,
    results,
    sourceBatchIds,
    resultSetSha256: sha256AflTradeCanonicalJson(results),
    sourceBatchSetSha256: sha256AflTradeCanonicalJson(sourceBatchIds),
    completedAt: input.completedAt,
    status: 'complete',
    reconciliationEligible: true,
    publicationEligible: false,
  });
  return aflTradeExternalHistoricalCaptureCompletionSchema.parse({
    completionId: createAflTradeContentAddress('external-historical-capture-completion', content),
    content,
  });
}
