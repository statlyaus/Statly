import { aflTradeArtifactRefSchema } from '../artifacts/artifactReference';
import { z } from 'zod';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type {
  AflTradeWorkbookCell,
  AflTradeWorkbookStagingPackage,
  AflTradeWorkbookStagingRow,
} from './workbookImportContracts';

export const AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_SET_SCHEMA_VERSION =
  'afl-trade-workbook-transaction-review-set/v1' as const;

export interface AflTradeWorkbookTransactionReviewParty {
  stagingRowId: string;
  rowSha256: string;
  sourceLocator: string;
  sourceOrdinal: number;
  clubLabel: string;
  assetText: string;
}

export interface AflTradeWorkbookTransactionReviewSubject {
  reviewSubjectId: string;
  sourceGroupId: string;
  transactionRowId: string;
  transactionRowSha256: string;
  sourceLocator: string;
  sourceOrdinal: number;
  seasonYear: number;
  sourceTitle: string;
  parties: readonly AflTradeWorkbookTransactionReviewParty[];
  partySetSha256: string;
  reviewState: 'pending';
}

export interface AflTradeWorkbookTransactionReviewSet {
  reviewSetId: string;
  content: Readonly<{
    schemaVersion: typeof AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_SET_SCHEMA_VERSION;
    stagingPackageId: string;
    sourceArtifactId: string;
    sourceArtifactSha256: string;
    rawEvidenceSha256: string;
    authority: 'private_workbook_migration_oracle_review';
    publicationEligible: false;
    publicationProhibited: true;
    transactions: readonly AflTradeWorkbookTransactionReviewSubject[];
    transactionCount: number;
    transactionSetSha256: string;
    pendingReviewCount: number;
  }>;
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonEmptyBoundedTextSchema = z.string().trim().min(1).max(10_000);

const workbookTransactionReviewPartySchema = z
  .object({
    stagingRowId: nonEmptyBoundedTextSchema,
    rowSha256: sha256Schema,
    sourceLocator: nonEmptyBoundedTextSchema,
    sourceOrdinal: z.number().int().nonnegative(),
    clubLabel: nonEmptyBoundedTextSchema,
    assetText: nonEmptyBoundedTextSchema,
  })
  .strict();

const workbookTransactionReviewSubjectSchema = z
  .object({
    reviewSubjectId: nonEmptyBoundedTextSchema,
    sourceGroupId: nonEmptyBoundedTextSchema,
    transactionRowId: nonEmptyBoundedTextSchema,
    transactionRowSha256: sha256Schema,
    sourceLocator: nonEmptyBoundedTextSchema,
    sourceOrdinal: z.number().int().nonnegative(),
    seasonYear: z.number().int().min(1897).max(2200),
    sourceTitle: nonEmptyBoundedTextSchema,
    parties: z.array(workbookTransactionReviewPartySchema).min(2),
    partySetSha256: sha256Schema,
    reviewState: z.literal('pending'),
  })
  .strict();

const workbookTransactionReviewSetSchema = z
  .object({
    reviewSetId: nonEmptyBoundedTextSchema,
    content: z
      .object({
        schemaVersion: z.literal(AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_SET_SCHEMA_VERSION),
        stagingPackageId: nonEmptyBoundedTextSchema,
        sourceArtifactId: nonEmptyBoundedTextSchema,
        sourceArtifactSha256: sha256Schema,
        rawEvidenceSha256: sha256Schema,
        authority: z.literal('private_workbook_migration_oracle_review'),
        publicationEligible: z.literal(false),
        publicationProhibited: z.literal(true),
        transactions: z.array(workbookTransactionReviewSubjectSchema).min(1),
        transactionCount: z.number().int().positive(),
        transactionSetSha256: sha256Schema,
        pendingReviewCount: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

function subjectAddressContent(
  stagingPackageId: string,
  subject: AflTradeWorkbookTransactionReviewSubject
) {
  return {
    stagingPackageId,
    sourceGroupId: subject.sourceGroupId,
    transactionRowId: subject.transactionRowId,
    transactionRowSha256: subject.transactionRowSha256,
    partySetSha256: subject.partySetSha256,
  };
}

export function authenticateAflTradeWorkbookTransactionReviewSet(
  reviewSet: AflTradeWorkbookTransactionReviewSet
): void {
  const { content } = reviewSet;
  if (
    content.transactionCount !== content.transactions.length ||
    content.pendingReviewCount !== content.transactions.length ||
    content.transactionSetSha256 !== sha256AflTradeCanonicalJson(content.transactions) ||
    reviewSet.reviewSetId !==
      createAflTradeContentAddress('workbook-transaction-review-set', content)
  ) {
    throw new TypeError('Workbook transaction review set failed exact authentication.');
  }

  const subjectIds = new Set<string>();
  let previousTransactionOrdinal = -1;
  for (const subject of content.transactions) {
    let previousPartyOrdinal = subject.sourceOrdinal;
    if (
      subject.sourceOrdinal <= previousTransactionOrdinal ||
      subject.partySetSha256 !== sha256AflTradeCanonicalJson(subject.parties) ||
      subject.reviewSubjectId !==
        createAflTradeContentAddress(
          'workbook-transaction-review-subject',
          subjectAddressContent(content.stagingPackageId, subject)
        ) ||
      subjectIds.has(subject.reviewSubjectId) ||
      subject.parties.some((party) => {
        const ordered = party.sourceOrdinal > previousPartyOrdinal;
        previousPartyOrdinal = party.sourceOrdinal;
        return !ordered;
      })
    ) {
      throw new TypeError('Workbook transaction review subject failed exact authentication.');
    }
    previousTransactionOrdinal = subject.sourceOrdinal;
    subjectIds.add(subject.reviewSubjectId);
  }
}

export function parseAflTradeWorkbookTransactionReviewSet(
  input: unknown
): AflTradeWorkbookTransactionReviewSet {
  try {
    const parsed = workbookTransactionReviewSetSchema.parse(
      input
    ) as AflTradeWorkbookTransactionReviewSet;
    authenticateAflTradeWorkbookTransactionReviewSet(parsed);
    return parsed;
  } catch {
    throw new TypeError('Workbook transaction review set failed exact authentication.');
  }
}

function observableText(cell: AflTradeWorkbookCell | undefined): string {
  if (!cell || cell.kind === 'blank') return '';
  if (cell.kind === 'text') return cell.value.trim();
  if (cell.kind === 'number') return cell.lexicalValue.trim();
  if (cell.kind === 'date') return cell.isoValue;
  return String(cell.value);
}

function authenticateRow(sourceArtifactId: string, row: AflTradeWorkbookStagingRow): void {
  const rowSha256 = sha256AflTradeCanonicalJson(row.authenticatedPayload);
  const stagingRowId = createAflTradeContentAddress('workbook-row', {
    sourceArtifactId,
    sourceLocator: row.sourceLocator,
    rowSha256,
  });
  if (
    row.rowSha256 !== rowSha256 ||
    row.stagingRowId !== stagingRowId ||
    row.sourceLocator !== row.authenticatedPayload.sourceLocator ||
    row.sourceOrdinal !== row.authenticatedPayload.sourceOrdinal ||
    row.sheet !== row.authenticatedPayload.sheet ||
    row.rowNumber !== row.authenticatedPayload.rowNumber ||
    row.recordKind !== row.authenticatedPayload.recordKind ||
    row.sourceGroupId !== row.authenticatedPayload.sourceGroupId ||
    row.seasonYear !== row.authenticatedPayload.seasonYear ||
    row.parseStatus !== row.authenticatedPayload.parseStatus ||
    sha256AflTradeCanonicalJson(row.cells) !==
      sha256AflTradeCanonicalJson(row.authenticatedPayload.cells) ||
    sha256AflTradeCanonicalJson(row.rawOoxml) !==
      sha256AflTradeCanonicalJson(row.authenticatedPayload.rawOoxml) ||
    sha256AflTradeCanonicalJson(row.issueIds) !==
      sha256AflTradeCanonicalJson(row.authenticatedPayload.issueIds)
  ) {
    throw new TypeError(`Workbook staging row ${row.sourceLocator} failed exact authentication.`);
  }
}

function expectedPackageId(staging: AflTradeWorkbookStagingPackage): string {
  const packageContent = {
    contractVersion: staging.contractVersion,
    parserVersion: staging.parserVersion,
    sourceArtifactId: staging.sourceArtifact.artifactId,
    rawEvidenceSha256: staging.rawEvidence.evidenceSha256,
    originalFilename: staging.originalFilename,
    sheetInventory: staging.sheetInventory,
    partitions: staging.partitions.map(
      ({ partitionKey, importKind, seasonYear, rowCount, rowsSha256 }) => ({
        partitionKey,
        importKind,
        seasonYear,
        rowCount,
        rowsSha256,
      })
    ),
    allRowIds: staging.rows.map(({ stagingRowId }) => stagingRowId),
    issueIds: staging.issues.map(({ issueId }) => issueId).sort(),
    counts: staging.counts,
  };
  return createAflTradeContentAddress('workbook-import', packageContent);
}

/**
 * Builds the immutable review queue for the workbook trade ledger only. This is a migration-oracle
 * boundary: it authenticates exact source rows but deliberately grants no factual-release or
 * publication authority. Canonical identity, direction, and asset interpretation remain pending.
 */
export function createAflTradeWorkbookTransactionReviewSet(
  staging: AflTradeWorkbookStagingPackage
): AflTradeWorkbookTransactionReviewSet {
  const sourceArtifact = aflTradeArtifactRefSchema.parse(staging.sourceArtifact);
  if (
    staging.publicationEligible !== false ||
    staging.stagingPackageId !== expectedPackageId(staging)
  ) {
    throw new TypeError('Workbook staging package failed exact private-package authentication.');
  }

  const tradeRows = staging.rows.filter(
    ({ recordKind }) => recordKind === 'trade_transaction' || recordKind === 'trade_party'
  );
  if (
    tradeRows.filter(({ recordKind }) => recordKind === 'trade_transaction').length !==
      staging.counts.tradeTransactions ||
    tradeRows.filter(({ recordKind }) => recordKind === 'trade_party').length !==
      staging.counts.tradeParties
  ) {
    throw new TypeError('Workbook trade counts do not match the exact staged trade-ledger rows.');
  }
  if (tradeRows.some(({ parseStatus }) => parseStatus !== 'staged')) {
    throw new TypeError('Every trade-ledger row must be structurally staged before review.');
  }
  const rowIds = tradeRows.map(({ stagingRowId }) => stagingRowId);
  if (new Set(rowIds).size !== rowIds.length) {
    throw new TypeError('Workbook trade-ledger staging row identities must be unique.');
  }
  tradeRows.forEach((row) => authenticateRow(sourceArtifact.artifactId, row));

  const transactionsByGroup = new Map<string, AflTradeWorkbookStagingRow>();
  for (const row of tradeRows) {
    if (row.recordKind !== 'trade_transaction' || row.sourceGroupId === null) continue;
    if (transactionsByGroup.has(row.sourceGroupId)) {
      throw new TypeError('Each workbook source group must contain exactly one transaction row.');
    }
    transactionsByGroup.set(row.sourceGroupId, row);
  }
  if (transactionsByGroup.size !== staging.counts.tradeTransactions) {
    throw new TypeError('Every staged workbook transaction must have an exact source group.');
  }

  const partyRowsByGroup = new Map<string, AflTradeWorkbookStagingRow[]>();
  for (const row of tradeRows) {
    if (row.recordKind !== 'trade_party') continue;
    if (row.sourceGroupId === null || !transactionsByGroup.has(row.sourceGroupId)) {
      throw new TypeError('Every workbook party row must belong to one exact transaction group.');
    }
    const parties = partyRowsByGroup.get(row.sourceGroupId) ?? [];
    parties.push(row);
    partyRowsByGroup.set(row.sourceGroupId, parties);
  }

  const transactions = [...transactionsByGroup.entries()]
    .sort(([, left], [, right]) => left.sourceOrdinal - right.sourceOrdinal)
    .map(([sourceGroupId, transactionRow]) => {
      const partyRows = [...(partyRowsByGroup.get(sourceGroupId) ?? [])].sort(
        (left, right) => left.sourceOrdinal - right.sourceOrdinal
      );
      if (partyRows.length < 2) {
        throw new TypeError(
          'Each workbook transaction review subject requires at least two exact party rows.'
        );
      }
      if (
        transactionRow.seasonYear === null ||
        partyRows.some(
          (party) =>
            party.seasonYear !== transactionRow.seasonYear ||
            party.sheet !== transactionRow.sheet ||
            party.sourceOrdinal <= transactionRow.sourceOrdinal
        )
      ) {
        throw new TypeError(
          'Workbook transaction and party chronology must remain exact within one season.'
        );
      }
      const parties = partyRows.map((party) => ({
        stagingRowId: party.stagingRowId,
        rowSha256: party.rowSha256,
        sourceLocator: party.sourceLocator,
        sourceOrdinal: party.sourceOrdinal,
        clubLabel: observableText(party.cells[0]),
        assetText: observableText(party.cells[1]),
      }));
      if (parties.some(({ clubLabel, assetText }) => !clubLabel || !assetText)) {
        throw new TypeError(
          'Workbook transaction party labels and asset text must remain observable.'
        );
      }
      const partySetSha256 = sha256AflTradeCanonicalJson(parties);
      const subjectContent = {
        stagingPackageId: staging.stagingPackageId,
        sourceGroupId,
        transactionRowId: transactionRow.stagingRowId,
        transactionRowSha256: transactionRow.rowSha256,
        partySetSha256,
      };
      return {
        reviewSubjectId: createAflTradeContentAddress(
          'workbook-transaction-review-subject',
          subjectContent
        ),
        sourceGroupId,
        transactionRowId: transactionRow.stagingRowId,
        transactionRowSha256: transactionRow.rowSha256,
        sourceLocator: transactionRow.sourceLocator,
        sourceOrdinal: transactionRow.sourceOrdinal,
        seasonYear: transactionRow.seasonYear,
        sourceTitle: observableText(transactionRow.cells[0]),
        parties,
        partySetSha256,
        reviewState: 'pending' as const,
      };
    });
  const transactionSetSha256 = sha256AflTradeCanonicalJson(transactions);
  const content = {
    schemaVersion: AFL_TRADE_WORKBOOK_TRANSACTION_REVIEW_SET_SCHEMA_VERSION,
    stagingPackageId: staging.stagingPackageId,
    sourceArtifactId: sourceArtifact.artifactId,
    sourceArtifactSha256: sourceArtifact.contentSha256,
    rawEvidenceSha256: staging.rawEvidence.evidenceSha256,
    authority: 'private_workbook_migration_oracle_review' as const,
    publicationEligible: false as const,
    publicationProhibited: true as const,
    transactions,
    transactionCount: transactions.length,
    transactionSetSha256,
    pendingReviewCount: transactions.length,
  };
  return {
    reviewSetId: createAflTradeContentAddress('workbook-transaction-review-set', content),
    content,
  };
}
