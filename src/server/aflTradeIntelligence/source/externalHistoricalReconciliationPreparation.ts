import { z } from 'zod';

import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import {
  parseAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from './externalEvidenceReconciliation';
import { buildAflTradeExternalIdentityReviewPackage } from './externalIdentityReviewWorkBuilder';
import { parseAflTradeExternalReconciliationCandidate } from './externalReconciliationCandidateContracts';
import type { AflTradeHistoricalCompletionReconciliationAuthority } from './externalReconciliationSourceAuthorityContracts';
import type {
  AflTradeCurrentCanonicalDraftSelection,
  AflTradeCurrentCanonicalPickCustody,
  AflTradeCurrentCanonicalTransaction,
  AflTradePickLineageDeferral,
  AflTradePromotedSelectionPickState,
} from './pickLineageDeferral';
import type {
  PersistAflTradeExternalReconciliationInput,
  PersistedAflTradeExternalReconciliation,
} from './postgresExternalReconciliationRepository';

const inputSchema = z
  .object({
    completionId: aflTradeContentAddressedIdSchema('external-historical-capture-completion'),
    /** `--defer-pick-lineage`: the approved owner `reconciliation_scope` decision (#869). */
    pickLineageDeferral: z
      .object({ decisionId: aflTradeContentAddressedIdSchema('review-decision') })
      .strict()
      .optional(),
  })
  .strict();

export interface AflTradeHistoricalReconciliationSource {
  load(completionId: string): Promise<{
    environment: 'test_fixture' | 'non_production' | 'production';
    competition: string;
    anchorSeasonYear: number;
    sourceAuthority: AflTradeHistoricalCompletionReconciliationAuthority;
    sourceBatches: readonly unknown[];
  }>;
}

export interface AflTradeHistoricalReconciliationCandidateRepository {
  persistCandidate(
    input: PersistAflTradeExternalReconciliationInput
  ): Promise<PersistedAflTradeExternalReconciliation>;
}

export interface AflTradeHistoricalIdentityReviewRepository {
  loadCurrentResolutions(reviewPackage: unknown): Promise<readonly unknown[]>;
}

/** A stored `outcome_review_decision` row as the scope-decision repository reads it. */
export interface AflTradeReconciliationScopeDecision {
  decisionId: string;
  subjectType: string;
  subjectId: string;
  decision: string;
  decidedAt: string;
  /** No later decision supersedes it. */
  current: boolean;
}

export interface AflTradeReconciliationScopeDecisionReader {
  loadDecision(decisionId: string): Promise<AflTradeReconciliationScopeDecision | null>;
}

/** Current canonical selections, transactions and custody of finalized promotions, by source id. */
export interface AflTradePromotedDraftSelectionReader {
  /**
   * Each current canonical selection with its source selection id, selection number and player
   * (migration 0278), so a re-targeted draftee is re-synced rather than left (#853).
   */
  loadCurrentCanonicalSelections(
    competition: string
  ): Promise<readonly AflTradeCurrentCanonicalDraftSelection[]>;
  /**
   * Each current canonical trade event with the source transfer ids promoted as assets on it and
   * the pick id of each such asset that names one.
   */
  loadCurrentCanonicalTransactions(
    competition: string
  ): Promise<readonly AflTradeCurrentCanonicalTransaction[]>;
  /** Each custody observation canonical under a finalized promotion, with its facts (#853). */
  loadCurrentCanonicalPickCustody(
    competition: string
  ): Promise<readonly AflTradeCurrentCanonicalPickCustody[]>;
  /**
   * Each current canonical selection with its stored pick, club, root and version, and every
   * recorded slot of those roots (migration 0284), so a selection promoted under a number-only pick
   * id is re-keyed to the candidate's custody pick (#853). Without it nothing is re-keyed.
   */
  loadCurrentCanonicalSelectionPicks?(
    competition: string
  ): Promise<AflTradePromotedSelectionPickState>;
}

export interface PrepareAflTradeHistoricalReconciliationDependencies {
  source: AflTradeHistoricalReconciliationSource;
  identityReviewRepository: AflTradeHistoricalIdentityReviewRepository;
  candidateRepository: AflTradeHistoricalReconciliationCandidateRepository;
  /** Required only to prepare with `pickLineageDeferral`. */
  scopeDecisionRepository?: AflTradeReconciliationScopeDecisionReader;
  /**
   * Required only to prepare with `pickLineageDeferral`: a draft whose every selection, a
   * transaction whose every transfer and pick id, and a custody observation whose facts are already
   * current canonical are recorded on the candidate and left to that promotion.
   */
  promotedSelectionRepository?: AflTradePromotedDraftSelectionReader;
}

export interface PreparedAflTradeHistoricalReconciliation extends PersistedAflTradeExternalReconciliation {
  completionId: string;
  requiresReview: boolean;
  promotionEligible: false;
  publicationEligible: false;
  /**
   * The deferral the candidate carries, or null when it deferred nothing and has nothing to re-sync
   * or leave to an earlier promotion, or would write a draft whole (`aflTradeIssuelessDeferralKept`).
   */
  pickLineageDeferral: AflTradePickLineageDeferral | null;
}

export class AflTradeReconciliationScopeDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AflTradeReconciliationScopeDecisionError';
  }
}

/**
 * The deferral decision must be the current approved `reconciliation_scope` decision for exactly the
 * completion being prepared. Anything else refuses preparation before any candidate is built.
 */
async function requireLineageDeferralDecision(
  dependencies: PrepareAflTradeHistoricalReconciliationDependencies,
  completionId: string,
  decisionId: string
): Promise<AflTradeReconciliationScopeDecision> {
  if (dependencies.scopeDecisionRepository === undefined) {
    throw new AflTradeReconciliationScopeDecisionError(
      'Pick-side deferral needs the reconciliation-scope decision repository.'
    );
  }
  if (dependencies.promotedSelectionRepository === undefined) {
    throw new AflTradeReconciliationScopeDecisionError(
      'Pick-side deferral needs the promoted draft-selection reader.'
    );
  }
  const decision = await dependencies.scopeDecisionRepository.loadDecision(decisionId);
  if (
    decision === null ||
    decision.decisionId !== decisionId ||
    decision.subjectType !== 'reconciliation_scope' ||
    decision.subjectId !== completionId ||
    decision.decision !== 'approved' ||
    !decision.current
  ) {
    throw new AflTradeReconciliationScopeDecisionError(
      'The pick-side deferral decision is absent, not approved, superseded, or names another completion.'
    );
  }
  return decision;
}

export async function prepareAflTradeHistoricalReconciliation(
  unparsedInput: unknown,
  dependencies: PrepareAflTradeHistoricalReconciliationDependencies
): Promise<PreparedAflTradeHistoricalReconciliation> {
  const input = inputSchema.parse(unparsedInput);
  const deferralDecision =
    input.pickLineageDeferral === undefined
      ? null
      : await requireLineageDeferralDecision(
          dependencies,
          input.completionId,
          input.pickLineageDeferral.decisionId
        );
  const source = await dependencies.source.load(input.completionId);
  if (source.sourceAuthority.completionId !== input.completionId) {
    throw new TypeError('Loaded historical source does not match the requested completion.');
  }
  const reviewPackage = buildAflTradeExternalIdentityReviewPackage({
    environment: source.environment,
    competition: source.competition,
    sourceAuthority: source.sourceAuthority,
    sourceBatches: source.sourceBatches,
  });
  const identityResolutions = (
    await dependencies.identityReviewRepository.loadCurrentResolutions(reviewPackage)
  )
    .map(parseAflTradeExternalIdentityResolution)
    .sort((left, right) => left.resolutionId.localeCompare(right.resolutionId));
  // Reconciliation time is the latest applicable decision: identity reviews and, when given, the
  // deferral decision, so the stored candidate never predates a decision it relies on.
  const reconciledAt = [
    ...identityResolutions.map(({ content }) => content.decidedAt),
    ...(deferralDecision === null ? [] : [deferralDecision.decidedAt]),
  ].reduce(
    (latest, instant) => (Date.parse(instant) > Date.parse(latest) ? instant : latest),
    source.sourceAuthority.completedAt
  );
  // Drafts already current canonical are left to their promotion; resolved once, before the
  // candidate is built, so the stored candidate says which drafts it leaves and the database checks it.
  const promotedDraftSelections =
    deferralDecision === null
      ? []
      : await dependencies.promotedSelectionRepository!.loadCurrentCanonicalSelections(
          source.competition
        );
  const promotedTransactions =
    deferralDecision === null
      ? []
      : await dependencies.promotedSelectionRepository!.loadCurrentCanonicalTransactions(
          source.competition
        );
  const promotedCustody =
    deferralDecision === null
      ? []
      : await dependencies.promotedSelectionRepository!.loadCurrentCanonicalPickCustody(
          source.competition
        );
  const reader = dependencies.promotedSelectionRepository;
  const promotedSelectionPicks =
    deferralDecision === null || reader?.loadCurrentCanonicalSelectionPicks === undefined
      ? undefined
      : await reader.loadCurrentCanonicalSelectionPicks(source.competition);
  const candidate = parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: source.environment,
      competition: source.competition,
      anchorSeasonYear: source.anchorSeasonYear,
      sourceBatches: source.sourceBatches,
      identityResolutions,
      sourceAuthority: source.sourceAuthority,
      reconciledAt,
      ...(input.pickLineageDeferral === undefined
        ? {}
        : {
            pickLineageDeferral: input.pickLineageDeferral,
            promotedDraftSelections,
            promotedTransactions,
            promotedCustody,
            ...(promotedSelectionPicks === undefined ? {} : { promotedSelectionPicks }),
          }),
    })
  );
  const persisted = await dependencies.candidateRepository.persistCandidate({
    candidate,
    identityResolutions,
  });
  if (persisted.candidateId !== candidate.candidateId) {
    throw new TypeError('Persisted reconciliation does not match the prepared candidate.');
  }
  return {
    ...persisted,
    completionId: input.completionId,
    requiresReview: persisted.blockingIssueCount > 0,
    promotionEligible: false,
    publicationEligible: false,
    pickLineageDeferral: candidate.content.pickLineageDeferral ?? null,
  };
}
