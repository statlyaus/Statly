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
export const AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_V2_SCHEMA_VERSION =
  'afl-trade-workbook-transaction-review-decision/v2' as const;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

export interface AflTradeWorkbookTransactionReviewAssetV2 {
  assetId: string;
  sourceAssetText: string;
  assetKind: 'player' | 'pick' | 'future_pick';
  sendingClubId: string;
  receivingClubId: string;
  canonicalPlayerId: string | null;
  selection: Readonly<{
    seasonYear: number;
    round: number | null;
    number: number | null;
    originalClubId: string | null;
  }> | null;
}

export interface AflTradeWorkbookTransactionReviewPartyV2 {
  stagingRowId: string;
  canonicalClubId: string;
  assets: readonly AflTradeWorkbookTransactionReviewAssetV2[];
}

interface ReviewDecisionV2Input extends ReviewDecisionBaseInput {
  outcome: 'approved';
  workbookTradeId: string;
  occurredOn: string;
  occurrencePrecision: 'date' | 'year';
  parties: readonly AflTradeWorkbookTransactionReviewPartyV2[];
}

export interface AflTradeWorkbookTransactionReviewDecisionV2 {
  decisionId: string;
  content: Readonly<{
    schemaVersion: typeof AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_V2_SCHEMA_VERSION;
    reviewSetId: string;
    reviewSubjectId: string;
    reviewSubjectSha256: string;
    workbookTradeId: string;
    occurredOn: string;
    occurrencePrecision: 'date' | 'year';
    revision: number;
    supersedesDecisionId: string | null;
    outcome: 'approved';
    parties: readonly AflTradeWorkbookTransactionReviewPartyV2[];
    reviewerId: string;
    rationale: string;
    decidedAt: string;
    authority: 'private_workbook_canonical_transaction_review';
    publicationEligible: false;
    publicationProhibited: true;
  }>;
}

export type AnyAflTradeWorkbookTransactionReviewDecision =
  | AflTradeWorkbookTransactionReviewDecision
  | AflTradeWorkbookTransactionReviewDecisionV2;

export function isAflTradeWorkbookTransactionReviewDecisionV2(
  decision: AnyAflTradeWorkbookTransactionReviewDecision
): decision is AflTradeWorkbookTransactionReviewDecisionV2 {
  return (
    decision.content.schemaVersion ===
    AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_V2_SCHEMA_VERSION
  );
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

const workbookTransactionReviewAssetV2Schema = z
  .object({
    assetId: z.string().trim().min(1).max(512),
    sourceAssetText: z.string().trim().min(1).max(4_000),
    assetKind: z.enum(['player', 'pick', 'future_pick']),
    sendingClubId: z.string().trim().min(1).max(240),
    receivingClubId: z.string().trim().min(1).max(240),
    canonicalPlayerId: z.string().trim().min(1).max(512).nullable(),
    selection: z
      .object({
        seasonYear: z.number().int().min(1897).max(2200),
        round: z.number().int().positive().nullable(),
        number: z.number().int().positive().nullable(),
        originalClubId: z.string().trim().min(1).max(240).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

const workbookTransactionReviewDecisionV2Schema = z
  .object({
    decisionId: z.string().trim().min(1).max(512),
    content: z
      .object({
        schemaVersion: z.literal(AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_V2_SCHEMA_VERSION),
        reviewSetId: z.string().trim().min(1).max(512),
        reviewSubjectId: z.string().trim().min(1).max(512),
        reviewSubjectSha256: z.string().regex(/^[a-f0-9]{64}$/),
        workbookTradeId: z.string().trim().min(1).max(512),
        occurredOn: z.string().regex(DATE),
        occurrencePrecision: z.enum(['date', 'year']),
        revision: z.number().int().positive(),
        supersedesDecisionId: z.string().trim().min(1).max(512).nullable(),
        outcome: z.literal('approved'),
        parties: z
          .array(
            z
              .object({
                stagingRowId: z.string().trim().min(1).max(512),
                canonicalClubId: z.string().trim().min(1).max(240),
                assets: z.array(workbookTransactionReviewAssetV2Schema).min(1),
              })
              .strict()
          )
          .min(2),
        reviewerId: z.string().trim().min(1).max(240),
        rationale: z.string().trim().min(1).max(2_000),
        decidedAt: z.string().regex(INSTANT),
        authority: z.literal('private_workbook_canonical_transaction_review'),
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

function sourceAssetSegments(assetText: string): readonly string[] {
  return assetText
    .split(/\s+\+\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function assertV2AssetSemantics(
  asset: AflTradeWorkbookTransactionReviewAssetV2,
  partyClubIds: ReadonlySet<string>
): void {
  if (
    !partyClubIds.has(asset.sendingClubId) ||
    !partyClubIds.has(asset.receivingClubId) ||
    asset.sendingClubId === asset.receivingClubId
  ) {
    throw new TypeError('Every reviewed asset must have explicit direction between two parties.');
  }
  if (
    (asset.assetKind === 'player' &&
      (asset.canonicalPlayerId === null || asset.selection !== null)) ||
    (asset.assetKind !== 'player' &&
      (asset.canonicalPlayerId !== null || asset.selection === null))
  ) {
    throw new TypeError(
      'Reviewed player and selection assets must retain their exact kind-specific identity.'
    );
  }
}

export function authenticateAflTradeWorkbookTransactionReviewDecisionV2(
  decision: AflTradeWorkbookTransactionReviewDecisionV2
): void {
  const parsed = workbookTransactionReviewDecisionV2Schema.parse(
    decision
  ) as AflTradeWorkbookTransactionReviewDecisionV2;
  const partyClubIds = new Set(parsed.content.parties.map(({ canonicalClubId }) => canonicalClubId));
  const partyRowIds = parsed.content.parties.map(({ stagingRowId }) => stagingRowId);
  const allAssets = parsed.content.parties.flatMap(({ assets }) => assets);
  if (
    parsed.content.schemaVersion !==
      AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_V2_SCHEMA_VERSION ||
    parsed.content.authority !== 'private_workbook_canonical_transaction_review' ||
    parsed.content.publicationEligible !== false ||
    parsed.content.publicationProhibited !== true ||
    !INSTANT.test(parsed.content.decidedAt) ||
    !DATE.test(parsed.content.occurredOn) ||
    Number.isNaN(Date.parse(`${parsed.content.occurredOn}T00:00:00.000Z`)) ||
    (parsed.content.occurrencePrecision === 'year' &&
      parsed.content.occurredOn !== `${parsed.content.occurredOn.slice(0, 4)}-01-01`) ||
    (parsed.content.revision === 1) !== (parsed.content.supersedesDecisionId === null) ||
    partyClubIds.size !== parsed.content.parties.length ||
    new Set(partyRowIds).size !== partyRowIds.length ||
    new Set(allAssets.map(({ assetId }) => assetId)).size !== allAssets.length ||
    allAssets.some((asset) => {
      try {
        assertV2AssetSemantics(asset, partyClubIds);
        return false;
      } catch {
        return true;
      }
    }) ||
    parsed.decisionId !==
      createAflTradeContentAddress('workbook-transaction-review-decision', parsed.content)
  ) {
    throw new TypeError('Workbook transaction review decision v2 failed exact authentication.');
  }
}

export function parseAflTradeWorkbookTransactionReviewDecisionV2(
  input: unknown
): AflTradeWorkbookTransactionReviewDecisionV2 {
  try {
    const parsed = workbookTransactionReviewDecisionV2Schema.parse(
      input
    ) as AflTradeWorkbookTransactionReviewDecisionV2;
    authenticateAflTradeWorkbookTransactionReviewDecisionV2(parsed);
    return parsed;
  } catch {
    throw new TypeError('Workbook transaction review decision v2 failed exact authentication.');
  }
}

export function authenticateAnyAflTradeWorkbookTransactionReviewDecision(
  decision: AnyAflTradeWorkbookTransactionReviewDecision
): void {
  if (isAflTradeWorkbookTransactionReviewDecisionV2(decision)) {
    authenticateAflTradeWorkbookTransactionReviewDecisionV2(decision);
    return;
  }
  authenticateAflTradeWorkbookTransactionReviewDecision(decision);
}

export function parseAnyAflTradeWorkbookTransactionReviewDecision(
  input: unknown
): AnyAflTradeWorkbookTransactionReviewDecision {
  const schemaVersion =
    typeof input === 'object' && input !== null &&
    'content' in input && typeof input.content === 'object' && input.content !== null &&
    'schemaVersion' in input.content
      ? input.content.schemaVersion
      : null;
  return schemaVersion === AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_V2_SCHEMA_VERSION
    ? parseAflTradeWorkbookTransactionReviewDecisionV2(input)
    : parseAflTradeWorkbookTransactionReviewDecision(input);
}

export function createAflTradeWorkbookTransactionReviewDecisionV2(
  input: ReviewDecisionV2Input
): AflTradeWorkbookTransactionReviewDecisionV2 {
  authenticateAflTradeWorkbookTransactionReviewSet(input.reviewSet);
  const subject = input.reviewSet.content.transactions.find(
    ({ reviewSubjectId }) => reviewSubjectId === input.reviewSubjectId
  );
  if (!subject) {
    throw new TypeError('Review decision must reference one exact transaction review subject.');
  }
  const reviewerId = requireBoundedText(input.reviewerId, 'Reviewer identity', 240);
  const rationale = requireBoundedText(input.rationale, 'Review rationale', 2_000);
  const workbookTradeId = requireBoundedText(input.workbookTradeId, 'Workbook trade ID', 512);
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
  if (!DATE.test(input.occurredOn) || Number.isNaN(Date.parse(`${input.occurredOn}T00:00:00.000Z`))) {
    throw new TypeError('Reviewed transaction date must be an exact calendar date.');
  }
  if (Number(input.occurredOn.slice(0, 4)) !== subject.seasonYear) {
    throw new TypeError('Reviewed transaction occurrence must remain inside the exact workbook year.');
  }
  if (
    input.occurrencePrecision === 'year' &&
    input.occurredOn !== `${subject.seasonYear}-01-01`
  ) {
    throw new TypeError(
      'Year precision must use January 1 as a normalized lower bound, not an asserted exact date.'
    );
  }

  const subjectPartyByRowId = new Map(
    subject.parties.map((party) => [party.stagingRowId, party] as const)
  );
  const partyClubIds = new Set(input.parties.map(({ canonicalClubId }) => canonicalClubId));
  if (
    input.parties.length !== subject.parties.length ||
    partyClubIds.size !== input.parties.length ||
    new Set(input.parties.map(({ stagingRowId }) => stagingRowId)).size !== input.parties.length
  ) {
    throw new TypeError('A v2 approval must resolve every exact party exactly once.');
  }

  const assetIds = new Set<string>();
  const parties = input.parties.map((party) => {
    const subjectParty = subjectPartyByRowId.get(party.stagingRowId);
    if (!subjectParty || party.canonicalClubId.trim() !== party.canonicalClubId) {
      throw new TypeError('A v2 approval must resolve every exact party exactly once.');
    }
    const expectedSegments = sourceAssetSegments(subjectParty.assetText);
    if (
      party.assets.length !== expectedSegments.length ||
      party.assets.some(
        (asset, index) =>
          asset.sourceAssetText !== expectedSegments[index] ||
          asset.receivingClubId !== party.canonicalClubId
      )
    ) {
      throw new TypeError('A v2 approval must exhaustively interpret every exact source asset.');
    }
    const assets = party.assets.map((asset) => {
      if (assetIds.has(asset.assetId)) {
        throw new TypeError('Every reviewed source asset must have one unique stable asset ID.');
      }
      assetIds.add(asset.assetId);
      assertV2AssetSemantics(asset, partyClubIds);
      return workbookTransactionReviewAssetV2Schema.parse(asset);
    });
    return {
      stagingRowId: party.stagingRowId,
      canonicalClubId: requireBoundedText(party.canonicalClubId, 'Canonical club ID', 240),
      assets,
    };
  });

  const content = {
    schemaVersion: AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_DECISION_V2_SCHEMA_VERSION,
    reviewSetId: input.reviewSet.reviewSetId,
    reviewSubjectId: subject.reviewSubjectId,
    reviewSubjectSha256: sha256AflTradeCanonicalJson(subject),
    workbookTradeId,
    occurredOn: input.occurredOn,
    occurrencePrecision: input.occurrencePrecision,
    revision: input.revision,
    supersedesDecisionId: input.supersedesDecisionId,
    outcome: 'approved' as const,
    parties,
    reviewerId,
    rationale,
    decidedAt: input.decidedAt,
    authority: 'private_workbook_canonical_transaction_review' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
  };
  const decision = {
    decisionId: createAflTradeContentAddress('workbook-transaction-review-decision', content),
    content,
  };
  authenticateAflTradeWorkbookTransactionReviewDecisionV2(decision);
  return decision;
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
  currentDecisions: readonly AnyAflTradeWorkbookTransactionReviewDecision[];
}): AflTradeWorkbookTransactionReviewAssessment {
  authenticateAflTradeWorkbookTransactionReviewSet(input.reviewSet);
  input.currentDecisions.forEach(authenticateAnyAflTradeWorkbookTransactionReviewDecision);
  const subjectById = new Map(
    input.reviewSet.content.transactions.map((subject) => [subject.reviewSubjectId, subject])
  );
  const decisionBySubject = new Map<string, AnyAflTradeWorkbookTransactionReviewDecision>();
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
        ('canonicalClubIds' in decision.content
          ? decision.content.canonicalClubIds.length
          : decision.content.parties.length) !== subject.parties.length)
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
