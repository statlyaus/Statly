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
            occurredOn: z.iso.date().nullable(),
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

/** One season's reviewed trade-period window, read from an approved Official AFL capture. */
export interface AflTradeReviewedTradePeriodWindow {
  seasonYear: number;
  datePrecision: {
    precision: 'window';
    eventDate: null;
    earliestDate: string;
    latestDate: string;
  };
}

export interface AflTradeExternalCanonicalPromotionReviewRepository {
  loadCandidate(candidateId: string): Promise<unknown>;
  loadCurrentDecision(
    candidateId: string
  ): Promise<AflTradeExternalCanonicalPromotionReviewDecision | null>;
  /**
   * The reviewed trade-period windows for the given seasons, from finalized evidence of approved
   * `official-afl-trade-period-dates` captures in the candidate's environment and competition
   * (statlyaus/Statly#869). At most one window per season; a season with no reviewed window is
   * absent. Operators never supply a window.
   */
  loadReviewedTradePeriodWindows(input: {
    environment: string;
    competition: string;
    seasons: readonly number[];
  }): Promise<readonly AflTradeReviewedTradePeriodWindow[]>;
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
    transactionDates: await withReviewedTradePeriodWindows(
      candidate,
      input.transactionDates,
      repository
    ),
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

/**
 * A reviewed `occurredOn: null` keeps year-only precision unless the season's trade-period window
 * is on record from an approved Official AFL capture; then the window is the transaction's
 * precision. The window comes from the database, never from the reviewed file, so an operator
 * cannot type one (statlyaus/Statly#869). A transaction the source dates is left alone.
 */
async function withReviewedTradePeriodWindows(
  candidate: AflTradeExternalReconciliationCandidateRecord,
  transactionDates: z.infer<typeof inputSchema>['transactionDates'],
  repository: AflTradeExternalCanonicalPromotionReviewRepository
) {
  if (transactionDates === undefined) return undefined;
  const undatedSeasons = new Map<string, number>();
  for (const transaction of candidate.content.transactions) {
    if (transaction.occurredOn === null)
      undatedSeasons.set(transaction.transactionId, transaction.seasonYear);
  }
  const seasons = [...new Set(undatedSeasons.values())].sort((a, b) => a - b);
  if (seasons.length === 0) return transactionDates;
  const windows = await repository.loadReviewedTradePeriodWindows({
    environment: candidate.content.environment,
    competition: candidate.content.competition,
    seasons,
  });
  const windowBySeason = new Map<number, AflTradeReviewedTradePeriodWindow['datePrecision']>();
  for (const window of windows) {
    if (!seasons.includes(window.seasonYear))
      throw new TypeError('A reviewed trade-period window was returned for an unrequested season.');
    if (windowBySeason.has(window.seasonYear))
      throw new TypeError(`Season ${window.seasonYear} has more than one reviewed trade-period window.`);
    windowBySeason.set(window.seasonYear, window.datePrecision);
  }
  return transactionDates.map((reviewed) => {
    const season = undatedSeasons.get(reviewed.transactionId);
    if (season === undefined || reviewed.occurredOn !== null) return reviewed;
    const datePrecision = windowBySeason.get(season);
    return datePrecision === undefined ? reviewed : { ...reviewed, datePrecision };
  });
}
