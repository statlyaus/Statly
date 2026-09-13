import { draftSessionDateWindowSchema, draftSessionDatePrecisionSchema, draftSessionDefinitelyPrecedes } from './draftSessionDatePrecision';
import { z } from 'zod';
import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';

const sortedIds = (prefix: string) =>
  z
    .array(aflTradeContentAddressedIdSchema(prefix))
    .min(1)
    .max(5000)
    .refine(
      (ids) => ids.every((id, index) => index === 0 || ids[index - 1]! < id),
      'Proof IDs must be unique and sorted.'
    );
const sessionSchema = z
  .object({
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().min(1).max(80),
    officialName: z.string().min(1).max(1000),
    sessionOrdinal: z.number().int().min(1).max(100),
    eventDate: z.iso.date(),
    selectionIds: sortedIds('external-draft-selection'),
    evidenceIds: sortedIds('external-evidence'),
  })
  .strict();
const legacyRetainedDraftSessionProjectionSchema = z
  .object({
    schemaVersion: z.enum([
      'afl-trade-combined-draft-session-projection/v1',
      'afl-trade-reported-draft-session-projection/v1',
    ]),
    inventorySelectionIds: sortedIds('external-draft-selection'),
    selectedSelectionIds: sortedIds('external-draft-selection'),
    inventorySessions: z.array(sessionSchema).min(1).max(100),
    selectedSessions: z.array(sessionSchema).min(1).max(100),
  })
  .strict()
  .superRefine((proof, ctx) => {
    const first = proof.inventorySessions[0]!;
    const selected = new Set(proof.selectedSelectionIds);
    const members = proof.inventorySessions.flatMap((s) => s.selectionIds).sort();
    const projected = proof.inventorySessions
      .map((s) => ({ ...s, selectionIds: s.selectionIds.filter((id) => selected.has(id)) }))
      .filter((s) => s.selectionIds.length);
    if (
      canonicalizeAflTradeJson(members) !== canonicalizeAflTradeJson(proof.inventorySelectionIds) ||
      proof.selectedSelectionIds.some((id) => !proof.inventorySelectionIds.includes(id)) ||
      canonicalizeAflTradeJson(projected) !== canonicalizeAflTradeJson(proof.selectedSessions) ||
      proof.inventorySessions.some(
        (s, index) =>
          s.draftYear !== first.draftYear ||
          s.draftType !== first.draftType ||
          Number(s.eventDate.slice(0, 4)) !== s.draftYear ||
          s.sessionOrdinal !== index + 1 ||
          (index > 0 && s.eventDate < proof.inventorySessions[index - 1]!.eventDate)
      )
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Session projection must preserve exact complete inventory, chronology and selected membership.',
      });
  });
const precisionSessionSchema = sessionSchema.extend({
  eventDate: z.iso.date().nullable(),
  datePrecision: draftSessionDateWindowSchema.optional(),
}).superRefine((session, context) => {
  if (session.eventDate === null
      ? !session.datePrecision || Number(session.datePrecision.earliestDate.slice(0, 4)) !== session.draftYear
      : session.datePrecision !== undefined || Number(session.eventDate.slice(0, 4)) !== session.draftYear) {
    context.addIssue({code: 'custom', message: 'Window sessions require null exact day and same-year bounds; exact days cannot carry a window.'});
  }
});

export const retainedPrecisionDraftSessionProjectionSchema = z.object({
  schemaVersion: z.literal('afl-trade-combined-draft-session-projection/v2'),
  inventorySelectionIds: sortedIds('external-draft-selection'),
  selectedSelectionIds: sortedIds('external-draft-selection'),
  inventorySessions: z.array(precisionSessionSchema).min(1).max(100),
  selectedSessions: z.array(precisionSessionSchema).min(1).max(100),
}).strict().superRefine((proof, context) => {
  const first = proof.inventorySessions[0]!;
  const selected = new Set(proof.selectedSelectionIds);
  const members = proof.inventorySessions.flatMap(s => s.selectionIds).sort();
  const projected = proof.inventorySessions.map(s => ({...s, selectionIds: s.selectionIds.filter(id => selected.has(id))})).filter(s => s.selectionIds.length);
  const invalidChronology = proof.inventorySessions.some((session, index) => {
    if (session.draftYear !== first.draftYear || session.draftType !== first.draftType || session.sessionOrdinal !== index + 1) return true;
    if (!index) return false;
    const previous = proof.inventorySessions[index - 1]!;
    const left = previous.eventDate === null ? previous.datePrecision : {precision: 'day' as const, eventDate: previous.eventDate};
    const right = session.eventDate === null ? session.datePrecision : {precision: 'day' as const, eventDate: session.eventDate};
    const validLeft = draftSessionDatePrecisionSchema.safeParse(left);
    const validRight = draftSessionDatePrecisionSchema.safeParse(right);
    if (!validLeft.success || !validRight.success) return true;
    return !draftSessionDefinitelyPrecedes(validLeft.data, validRight.data);
  });
  if (invalidChronology || canonicalizeAflTradeJson(members) !== canonicalizeAflTradeJson(proof.inventorySelectionIds) ||
      proof.selectedSelectionIds.some(id => !proof.inventorySelectionIds.includes(id)) ||
      canonicalizeAflTradeJson(projected) !== canonicalizeAflTradeJson(proof.selectedSessions)) {
    context.addIssue({code: 'custom', message: 'Window projection must preserve complete inventory, disjoint chronology, bounds and exact selected membership.'});
  }
});

export const retainedDraftSessionProjectionSchema = z.union([
  legacyRetainedDraftSessionProjectionSchema,
  retainedPrecisionDraftSessionProjectionSchema,
]);

export const reviewedSessionCorrectionSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-reviewed-session-correction/v1'),
    parentCandidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    sourceCompletionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
    projections: z.array(retainedDraftSessionProjectionSchema).min(1).max(100),
  })
  .strict()
  .superRefine((marker, ctx) => {
    const keys = marker.projections.map(
      (p) => `${p.inventorySessions[0]!.draftYear}|${p.inventorySessions[0]!.draftType}`
    );
    if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key))
      ctx.addIssue({
        code: 'custom',
        message: 'Session projection groups must be unique and sorted.',
      });
  });

/** A later session correction adds groups without rewriting a previously authenticated proof. */
export function assertReviewedSessionProjectionExtension(
  previous: z.infer<typeof reviewedSessionCorrectionSchema> | undefined,
  projections: z.infer<typeof retainedDraftSessionProjectionSchema>[]
): void {
  if (!previous) return;
  if (
    projections.length <= previous.projections.length ||
    previous.projections.some(
      (prior) =>
        !projections.some(
          (next) => canonicalizeAflTradeJson(next) === canonicalizeAflTradeJson(prior)
        )
    )
  )
    throw new TypeError(
      'Session successor must add groups and preserve every prior projection exactly.'
    );
}
