import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { specialDraftEntitlementSchema } from './specialDraftEntitlement';

/** The issuing award is independent of later activation, custody and exercise. */
const awardContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-special-entitlement-award/v1'),
    environment: z.enum(['test_fixture', 'non_production']),
    competition: z.string().trim().min(1).max(40),
    issuingAwardId: z.string().trim().min(1).max(500),
    component: z.string().trim().min(1).max(500),
    asset: specialDraftEntitlementSchema,
    holderClubId: z.string().trim().min(1).max(240),
    awardYear: z.number().int().min(1988).max(2200),
    awardedOn: z.iso.date().nullable(),
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
  })
  .strict()
  .superRefine((award, context) => {
    if (
      award.component !== award.asset.sourceLabel ||
      (award.awardedOn !== null && Number(award.awardedOn.slice(0, 4)) !== award.awardYear) ||
      (award.asset.draftYear !== null && award.awardYear > award.asset.draftYear)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Award component, date or source entitlement year is inconsistent.',
      });
    }
    const ids = award.evidence.map(({ captureId }) => captureId);
    if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
      context.addIssue({
        code: 'custom',
        message: 'Award capture references must be unique and sorted.',
      });
    }
  });

export function specialEntitlementAwardIdentity(content: z.infer<typeof awardContentSchema>) {
  return createAflTradeContentAddress('special-draft-entitlement', {
    competition: content.competition,
    issuingAwardId: content.issuingAwardId,
    component: content.component,
    entitlementType: content.asset.entitlementType,
  });
}

export const specialEntitlementAwardSchema = z
  .object({
    entitlementId: aflTradeContentAddressedIdSchema('special-draft-entitlement'),
    content: awardContentSchema,
  })
  .strict()
  .superRefine((award, context) => {
    if (award.entitlementId !== specialEntitlementAwardIdentity(award.content)) {
      context.addIssue({
        code: 'custom',
        message: 'Entitlement identity must bind the exact issuing award and component.',
      });
    }
  });

export function createSpecialEntitlementAward(content: z.input<typeof awardContentSchema>) {
  const parsed = awardContentSchema.parse(content);
  return specialEntitlementAwardSchema.parse({
    entitlementId: specialEntitlementAwardIdentity(parsed),
    content: parsed,
  });
}
