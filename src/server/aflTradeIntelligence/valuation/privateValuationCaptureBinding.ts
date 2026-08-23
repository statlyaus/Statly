import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradePrivateValuationDispatchRequestSchema } from './privateValuationScheduling';

export const AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_SCHEMA_VERSION =
  'afl-trade-private-valuation-capture-binding/v1' as const;
export const AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION =
  'afl-trade-private-valuation-capture-binding/v2' as const;
export const AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION =
  'Accepted non-production source custody only; it grants no factual, model, private-evaluation, or publication authority.' as const;

const instantSchema = z.string().datetime({ offset: true });
const boundedSourceIdSchema = z.string().trim().min(1).max(300);

export const aflTradePrivateValuationCaptureSourceRoleSchema = z.enum([
  'factual_input',
  'hpn_completed_results',
  'hpn_primary_player_stats',
  'hpn_corroborating_player_stats',
]);
export type AflTradePrivateValuationCaptureSourceRole = z.infer<
  typeof aflTradePrivateValuationCaptureSourceRoleSchema
>;

// This is the exact selected source lineage retained as Stage-1 output custody. Stage 2 must
// compare it with its intended factual scope before it can grant any downstream authority.
const captureSourcePlanShape = {
  provider: boundedSourceIdSchema,
  dataset: boundedSourceIdSchema,
  capabilityId: boundedSourceIdSchema,
  competition: z.enum(['AFLM', 'AFLW']),
  seasonYear: z.number().int().min(1897).max(2200),
  fieldMapId: boundedSourceIdSchema,
  gate0AReceiptId: aflTradeContentAddressedIdSchema('gate0a-evaluation'),
} as const;

export const aflTradePrivateValuationCaptureSourcePlanSchema = z.object(captureSourcePlanShape).strict();

export const aflTradePrivateValuationCaptureSourcePlanV2Schema = z
  .object({
    ...captureSourcePlanShape,
    rightsArtifactId: aflTradeContentAddressedIdSchema('source-rights'),
  })
  .strict();

const captureBindingContentShape = {
  request: aflTradePrivateValuationDispatchRequestSchema,
  dispatchClaimId: z.string().regex(/^private-valuation-dispatch-claim:[a-f0-9]{64}$/),
  attemptSequence: z.number().int().positive(),
  attemptNumber: z.number().int().min(1).max(3),
  sourceCaptureAttemptId: aflTradeContentAddressedIdSchema('source-capture-attempt'),
  captureReceiptId: aflTradeContentAddressedIdSchema('fitzroy-capture'),
  snapshotId: aflTradeContentAddressedIdSchema('source-snapshot'),
  sourceCaptureId: aflTradeContentAddressedIdSchema('source-capture'),
  normalizationRunId: aflTradeContentAddressedIdSchema('provider-normalization-run'),
  acceptedAt: instantSchema,
  environment: z.literal('non_production'),
  publicationEligible: z.literal(false),
  limitation: z.literal(AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_LIMITATION),
} as const;

function refineCaptureBindingChronology(
  content: {
    readonly attemptNumber: number;
    readonly attemptSequence: number;
    readonly acceptedAt: string;
    readonly request: { readonly scheduledFor: string };
  },
  context: z.RefinementCtx
): void {
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
}

export const aflTradePrivateValuationCaptureBindingV1ContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_SCHEMA_VERSION),
    ...captureBindingContentShape,
    sourcePlan: aflTradePrivateValuationCaptureSourcePlanSchema,
  })
  .strict()
  .superRefine(refineCaptureBindingChronology);

export const aflTradePrivateValuationCaptureBindingV2ContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_V2_SCHEMA_VERSION),
    ...captureBindingContentShape,
    sourceRole: aflTradePrivateValuationCaptureSourceRoleSchema,
    sourcePlan: aflTradePrivateValuationCaptureSourcePlanV2Schema,
  })
  .strict()
  .superRefine(refineCaptureBindingChronology);

export const aflTradePrivateValuationCaptureBindingContentSchema = z.union([
  aflTradePrivateValuationCaptureBindingV1ContentSchema,
  aflTradePrivateValuationCaptureBindingV2ContentSchema,
]);

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
    z.input<typeof aflTradePrivateValuationCaptureBindingV1ContentSchema>,
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

export function getAflTradePrivateValuationCaptureSourceRole(
  binding: AflTradePrivateValuationCaptureBinding
): AflTradePrivateValuationCaptureSourceRole {
  return binding.content.schemaVersion ===
    AFL_TRADE_PRIVATE_VALUATION_CAPTURE_BINDING_SCHEMA_VERSION
    ? 'factual_input'
    : binding.content.sourceRole;
}

export function parseAflTradePrivateValuationCaptureBinding(
  value: unknown
): AflTradePrivateValuationCaptureBinding {
  return aflTradePrivateValuationCaptureBindingSchema.parse(value);
}
