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
      })
      .strict(),
  ])
  .superRefine((record, context) => {
    if (new Set(record.evidence.map((item) => item.captureId)).size !== record.evidence.length) {
      context.addIssue({ code: 'custom', message: 'Lifecycle capture references must be unique.' });
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
