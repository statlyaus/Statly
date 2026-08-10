import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import {
  deriveAflTradeExternalCanonicalPromotionProposal,
  type AflTradeExternalCanonicalPromotionProposal,
} from './externalCanonicalPromotionContracts';
import {
  createAflTradeExternalCanonicalPromotionReviewDecision,
  type AflTradeExternalCanonicalPromotionReviewDecision,
} from './externalCanonicalPromotionReviewContracts';
import {
  parseAflTradeExternalReconciliationCandidate,
  type AflTradeExternalReconciliationCandidateRecord,
} from './externalReconciliationCandidateContracts';

const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid UTC instant.');

const inputSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('external-reconciliation'),
    proposedAt: instantSchema,
    draftEvents: z
      .array(
        z
          .object({
            draftYear: z.number().int().min(1897).max(2200),
            draftType: z.string().trim().min(1).max(80),
            eventDate: z.iso.date(),
            officialName: z.string().trim().min(1).max(1_000),
          })
          .strict()
      )
      .max(100),
    transactionDates: z
      .array(
        z
          .object({
            transactionId: aflTradeContentAddressedIdSchema('external-transaction'),
            occurredOn: z.iso.date(),
          })
          .strict()
      )
      .max(10_000)
      .optional(),
    decision: z.enum(['approved', 'rejected', 'withdrawn']),
    rationale: z.string().trim().min(1).max(4_000),
    authorityEvidenceId: aflTradeContentAddressedIdSchema('reviewer-authority-evidence'),
    decidedBy: z.string().trim().min(1).max(240),
    decidedAt: instantSchema,
  })
  .strict();

export interface PersistAflTradeExternalCanonicalPromotionReviewInput {
  candidate: AflTradeExternalReconciliationCandidateRecord;
  proposal: AflTradeExternalCanonicalPromotionProposal;
  decision: AflTradeExternalCanonicalPromotionReviewDecision;
}

export interface PersistedAflTradeExternalCanonicalPromotionReview {
  candidateId: string;
  proposalId: string;
  decisionId: string;
  revision: number;
  status: 'approved' | 'rejected' | 'withdrawn';
  idempotentReplay: boolean;
}

export interface AflTradeExternalCanonicalPromotionReviewRepository {
  loadCandidate(candidateId: string): Promise<unknown>;
  loadCurrentDecision(
    candidateId: string
  ): Promise<AflTradeExternalCanonicalPromotionReviewDecision | null>;
  persistDecision(
    input: PersistAflTradeExternalCanonicalPromotionReviewInput
  ): Promise<PersistedAflTradeExternalCanonicalPromotionReview>;
}

export async function recordAflTradeExternalCanonicalPromotionReview(
  unparsedInput: unknown,
  repository: AflTradeExternalCanonicalPromotionReviewRepository
): Promise<PersistedAflTradeExternalCanonicalPromotionReview> {
  const input = inputSchema.parse(unparsedInput);
  const candidate = parseAflTradeExternalReconciliationCandidate(
    await repository.loadCandidate(input.candidateId)
  );
  if (candidate.candidateId !== input.candidateId) {
    throw new TypeError('Loaded candidate does not match the requested candidate.');
  }
  const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
    candidate,
    proposedAt: input.proposedAt,
    draftEvents: input.draftEvents,
    transactionDates: input.transactionDates,
  });
  const current = await repository.loadCurrentDecision(candidate.candidateId);
  const decision = createAflTradeExternalCanonicalPromotionReviewDecision({
    candidateId: candidate.candidateId,
    proposalId: proposal.proposalId,
    proposalSha256: proposal.proposalId.split(':')[1] ?? '',
    proposal,
    revision: (current?.content.revision ?? 0) + 1,
    supersedesDecisionId: current?.decisionId ?? null,
    decision: input.decision,
    rationale: input.rationale,
    authorityEvidenceId: input.authorityEvidenceId,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
  });
  return repository.persistDecision({ candidate, proposal, decision });
}
