import { z } from 'zod';
import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
} from '../artifacts/contentAddress';

const base = {
  schemaVersion: z.literal('afl-trade-special-entitlement-lifecycle/v1'),
  entitlementId: aflTradeContentAddressedIdSchema('special-draft-entitlement'),
  evidence: z
    .array(
      z
        .object({
          captureId: aflTradeContentAddressedIdSchema('source-capture'),
          contentSha256: aflTradeSha256Schema,
          sourceUrl: z.url(),
        })
        .strict()
    )
    .min(1)
    .max(100),
};

/** Retrospective source-to-selection mapping; database authentication binds the actual custody. */
const renumberingSchema = z
  .object({
    transferId: aflTradeContentAddressedIdSchema('external-transfer'),
    sourcePickId: aflTradeContentAddressedIdSchema('draft-pick'),
    targetPickId: aflTradeContentAddressedIdSchema('draft-pick'),
    occurredAt: z.union([
      z.object({ precision: z.literal('day'), date: z.iso.date() }).strict(),
      z
        .object({ precision: z.literal('year'), year: z.number().int().min(1988).max(2200) })
        .strict(),
    ]),
    evidenceCaptureIds: z.array(aflTradeContentAddressedIdSchema('source-capture')).min(1).max(100),
  })
  .strict();

/** Activation records evidence of use-year eligibility, not an invented notice timestamp. */
export const specialEntitlementLifecycleSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        ...base,
        kind: z.literal('activation'),
        useYear: z.number().int().min(1988).max(2200),
        noticeYear: z.number().int().min(1988).max(2200).nullable(),
        noticedOn: z.iso.date().nullable(),
        rule: z.enum(['deferred_nomination', 'initial_year_exception']),
        expiresAfterYear: z.number().int().min(1988).max(2200),
      })
      .strict(),
    z
      .object({
        ...base,
        kind: z.literal('exercise'),
        selectionId: z.string().trim().min(1),
        terminalTransferId: aflTradeContentAddressedIdSchema('external-transfer'),
        renumbering: z.array(renumberingSchema).min(1).max(10000).optional(),
      })
      .strict(),
  ])
  .superRefine((record, context) => {
    if (new Set(record.evidence.map((item) => item.captureId)).size !== record.evidence.length) {
      context.addIssue({ code: 'custom', message: 'Lifecycle capture references must be unique.' });
    }
    if (record.kind === 'exercise' && record.renumbering) {
      const transfers = new Set<string>();
      const successors = new Map<string, string>();
      const evidence = new Set(record.evidence.map((item) => item.captureId));
      for (const binding of record.renumbering) {
        if (
          transfers.has(binding.transferId) ||
          binding.sourcePickId === binding.targetPickId ||
          (successors.has(binding.sourcePickId) &&
            successors.get(binding.sourcePickId) !== binding.targetPickId) ||
          new Set(binding.evidenceCaptureIds).size !== binding.evidenceCaptureIds.length ||
          binding.evidenceCaptureIds.some((captureId) => !evidence.has(captureId))
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'Renumbering requires unique custody, distinct consistent picks and retained lifecycle evidence.',
          });
        }
        transfers.add(binding.transferId);
        successors.set(binding.sourcePickId, binding.targetPickId);
      }
    }
    if (
      record.kind === 'activation' &&
      ((record.noticeYear !== null && record.noticeYear > record.useYear) ||
        record.useYear > record.expiresAfterYear ||
        (record.noticedOn !== null && Number(record.noticedOn.slice(0, 4)) !== record.noticeYear))
    )
      context.addIssue({
        code: 'custom',
        message: 'Activation date and use-year bounds are inconsistent.',
      });
  });
