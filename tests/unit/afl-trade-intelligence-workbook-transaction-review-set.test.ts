import { describe, expect, it } from 'vitest';

import {
  createAflTradeWorkbookTransactionReviewSet,
  parseAflTradeWorkbookTransactionReviewSet,
} from '@/server/aflTradeIntelligence/source/workbookTransactionReviewSet';
import {
  assessAflTradeWorkbookTransactionReviewSet,
  createAflTradeWorkbookTransactionOracleFacts,
  createAflTradeWorkbookTransactionReviewDecision,
  parseAflTradeWorkbookTransactionReviewDecision,
} from '@/server/aflTradeIntelligence/source/workbookTransactionReviewDecision';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflTradeWorkbookStagingPackage,
  AflTradeWorkbookStagingRow,
} from '@/server/aflTradeIntelligence/source/workbookImportContracts';

const SHA = 'a'.repeat(64);

function row(input: {
  ordinal: number;
  rowNumber: number;
  kind: 'trade_transaction' | 'trade_party' | 'annual_acquisition';
  groupId: string | null;
  cells: readonly string[];
  parseStatus?: AflTradeWorkbookStagingRow['parseStatus'];
  issueIds?: readonly string[];
}): AflTradeWorkbookStagingRow {
  const cells = input.cells.map((value) => ({ kind: 'text' as const, value }));
  const authenticatedPayload = {
    sourceLocator: `Trades!R${input.rowNumber}`,
    sourceOrdinal: input.ordinal,
    sheet: input.kind === 'annual_acquisition' ? '2025' : 'Trades',
    rowNumber: input.rowNumber,
    recordKind: input.kind,
    sourceGroupId: input.groupId,
    seasonYear: 2025,
    acquisitionMechanism: 'trade' as const,
    parseStatus: input.parseStatus ?? 'staged',
    interpretedCellSemantics: 'cooked_observable_values' as const,
    cells,
    rawOoxml: {
      evidenceSha256: SHA,
      sheet: {
        ordinal: 0,
        visibility: 'visible' as const,
        worksheetPath: 'xl/worksheets/sheet1.xml',
      },
      row: null,
      hyperlinks: [],
    },
    issueIds: input.issueIds ?? [],
  };
  const rowSha256 = sha256AflTradeCanonicalJson(authenticatedPayload);
  const stagingRowId = createAflTradeContentAddress('workbook-row', {
    sourceArtifactId: `artifact:${SHA}`,
    sourceLocator: authenticatedPayload.sourceLocator,
    rowSha256,
  });
  return {
    stagingRowId,
    ...authenticatedPayload,
    rowSha256,
    authenticatedPayload,
    cells,
    rawOoxml: {
      evidenceSha256: SHA,
      sheet: { ordinal: 0, visibility: 'visible', worksheetPath: 'xl/worksheets/sheet1.xml' },
      row: null,
      hyperlinks: [],
    },
    issueIds: input.issueIds ?? [],
  };
}

function stagingPackage(
  rows: readonly AflTradeWorkbookStagingRow[]
): AflTradeWorkbookStagingPackage {
  const sourceArtifact = {
    artifactId: `artifact:${SHA}`,
    contentSha256: SHA,
    storageUri: `artifact://sha256/${SHA}`,
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteLength: 100,
    createdAt: '2026-08-16T00:00:00.000Z',
  } as const;
  const counts = {
    sheets: 2,
    physicalRows: rows.length,
    physicalCells: rows.length * 2,
    hyperlinks: 0,
    annualSheets: 1,
    annualAcquisitions: rows.filter(({ recordKind }) => recordKind === 'annual_acquisition').length,
    tradeTransactions: rows.filter(({ recordKind }) => recordKind === 'trade_transaction').length,
    tradeParties: rows.filter(({ recordKind }) => recordKind === 'trade_party').length,
    supplementaryRows: 0,
    quarantinedRows: 0,
    blockingIssues: 0,
    reviewIssues: 1,
    acquisitionMechanisms: {
      national_draft: 0,
      rookie_draft: 0,
      midseason_draft: 0,
      preseason_draft: 0,
      mini_draft: 0,
      trade: 1,
      free_agency: 0,
      pre_draft: 0,
      post_draft: 0,
      training_squad: 0,
    },
  } as const;
  const packageContent = {
    contractVersion: 'afl-trade-workbook-import/v1',
    parserVersion: 'afl-trade-workbook-parser/1.0.0',
    sourceArtifactId: sourceArtifact.artifactId,
    rawEvidenceSha256: SHA,
    originalFilename: 'workbook.xlsx',
    sheetInventory: [],
    partitions: [],
    allRowIds: rows.map(({ stagingRowId }) => stagingRowId),
    issueIds: ['annual-review-issue'],
    counts,
  };
  return {
    contractVersion: 'afl-trade-workbook-import/v1',
    parserVersion: 'afl-trade-workbook-parser/1.0.0',
    stagingPackageId: createAflTradeContentAddress('workbook-import', packageContent),
    sourceArtifact,
    originalFilename: 'workbook.xlsx',
    rawAuthority: 'immutable_xlsx_artifact',
    interpretedCellSemantics: 'cooked_observable_values',
    rawEvidence: {
      evidenceVersion: 'afl-trade-workbook-ooxml-evidence/v1',
      evidenceSha256: SHA,
      archiveEntryCount: 1,
      inflatedByteLength: 100,
      physicalRowCount: rows.length,
      physicalCellCount: rows.length * 2,
      hyperlinkCount: 0,
      date1904: false,
      referencedParts: [],
      supportingTables: { workbookProperties: {}, styles: null, sharedStrings: null },
      sheets: [],
    },
    sheetInventory: [],
    rows,
    partitions: [],
    supplementaryRows: [],
    quarantinedRows: [],
    issues: [
      {
        issueId: 'annual-review-issue',
        code: 'workbook_grade_is_non_authoritative',
        severity: 'review',
        locator: { sheet: '2025', row: 2 },
        field: 'grade',
        rawValue: 'A',
        message: 'Annual workbook grade remains non-authoritative.',
      },
    ],
    counts,
    publicationEligible: false,
  };
}

function validRows() {
  return [
    row({
      ordinal: 1,
      rowNumber: 10,
      kind: 'trade_transaction',
      groupId: `workbook-source-group:${'c'.repeat(64)}`,
      cells: ['2025 Trade 1', ''],
    }),
    row({
      ordinal: 2,
      rowNumber: 11,
      kind: 'trade_party',
      groupId: `workbook-source-group:${'c'.repeat(64)}`,
      cells: ['St Kilda', 'Sam Flanders'],
    }),
    row({
      ordinal: 3,
      rowNumber: 12,
      kind: 'trade_party',
      groupId: `workbook-source-group:${'c'.repeat(64)}`,
      cells: ['Gold Coast', 'Pick 8'],
    }),
    row({
      ordinal: 4,
      rowNumber: 2,
      kind: 'annual_acquisition',
      groupId: null,
      cells: ['Sam Flanders', 'St Kilda'],
      parseStatus: 'needs_review',
      issueIds: ['annual-review-issue'],
    }),
  ] as const;
}

describe('workbook transaction review set', () => {
  it('seals every structurally valid trade group exactly once without admitting annual facts', () => {
    const first = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const replay = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));

    expect(replay).toEqual(first);
    expect(first.reviewSetId).toMatch(/^workbook-transaction-review-set:[a-f0-9]{64}$/);
    expect(first.content).toMatchObject({
      stagingPackageId: expect.stringMatching(/^workbook-import:[a-f0-9]{64}$/),
      sourceArtifactId: `artifact:${SHA}`,
      authority: 'private_workbook_migration_oracle_review',
      publicationEligible: false,
      publicationProhibited: true,
      transactionCount: 1,
      pendingReviewCount: 1,
    });
    expect(first.content.transactions).toEqual([
      expect.objectContaining({
        sourceGroupId: `workbook-source-group:${'c'.repeat(64)}`,
        transactionRowId: expect.stringMatching(/^workbook-row:[a-f0-9]{64}$/),
        seasonYear: 2025,
        sourceTitle: '2025 Trade 1',
        reviewState: 'pending',
        parties: [
          expect.objectContaining({
            stagingRowId: expect.stringMatching(/^workbook-row:[a-f0-9]{64}$/),
            clubLabel: 'St Kilda',
            assetText: 'Sam Flanders',
          }),
          expect.objectContaining({
            stagingRowId: expect.stringMatching(/^workbook-row:[a-f0-9]{64}$/),
            clubLabel: 'Gold Coast',
            assetText: 'Pick 8',
          }),
        ],
      }),
    ]);
    expect(first.content.transactions.flatMap(({ parties }) => parties)).toHaveLength(2);
  });

  it('fails closed when a transaction group is incomplete', () => {
    expect(() =>
      createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows().slice(0, 2)))
    ).toThrow('at least two exact party rows');
  });

  it('fails closed when any trade-ledger row is not structurally staged', () => {
    const rows = [...validRows()];
    rows[1] = { ...rows[1], parseStatus: 'rejected' };

    expect(() => createAflTradeWorkbookTransactionReviewSet(stagingPackage(rows))).toThrow(
      'structurally staged'
    );
  });

  it('binds an approved identity and direction review to one exact transaction subject', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const subject = reviewSet.content.transactions[0]!;
    const decision = createAflTradeWorkbookTransactionReviewDecision({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'approved',
      canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      transferDirection: 'listed_club_received_assets',
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Compared the exact transaction and party rows in the pinned local workbook.',
      decidedAt: '2026-08-16T00:00:00.000Z',
    });

    expect(decision.decisionId).toMatch(/^workbook-transaction-review-decision:[a-f0-9]{64}$/);
    expect(decision.content).toMatchObject({
      reviewSetId: reviewSet.reviewSetId,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'approved',
      canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      transferDirection: 'listed_club_received_assets',
      publicationEligible: false,
      publicationProhibited: true,
    });
  });

  it('rejects an approval that does not resolve every party to a distinct canonical club', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const subject = reviewSet.content.transactions[0]!;

    expect(() =>
      createAflTradeWorkbookTransactionReviewDecision({
        reviewSet,
        reviewSubjectId: subject.reviewSubjectId,
        outcome: 'approved',
        canonicalClubIds: ['afl-club:st-kilda'],
        transferDirection: 'listed_club_received_assets',
        revision: 1,
        supersedesDecisionId: null,
        reviewerId: 'local-reviewer:robert',
        rationale: 'Incomplete mapping.',
        decidedAt: '2026-08-16T00:00:00.000Z',
      })
    ).toThrow('every party');
  });

  it('creates shadow-oracle facts only from a complete exact approved decision set', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const subject = reviewSet.content.transactions[0]!;
    const decision = createAflTradeWorkbookTransactionReviewDecision({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'approved',
      canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      transferDirection: 'listed_club_received_assets',
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Exact local identity and direction review.',
      decidedAt: '2026-08-16T00:00:00.000Z',
    });

    expect(
      createAflTradeWorkbookTransactionOracleFacts({ reviewSet, currentDecisions: [decision] })
    ).toEqual([
      {
        oracleRowId: subject.reviewSubjectId,
        kind: 'transaction',
        seasonYear: 2025,
        title: '2025 Trade 1',
        parties: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      },
    ]);
    expect(() =>
      createAflTradeWorkbookTransactionOracleFacts({ reviewSet, currentDecisions: [] })
    ).toThrow('complete approved');
  });

  it('reports pending and rejected subjects without converting either state into facts', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const subject = reviewSet.content.transactions[0]!;
    expect(assessAflTradeWorkbookTransactionReviewSet({ reviewSet, currentDecisions: [] })).toEqual(
      {
        reviewSetId: reviewSet.reviewSetId,
        total: 1,
        approved: 0,
        rejected: 0,
        pending: 1,
        readyForShadowOracle: false,
      }
    );

    const rejected = createAflTradeWorkbookTransactionReviewDecision({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'rejected',
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'The source direction remains ambiguous.',
      decidedAt: '2026-08-16T00:00:00.000Z',
    });
    expect(
      assessAflTradeWorkbookTransactionReviewSet({
        reviewSet,
        currentDecisions: [rejected],
      })
    ).toMatchObject({ approved: 0, rejected: 1, pending: 0, readyForShadowOracle: false });
  });

  it('rejects a content-addressed decision that is not bound to the exact subject bytes', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const subject = reviewSet.content.transactions[0]!;
    const approved = createAflTradeWorkbookTransactionReviewDecision({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'approved',
      canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      transferDirection: 'listed_club_received_assets',
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Exact local review.',
      decidedAt: '2026-08-16T00:00:00.000Z',
    });
    const content = { ...approved.content, reviewSubjectSha256: '0'.repeat(64) };
    const forged = {
      decisionId: createAflTradeContentAddress('workbook-transaction-review-decision', content),
      content,
    };

    expect(() =>
      assessAflTradeWorkbookTransactionReviewSet({ reviewSet, currentDecisions: [forged] })
    ).toThrow('exact review subject');
  });

  it('runtime-parses and re-authenticates retained review-set JSON', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));

    expect(parseAflTradeWorkbookTransactionReviewSet(reviewSet)).toEqual(reviewSet);
    expect(() =>
      parseAflTradeWorkbookTransactionReviewSet({
        ...reviewSet,
        content: { ...reviewSet.content, sourceArtifactSha256: '0'.repeat(64) },
      })
    ).toThrow(/exact authentication/i);
  });

  it('runtime-parses and re-authenticates retained decision JSON', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const subject = reviewSet.content.transactions[0]!;
    const decision = createAflTradeWorkbookTransactionReviewDecision({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'rejected',
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'The source direction remains ambiguous.',
      decidedAt: '2026-08-16T00:00:00.000Z',
    });

    expect(parseAflTradeWorkbookTransactionReviewDecision(decision)).toEqual(decision);
    expect(() =>
      parseAflTradeWorkbookTransactionReviewDecision({
        ...decision,
        content: { ...decision.content, reviewerId: '' },
      })
    ).toThrow(/exact authentication/i);
  });

  it('binds every decision to an explicit append-only revision chain', () => {
    const reviewSet = createAflTradeWorkbookTransactionReviewSet(stagingPackage(validRows()));
    const subject = reviewSet.content.transactions[0]!;
    const initial = createAflTradeWorkbookTransactionReviewDecision({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'rejected',
      revision: 1,
      supersedesDecisionId: null,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Identity remains ambiguous.',
      decidedAt: '2026-08-16T00:00:00.000Z',
    });
    const replacement = createAflTradeWorkbookTransactionReviewDecision({
      reviewSet,
      reviewSubjectId: subject.reviewSubjectId,
      outcome: 'approved',
      canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      transferDirection: 'listed_club_received_assets',
      revision: 2,
      supersedesDecisionId: initial.decisionId,
      reviewerId: 'local-reviewer:robert',
      rationale: 'Canonical identities and direction are now resolved.',
      decidedAt: '2026-08-16T00:01:00.000Z',
    });

    expect(replacement.content).toMatchObject({
      revision: 2,
      supersedesDecisionId: initial.decisionId,
    });
    expect(() =>
      createAflTradeWorkbookTransactionReviewDecision({
        reviewSet,
        reviewSubjectId: subject.reviewSubjectId,
        outcome: 'rejected',
        revision: 2,
        supersedesDecisionId: null,
        reviewerId: 'local-reviewer:robert',
        rationale: 'Invalid revision chain.',
        decidedAt: '2026-08-16T00:02:00.000Z',
      })
    ).toThrow(/revision chain/i);
  });
});
