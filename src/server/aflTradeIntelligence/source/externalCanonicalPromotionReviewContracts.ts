import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  aflTradeSha256Schema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import { aflTradeExternalCanonicalPromotionProposalSchema } from './externalCanonicalPromotionContracts';

export const AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_REVIEW_SCHEMA_VERSION =
  'afl-trade-external-canonical-promotion-review/v1' as const;

const instantSchema = z.iso.datetime({ offset: true });
const decisionIdSchema = aflTradeContentAddressedIdSchema('review-decision');

const reviewContentSchema = z
  .object({
    schemaVersion: z.literal(AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_REVIEW_SCHEMA_VERSION),
    candidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    proposalId: aflTradeContentAddressedIdSchema('external-canonical-promotion-proposal'),
    proposalSha256: aflTradeSha256Schema,
    proposal: aflTradeExternalCanonicalPromotionProposalSchema,
    revision: z.number().int().positive(),
    supersedesDecisionId: decisionIdSchema.nullable(),
    decision: z.enum(['approved', 'rejected', 'withdrawn']),
    rationale: z.string().trim().min(1).max(4_000),
    authorityEvidenceId: aflTradeContentAddressedIdSchema('reviewer-authority-evidence'),
    decidedBy: z.string().trim().min(1).max(240),
    decidedAt: instantSchema,
    publicationEligible: z.literal(false),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      content.candidateId !== content.proposal.content.candidateId ||
      content.proposalId !== content.proposal.proposalId ||
      content.proposalId !== `external-canonical-promotion-proposal:${content.proposalSha256}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['proposalId'],
        message: 'Promotion review must pin one exact candidate proposal.',
      });
    }
    if ((content.revision === 1) !== (content.supersedesDecisionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['revision'],
        message: 'Only revision one may omit a predecessor decision.',
      });
    }
    if (Date.parse(content.decidedAt) < Date.parse(content.proposal.content.proposedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['decidedAt'],
        message: 'Promotion review cannot predate its proposal.',
      });
    }
  });

export const aflTradeExternalCanonicalPromotionReviewDecisionSchema = z
  .object({
    decisionId: decisionIdSchema,
    content: reviewContentSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    addAflTradeContentAddressIssue(
      'review-decision',
      decision.decisionId,
      decision.content,
      context,
      ['decisionId']
    );
  });

export type AflTradeExternalCanonicalPromotionReviewDecision = z.infer<
  typeof aflTradeExternalCanonicalPromotionReviewDecisionSchema
>;

export function createAflTradeExternalCanonicalPromotionReviewDecision(
  content: Omit<z.input<typeof reviewContentSchema>, 'schemaVersion' | 'publicationEligible'>
): AflTradeExternalCanonicalPromotionReviewDecision {
  const parsed = reviewContentSchema.parse({
    schemaVersion: AFL_TRADE_EXTERNAL_CANONICAL_PROMOTION_REVIEW_SCHEMA_VERSION,
    ...content,
    publicationEligible: false,
  });
  return aflTradeExternalCanonicalPromotionReviewDecisionSchema.parse({
    decisionId: createAflTradeContentAddress('review-decision', parsed),
    content: parsed,
  });
}

export function parseAflTradeExternalCanonicalPromotionReviewDecision(
  input: unknown
): AflTradeExternalCanonicalPromotionReviewDecision {
  return aflTradeExternalCanonicalPromotionReviewDecisionSchema.parse(input);
}
