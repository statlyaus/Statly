import { z } from 'zod';
import {
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { specialEntitlementRevisionSchema } from './specialEntitlementRevisionContracts';

/** Explicit identity correction. Parsing cannot retire an identity or authorize admission. */
const contentSchema = z.object({
  schemaVersion: z.literal('afl-trade-special-entitlement-identity-replacement/v1'),
  retiredRevision: specialEntitlementRevisionSchema,
  replacementRevision: specialEntitlementRevisionSchema,
  reason: z.string().trim().min(1).max(4000),
  evidence: z.array(z.object({
    captureId: aflTradeContentAddressedIdSchema('source-capture'),
    contentSha256: aflTradeSha256Schema,
    sourceUrl: z.url(),
  }).strict()).min(1).max(100),
  proposedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((content, context) => {
  const before = content.retiredRevision;
  const after = content.replacementRevision;
  const oldAward = before.content.state.award.award;
  const newAward = after.content.state.award.award;
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  if (before.content.entitlementId === after.content.entitlementId)
    issue('Identity replacement requires distinct old and replacement rights.');
  if (oldAward.content.environment !== newAward.content.environment ||
      oldAward.content.competition !== newAward.content.competition)
    issue('Identity replacement must remain in the same environment and competition.');
  const awardOnly = after.content.state.custody.length === 0 && after.content.state.activation === null && after.content.state.exercise === null;
  if (after.content.revision !== (awardOnly ? 1 : 2))
    issue('Replacement must use an exact award-only root or its complete successor.');
  if (Date.parse(content.proposedAt) < Date.parse(before.content.proposedAt) ||
      Date.parse(content.proposedAt) < Date.parse(after.content.proposedAt))
    issue('Replacement review cannot predate either bound revision.');
  const oldEdges = new Map(before.content.state.custody.map((edge) => [edge.transferId, edge]));
  const newEdges = after.content.state.custody;
  if (oldEdges.size !== newEdges.length || newEdges.some((edge) => !oldEdges.has(edge.transferId)))
    issue('Identity replacement must account for the exact retained custody transfer set.');
  if (newEdges.some((edge) => oldEdges.get(edge.transferId)?.assetVersionId === edge.assetVersionId))
    issue('Replacement custody requires new canonical assets bound to the replacement identity.');
  if (new Set(content.evidence.map((reference) => reference.captureId)).size !== content.evidence.length)
    issue('Replacement evidence must not repeat a capture.');
});

export const specialEntitlementIdentityReplacementSchema = z.object({
  replacementId: aflTradeContentAddressedIdSchema('special-entitlement-identity-replacement'),
  content: contentSchema,
}).strict().superRefine((replacement, context) => {
  if (replacement.replacementId !== createAflTradeContentAddress(
    'special-entitlement-identity-replacement', replacement.content
  )) context.addIssue({ code: 'custom', message: 'Identity replacement digest must bind both revisions and evidence.' });
});

export function createSpecialEntitlementIdentityReplacement(content: z.input<typeof contentSchema>) {
  const parsed = contentSchema.parse(content);
  return specialEntitlementIdentityReplacementSchema.parse({
    replacementId: createAflTradeContentAddress('special-entitlement-identity-replacement', parsed),
    content: parsed,
  });
}

export function inspectSpecialEntitlementIdentityReplacement(input: unknown) {
  return {
    replacement: specialEntitlementIdentityReplacementSchema.parse(input),
    authorityVerified: false as const,
    promotionEligible: false as const,
    oldIdentityRetired: false as const,
  };
}
