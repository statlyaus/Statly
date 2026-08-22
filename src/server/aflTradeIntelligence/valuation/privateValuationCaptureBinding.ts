import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';

export const AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_SCHEMA_VERSION =
  'afl-trade-private-valuation-capture-binding/v1' as const;
export const AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION =
  'Accepted non-production source custody only; it grants no factual, model, private-evaluation, or publication authority.' as const;

const instantSchema = z.string().datetime({ offset: true });
const boundedSourceIdSchema = z.string().trim().min(1).max(300);

// This is the exact selected source lineage retained as Stage-1 output custody. Stage 2 must
// compare it with its intended factual scope before it can grant any downstream authority.
export const aflTradePrivateValuationCaptureSourcePlanSchema = z
  .object({
    provider: boundedSourceIdSchema,
    dataset: boundedSourceIdSchema,
    capabilityId: boundedSourceIdSchema,
    competition: z.enum(['AFLM', 'AFLW']),
    seasonYear: z.number().int().min(1897).max(2200),
    fieldMapId: boundedSourceIdSchema,
    gate0AReceiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
  })
  .strict();

export const aflTradePrivateValuationCaptureBindingContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_SCHEMA_VERSION),
    request: aflTradePrivateValuationDispatchRequestSchema,
    dispatchClaimId: z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/),
    attemptSequence: z.number().int().positive(),
    attemptNumber: z.number().int().min(1).max(3),
    sourcePlan: aflTradePrivateValuationCaptureSourcePlanSchema,
    sourceCaptureAttemptId: aflTradeContentAddressedIdSchema('source-capture-attempt'),
    captureReceiptId: aflTradeContentAddressedIdSchema('fitzroy-capture'),
    snapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
    sourceCaptureId: aflTradeContentAddressedIdSchema('source-capture'),
    normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
    acceptedAt: instantSchema,
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    limitation: z.literal(AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION),
  })
  .strict()
  .superRefine((content, context) => {
    if (content.attemptNumber > content.attemptSequence) {
      context.addIssue({
        code: 'custom',
        path: ['attemptNumber'],
        message: 'The technical attempt number cannot exceed its dispatch claim sequence.',
      });
    }
    if (Date.parse(content.acceptedAt) < Date.parse(content.request.scheduledFor)) {
      context.addIssue({
        code: 'custom',
        path: ['acceptedAt'],
        message: 'A capture cannot be accepted before its dispatch was scheduled.',
      });
    }
  });

export const aflTradePrivateValuationCaptureBindingSchema = z
  .object({
    bindingId: aflTradeContentAddressedIdSchema('private-valuation-capture-binding'),
    content: aflTradePrivateValuationCaptureBindingContentSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    addAflTradeContentAddressIssue(
      'private-valuation-capture-binding',
      binding.bindingId,
      binding.content,
      context,
      ['bindingId']
    );
  });

export type AflTradePrivateValuationCaptureBinding = z.infer<
  typeof aflTradePrivateValuationCaptureBindingSchema
>;

export function createAflTradePrivateValuationCaptureBinding(
  input: Omit<
    z.input<typeof aflTradePrivateValuationCaptureBindingContentSchema>,
    'schemaVersion' | 'environment' | 'publicationEligible' | 'limitation'
  >
): AflTradePrivateValuationCaptureBinding {
  const content = aflTradePrivateValuationCaptureBindingContentSchema.parse({
    schemaVersion: AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_SCHEMA_VERSION,
    ...input,
    environment: 'non_production',
    publicationEligible: false,
    limitation: AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION,
  });
  return aflTradePrivateValuationCaptureBindingSchema.parse({
    bindingId: createAflTradeContentAddress('private-valuation-capture-binding', content),
    content,
  });
}

export function parseAflTradePrivateValuationCaptureBinding(
  value: unknown
): AflTradePrivateValuationCaptureBinding {
  return aflTradePrivateValuationCaptureBindingSchema.parse(value);
}
