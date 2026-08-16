import { z } from 'zod';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import {
  authenticateAflTradeWorkbookTransactionReviewSet,
  type AflTradeWorkbookTransactionReviewSet,
} from './workbookTransactionReviewSet';

export const AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_SCHEMA_VERSION =
  'afl-trade-workbook-transaction-review-decision/v1' as const;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface ReviewDecisionBaseInput {
  reviewSet: AflTradeWorkbookTransactionReviewSet;
  reviewSubjectId: string;
  revision: number;
  supersedesDecisionId: string | null;
  reviewerId: string;
  rationale: string;
  decidedAt: string;
}

type ReviewDecisionInput =
  | (ReviewDecisionBaseInput & {
      outcome: 'approved';
      canonicalClubIds: readonly string[];
      transferDirection: 'listed_club_received_assets';
    })
  | (ReviewDecisionBaseInput & {
      outcome: 'rejected';
      canonicalClubIds?: never;
      transferDirection?: never;
    });

export interface AflTradeWorkbookTransactionReviewDecision {
  decisionId: string;
  content: Readonly<{
    schemaVersion: typeof AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_SCHEMA_VERSION;
    reviewSetId: string;
    reviewSubjectId: string;
    reviewSubjectSha256: string;
    revision: number;
    supersedesDecisionId: string | null;
    outcome: 'approved' | 'rejected';
    canonicalClubIds: readonly string[];
    transferDirection: 'listed_club_received_assets' | null;
    reviewerId: string;
    rationale: string;
    decidedAt: string;
    authority: 'private_workbook_migration_oracle_review';
    publicationEligible: false;
    publicationProhibited: true;
  }>;
}

const workbookTransactionReviewDecisionSchema = z
  .object({
    decisionId: z.string().trim().min(1).max(512),
    content: z
      .object({
        schemaVersion: z.literal(AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_SCHEMA_VERSION),
        reviewSetId: z.string().trim().min(1).max(512),
        reviewSubjectId: z.string().trim().min(1).max(512),
        reviewSubjectSha256: z.string().regex(/^[a-f0-9]{64}$/),
        revision: z.number().int().positive(),
        supersedesDecisionId: z.string().trim().min(1).max(512).nullable(),
        outcome: z.enum(['approved', 'rejected']),
        canonicalClubIds: z.array(z.string().trim().min(1).max(240)),
        transferDirection: z.literal('listed_club_received_assets').nullable(),
        reviewerId: z.string().trim().min(1).max(240),
        rationale: z.string().trim().min(1).max(2_000),
        decidedAt: z.string().regex(INSTANT),
        authority: z.literal('private_workbook_migration_oracle_review'),
        publicationEligible: z.literal(false),
        publicationProhibited: z.literal(true),
      })
      .strict(),
  })
  .strict();

export interface AflTradeWorkbookTransactionOracleFact {
  oracleRowId: string;
  kind: 'transaction';
  seasonYear: number;
  title: string;
  parties: readonly string[];
}

export interface AflTradeWorkbookTransactionReviewAssessment {
  reviewSetId: string;
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  readyForShadowOracle: boolean;
}

function requireBoundedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`${label} must be non-empty and bounded.`);
  }
  return normalized;
}

export function authenticateAflTradeWorkbookTransactionReviewDecision(
  decision: AflTradeWorkbookTransactionReviewDecision
): void {
  if (
    decision.content.schemaVersion !==
      AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_SCHEMA_VERSION ||
    decision.content.authority !== 'private_workbook_migration_oracle_review' ||
    decision.content.publicationEligible !== false ||
    decision.content.publicationProhibited !== true ||
    !INSTANT.test(decision.content.decidedAt) ||
    (decision.content.revision === 1) !== (decision.content.supersedesDecisionId === null) ||
    !decision.content.reviewerId.trim() ||
    !decision.content.rationale.trim() ||
    (decision.content.outcome === 'approved' &&
      (decision.content.transferDirection !== 'listed_club_received_assets' ||
        new Set(decision.content.canonicalClubIds).size !==
          decision.content.canonicalClubIds.length ||
        decision.content.canonicalClubIds.some(
          (clubId) => !clubId.trim() || clubId.length > 240
        ))) ||
    (decision.content.outcome === 'rejected' &&
      (decision.content.transferDirection !== null ||
        decision.content.canonicalClubIds.length !== 0)) ||
    decision.decisionId !==
      createAflTradeContentAddress('workbook-transaction-review-decision', decision.content)
  ) {
    throw new TypeError('Workbook transaction review decision failed exact authentication.');
  }
}

export function parseAflTradeWorkbookTransactionReviewDecision(
  input: unknown
): AflTradeWorkbookTransactionReviewDecision {
  try {
    const parsed = workbookTransactionReviewDecisionSchema.parse(
      input
    ) as AflTradeWorkbookTransactionReviewDecision;
    authenticateAflTradeWorkbookTransactionReviewDecision(parsed);
    return parsed;
  } catch {
    throw new TypeError('Workbook transaction review decision failed exact authentication.');
  }
}

export function createAflTradeWorkbookTransactionReviewDecision(
  input: ReviewDecisionInput
): AflTradeWorkbookTransactionReviewDecision {
  authenticateAflTradeWorkbookTransactionReviewSet(input.reviewSet);
  const subject = input.reviewSet.content.transactions.find(
    ({ reviewSubjectId }) => reviewSubjectId === input.reviewSubjectId
  );
  if (!subject) {
    throw new TypeError('Review decision must reference one exact transaction review subject.');
  }
  const reviewerId = requireBoundedText(input.reviewerId, 'Reviewer identity', 240);
  const rationale = requireBoundedText(input.rationale, 'Review rationale', 2_000);
  if (
    !Number.isInteger(input.revision) ||
    input.revision < 1 ||
    (input.revision === 1) !== (input.supersedesDecisionId === null) ||
    (input.supersedesDecisionId !== null && !input.supersedesDecisionId.trim())
  ) {
    throw new TypeError('Review decision must form an explicit append-only revision chain.');
  }
  if (!INSTANT.test(input.decidedAt) || Number.isNaN(Date.parse(input.decidedAt))) {
    throw new TypeError('Review decision time must be an exact UTC instant.');
  }

  const canonicalClubIds =
    input.outcome === 'approved'
      ? input.canonicalClubIds.map((clubId) => requireBoundedText(clubId, 'Canonical club ID', 240))
      : [];
  if (
    input.outcome === 'approved' &&
    (input.transferDirection !== 'listed_club_received_assets' ||
      canonicalClubIds.length !== subject.parties.length ||
      new Set(canonicalClubIds).size !== canonicalClubIds.length)
  ) {
    throw new TypeError(
      'An approved review must resolve every party to a distinct canonical club.'
    );
  }
  const content = {
    schemaVersion: AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_SCHEMA_VERSION,
    reviewSetId: input.reviewSet.reviewSetId,
    reviewSubjectId: subject.reviewSubjectId,
    reviewSubjectSha256: sha256AflTradeCanonicalJson(subject),
    revision: input.revision,
    supersedesDecisionId: input.supersedesDecisionId,
    outcome: input.outcome,
    canonicalClubIds,
    transferDirection:
      input.outcome === 'approved' ? ('listed_club_received_assets' as const) : null,
    reviewerId,
    rationale,
    decidedAt: input.decidedAt,
    authority: 'private_workbook_migration_oracle_review' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  return {
    decisionId: createAflTradeContentAddress('workbook-transaction-review-decision', content),
    content,
  };
}

export function createAflTradeWorkbookTransactionOracleFacts(input: {
  reviewSet: AflTradeWorkbookTransactionReviewSet;
  currentDecisions: readonly AflTradeWorkbookTransactionReviewDecision[];
}): readonly AflTradeWorkbookTransactionOracleFact[] {
  authenticateAflTradeWorkbookTransactionReviewSet(input.reviewSet);
  input.currentDecisions.forEach(authenticateAflTradeWorkbookTransactionReviewDecision);
  const decisionBySubject = new Map(
    input.currentDecisions.map((decision) => [decision.content.reviewSubjectId, decision])
  );
  if (
    decisionBySubject.size !== input.currentDecisions.length ||
    decisionBySubject.size !== input.reviewSet.content.transactions.length
  ) {
    throw new TypeError('Shadow-oracle facts require one complete approved current decision set.');
  }

  return input.reviewSet.content.transactions.map((subject) => {
    const decision = decisionBySubject.get(subject.reviewSubjectId);
    if (
      !decision ||
      decision.content.reviewSetId !== input.reviewSet.reviewSetId ||
      decision.content.reviewSubjectSha256 !== sha256AflTradeCanonicalJson(subject) ||
      decision.content.outcome !== 'approved' ||
      decision.content.transferDirection !== 'listed_club_received_assets' ||
      decision.content.canonicalClubIds.length !== subject.parties.length
    ) {
      throw new TypeError(
        'Shadow-oracle facts require one complete approved current decision set.'
      );
    }
    return {
      oracleRowId: subject.reviewSubjectId,
      kind: 'transaction' as const,
      seasonYear: subject.seasonYear,
      title: subject.sourceTitle,
      parties: decision.content.canonicalClubIds,
    };
  });
}

export function assessAflTradeWorkbookTransactionReviewSet(input: {
  reviewSet: AflTradeWorkbookTransactionReviewSet;
  currentDecisions: readonly AflTradeWorkbookTransactionReviewDecision[];
}): AflTradeWorkbookTransactionReviewAssessment {
  authenticateAflTradeWorkbookTransactionReviewSet(input.reviewSet);
  input.currentDecisions.forEach(authenticateAflTradeWorkbookTransactionReviewDecision);
  const subjectById = new Map(
    input.reviewSet.content.transactions.map((subject) => [subject.reviewSubjectId, subject])
  );
  const decisionBySubject = new Map<string, AflTradeWorkbookTransactionReviewDecision>();
  for (const decision of input.currentDecisions) {
    if (
      decision.content.reviewSetId !== input.reviewSet.reviewSetId ||
      !subjectById.has(decision.content.reviewSubjectId) ||
      decisionBySubject.has(decision.content.reviewSubjectId)
    ) {
      throw new TypeError('Current review decisions must map uniquely to the exact review set.');
    }
    const subject = subjectById.get(decision.content.reviewSubjectId)!;
    if (
      decision.content.reviewSubjectSha256 !== sha256AflTradeCanonicalJson(subject) ||
      (decision.content.outcome === 'approved' &&
        decision.content.canonicalClubIds.length !== subject.parties.length)
    ) {
      throw new TypeError('Current review decision does not bind the exact review subject.');
    }
    decisionBySubject.set(decision.content.reviewSubjectId, decision);
  }
  const approved = [...decisionBySubject.values()].filter(
    ({ content }) => content.outcome === 'approved'
  ).length;
  const rejected = decisionBySubject.size - approved;
  const pending = subjectById.size - decisionBySubject.size;
  return {
    reviewSetId: input.reviewSet.reviewSetId,
    total: subjectById.size,
    approved,
    rejected,
    pending,
    readyForShadowOracle: approved === subjectById.size && rejected === 0 && pending === 0,
  };
}
