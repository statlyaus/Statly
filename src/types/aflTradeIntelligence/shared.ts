import { z } from 'zod';

export const AFL_TRADE_PUBLICATION_STATES = [
  'candidate',
  'validated',
  'approved',
  'published',
  'superseded',
  'rejected',
  'withdrawn',
] as const;

export const AFL_TRADE_NEXT_ACTION_KINDS = [
  'await_source_approval',
  'collect_more_evidence',
  'resolve_identity',
  'resolve_lineage',
  'await_model_approval',
  'await_calculation',
  'view_methodology',
  'retry_later',
] as const;

/** General methodology page used when no publication-specific methodology is selected. */
export const AFL_TRADE_METHODOLOGY_HREF = '/draft/trades/methodology' as const;

export const aflTradePublicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const aflTradeIsoDateTimeSchema = z.iso.datetime({ offset: true });
export const aflTradePublicMessageSchema = z.string().trim().min(1).max(500);
export const aflTradePublicHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^\/(?![/\\])[^\s\\]*$/, 'Public links must be site-relative paths.');
export const aflTradeScopeDescriptionSchema = z.string().trim().min(1).max(300);

export function hasAflTradeDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function addAflTradeUniqueArrayIssue(
  values: readonly string[],
  context: z.RefinementCtx,
  message: string,
  path: (string | number)[]
) {
  if (hasAflTradeDuplicates(values)) context.addIssue({ code: 'custom', message, path });
}

export const aflTradePublicationStateSchema = z.enum(AFL_TRADE_PUBLICATION_STATES);

export const aflTradeTemporalContextSchema = z
  .object({
    effectiveAt: aflTradeIsoDateTimeSchema,
    knowledgeCutoffAt: aflTradeIsoDateTimeSchema,
    valuationAsOf: aflTradeIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const effectiveAt = Date.parse(value.effectiveAt);
    const knowledgeCutoffAt = Date.parse(value.knowledgeCutoffAt);
    const valuationAsOf = Date.parse(value.valuationAsOf);
    if (effectiveAt > valuationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveAt'],
        message: 'The effective time cannot be later than the valuation as-of time.',
      });
    }
    if (knowledgeCutoffAt > valuationAsOf) {
      context.addIssue({
        code: 'custom',
        path: ['knowledgeCutoffAt'],
        message: 'The knowledge cutoff cannot be later than the valuation as-of time.',
      });
    }
  });

export const aflTradePublicationRefSchema = z
  .object({
    publicationId: z.string().regex(/^publication:[a-f0-9]{64}$/),
    state: z.enum(['published', 'superseded', 'withdrawn']),
    valuationBundleId: z.string().regex(/^valuation-bundle:[a-f0-9]{64}$/),
    valueUnitId: aflTradePublicIdSchema,
    publishedAt: aflTradeIsoDateTimeSchema,
  })
  .strict();

export const aflTradePublicWarningSchema = z
  .object({
    code: aflTradePublicIdSchema,
    severity: z.enum(['info', 'warning', 'critical']),
    message: aflTradePublicMessageSchema,
  })
  .strict();

export const aflTradeNextActionSchema = z
  .object({
    kind: z.enum(AFL_TRADE_NEXT_ACTION_KINDS),
    label: z.string().trim().min(1).max(120),
    href: aflTradePublicHrefSchema.nullable(),
    expectedAfter: aflTradeIsoDateTimeSchema.nullable(),
  })
  .strict();

export const aflTradeValueUnitSchema = z
  .object({
    id: aflTradePublicIdSchema,
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    direction: z.literal('higher_is_better'),
  })
  .strict();

export type AflTradePublicationState = z.infer<typeof aflTradePublicationStateSchema>;
export type AflTradeTemporalContext = z.infer<typeof aflTradeTemporalContextSchema>;
export type AflTradePublicationRef = z.infer<typeof aflTradePublicationRefSchema>;
export type AflTradePublicWarning = z.infer<typeof aflTradePublicWarningSchema>;
export type AflTradeNextAction = z.infer<typeof aflTradeNextActionSchema>;
export type AflTradeValueUnit = z.infer<typeof aflTradeValueUnitSchema>;
