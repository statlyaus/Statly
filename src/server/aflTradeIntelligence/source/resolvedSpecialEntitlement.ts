import { z } from 'zod';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import { specialDraftEntitlementSchema } from './specialDraftEntitlement';

export const canonicalPickEntitlementSchema = z
  .object({
    kind: z.literal('pick_entitlement'),
    pickId: aflTradeContentAddressedIdSchema('draft-pick'),
    draftYear: z.number().int().min(1897).max(2200),
    draftType: z.string().trim().min(1).max(80),
    nominalRound: z.number().int().positive().nullable(),
    nominalPick: z.number().int().positive().nullable(),
    originalClubId: z.string().trim().min(1).max(240).nullable(),
    recordedLabel: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

/** Reviewed resolution references. The database still authenticates the award and custody chain. */
export const resolvedSpecialEntitlementSchema = z
  .object({
    kind: z.literal('special_entitlement'),
    entitlementId: aflTradeContentAddressedIdSchema('special-draft-entitlement'),
    awardApprovalDecisionId: z.string().min(1),
    sourceCandidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    sourceAsset: z.union([specialDraftEntitlementSchema, canonicalPickEntitlementSchema]),
    predecessorTransferId: aflTradeContentAddressedIdSchema('external-transfer').nullable(),
  })
  .strict();
