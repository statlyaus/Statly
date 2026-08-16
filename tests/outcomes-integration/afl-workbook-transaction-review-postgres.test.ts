import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createPgAflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/pgOutcomeSqlClient';
import { PostgresAflTradeWorkbookTransactionReviewRepository } from '@/server/aflTradeIntelligence/source/postgresWorkbookTransactionReviewRepository';
import type {
  AflTradeWorkbookStagingPackage,
  AflTradeWorkbookStagingRow,
} from '@/server/aflTradeIntelligence/source/workbookImportContracts';
import { createAflTradeWorkbookTransactionReviewSet } from '@/server/aflTradeIntelligence/source/workbookTransactionReviewSet';
import { runOutcomesPrismaTestCommand } from './outcomesPrismaTestCli';

const databaseUrl =
  process.env.AFL_OUTCOMES_TEST_DATABASE_URL ??
  (() => {
    throw new Error('AFL_OUTCOMES_TEST_DATABASE_URL must identify disposable PostgreSQL.');
  })();
const schemaName = `afl_workbook_review_${process.pid}_${Date.now()}`;
const adminPool = new Pool({ connectionString: databaseUrl });
const pool = new Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schemaName}`,
});
const SHA = 'a'.repeat(64);
const importRunId = 'workbook-import-run:fixture';

function stagedRow(input: {
  ordinal: number;
  rowNumber: number;
  kind: 'trade_transaction' | 'trade_party';
  cells: readonly string[];
}): AflTradeWorkbookStagingRow {
  const cells = input.cells.map((value) => ({ kind: 'text' as const, value }));
  const sourceGroupId = `workbook-source-group:${'c'.repeat(64)}`;
  const authenticatedPayload = {
    sourceLocator: `Trades!R${input.rowNumber}`,
    sourceOrdinal: input.ordinal,
    sheet: 'Trades',
    rowNumber: input.rowNumber,
    recordKind: input.kind,
    sourceGroupId,
    seasonYear: 2025,
    acquisitionMechanism: 'trade' as const,
    parseStatus: 'staged' as const,
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
    issueIds: [],
  };
  const rowSha256 = sha256AflTradeCanonicalJson(authenticatedPayload);
  return {
    stagingRowId: createAflTradeContentAddress('workbook-row', {
      sourceArtifactId: `artifact:${SHA}`,
      sourceLocator: authenticatedPayload.sourceLocator,
      rowSha256,
    }),
    ...authenticatedPayload,
    rowSha256,
    authenticatedPayload,
  };
}

const rows = [
  stagedRow({ ordinal: 1, rowNumber: 10, kind: 'trade_transaction', cells: ['Trade 1', ''] }),
  stagedRow({ ordinal: 2, rowNumber: 11, kind: 'trade_party', cells: ['St Kilda', 'Player'] }),
  stagedRow({ ordinal: 3, rowNumber: 12, kind: 'trade_party', cells: ['Gold Coast', 'Pick 8'] }),
] as const;
const counts = {
  sheets: 1,
  physicalRows: 3,
  physicalCells: 6,
  hyperlinks: 0,
  annualSheets: 0,
  annualAcquisitions: 0,
  tradeTransactions: 1,
  tradeParties: 2,
  supplementaryRows: 0,
  quarantinedRows: 0,
  blockingIssues: 0,
  reviewIssues: 0,
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
const sourceArtifact = {
  artifactId: `artifact:${SHA}`,
  contentSha256: SHA,
  storageUri: `artifact://sha256/${SHA}`,
  mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  byteLength: 100,
  createdAt: '2026-08-16T00:00:00.000Z',
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
  issueIds: [],
  counts,
};
const staging: AflTradeWorkbookStagingPackage = {
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
    physicalRowCount: 3,
    physicalCellCount: 6,
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
  issues: [],
  counts,
  publicationEligible: false,
};
const reviewSet = createAflTradeWorkbookTransactionReviewSet(staging);

function relabelledReviewSet() {
  const original = reviewSet.content.transactions[0]!;
  const parties = [
    { ...original.parties[0]!, clubLabel: 'Fabricated Club' },
    original.parties[1]!,
  ];
  const partySetSha256 = sha256AflTradeCanonicalJson(parties);
  const subjectWithoutId = { ...original, parties, partySetSha256 };
  const subject = {
    ...subjectWithoutId,
    reviewSubjectId: createAflTradeContentAddress('workbook-transaction-review-subject', {
      stagingPackageId: reviewSet.content.stagingPackageId,
      sourceGroupId: original.sourceGroupId,
      transactionRowId: original.transactionRowId,
      transactionRowSha256: original.transactionRowSha256,
      partySetSha256,
    }),
  };
  const transactions = [subject];
  const content = {
    ...reviewSet.content,
    transactions,
    transactionSetSha256: sha256AflTradeCanonicalJson(transactions),
  };
  return {
    reviewSetId: createAflTradeContentAddress('workbook-transaction-review-set', content),
    content,
  };
}

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set('schema', schemaName);
  runOutcomesPrismaTestCommand(['migrate', 'deploy'], { databaseUrl: scoped.toString() });
  await pool.query(
    `INSERT INTO outcome_artifact_custody
      (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,
       environment,created_at,verified_at,custody_json)
     VALUES ($1,$2,$3,$4,$5,'raw_source','test_fixture',$6,$6,'{}'::jsonb)`,
    [
      sourceArtifact.artifactId,
      sourceArtifact.contentSha256,
      sourceArtifact.storageUri,
      sourceArtifact.mediaType,
      sourceArtifact.byteLength,
      sourceArtifact.createdAt,
    ]
  );
  await pool.query(
    `INSERT INTO outcome_source_capture_attempt
      (attempt_id,environment,provider,dataset,status,started_at,completed_at,attempt_json)
     VALUES ('attempt-workbook-review','test_fixture','statly-curated-workbook',
             'afl-drafts-trades','captured',$1,$1,'{}'::jsonb)`,
    [sourceArtifact.createdAt]
  );
  await pool.query(
    `INSERT INTO outcome_competition_season (competition,season_year)
     VALUES ('AFL',2025) ON CONFLICT DO NOTHING`
  );
  await pool.query(
    `INSERT INTO outcome_source_capture
      (capture_id,attempt_id,source_snapshot_id,source_artifact_id,environment,provider,dataset,
       dataset_version,access_mechanism,competition,anchor_season_year,effective_at,captured_at,
       status,manifest_json)
     VALUES ('capture-workbook-review','attempt-workbook-review','snapshot-workbook-review',$1,
             'test_fixture','statly-curated-workbook','afl-drafts-trades','fixture-v1',
             'reviewed_workbook_upload','AFL',2025,$2,$2,'approved','{}'::jsonb)`,
    [sourceArtifact.artifactId, sourceArtifact.createdAt]
  );
  await pool.query(
    `INSERT INTO outcome_import_run
      (import_run_id,capture_id,import_kind,parser_version,started_at,completed_at,status,manifest_json)
     VALUES ($1,'capture-workbook-review','workbook_full_archive',$2,$3,$3,'needs_review',$4::jsonb)`,
    [
      importRunId,
      staging.parserVersion,
      sourceArtifact.createdAt,
      {
        stagingPackageId: staging.stagingPackageId,
        sourceArtifact: {
          artifactId: sourceArtifact.artifactId,
          contentSha256: sourceArtifact.contentSha256,
          byteLength: sourceArtifact.byteLength,
          mediaType: sourceArtifact.mediaType,
        },
        rawEvidenceSha256: staging.rawEvidence.evidenceSha256,
        counts: staging.counts,
        rowCount: rows.length,
        publicationEligible: false,
      },
    ]
  );
  for (const row of rows) {
    await pool.query(
      `INSERT INTO outcome_import_row
        (import_row_id,import_run_id,source_locator,source_ordinal,record_kind,row_sha256,
         parse_status,raw_payload,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        createAflTradeContentAddress('import-row', { importRunId, stagingRowId: row.stagingRowId }),
        importRunId,
        row.sourceLocator,
        row.sourceOrdinal,
        row.recordKind,
        row.rowSha256,
        row.parseStatus,
        {
          stagingPackageId: staging.stagingPackageId,
          rawEvidenceSha256: staging.rawEvidence.evidenceSha256,
          stagingRowId: row.stagingRowId,
          rowSha256: row.rowSha256,
          authenticatedPayload: row.authenticatedPayload,
        },
        sourceArtifact.createdAt,
      ]
    );
  }
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  await adminPool.end();
});

describe('PostgreSQL workbook transaction review repository', () => {
  it('registers only the exact retained import and reports every subject pending', async () => {
    const repository = new PostgresAflTradeWorkbookTransactionReviewRepository(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(repository.registerReviewSet({ importRunId, reviewSet })).resolves.toEqual(
      reviewSet
    );
    await expect(repository.loadReviewSet(reviewSet.reviewSetId)).resolves.toEqual(reviewSet);
    await expect(repository.assess(reviewSet.reviewSetId)).resolves.toMatchObject({
      total: 1,
      approved: 0,
      rejected: 0,
      pending: 1,
      readyForShadowOracle: false,
    });
  });

  it('uses database time and exact compare-and-swap chronology for current decisions', async () => {
    const repository = new PostgresAflTradeWorkbookTransactionReviewRepository(
      createPgAflOutcomeSqlClient(pool)
    );
    const subject = reviewSet.content.transactions[0]!;
    const rejected = await repository.recordDecision({
      reviewSetId: reviewSet.reviewSetId,
      reviewSubjectId: subject.reviewSubjectId,
      expectedCurrentDecisionId: null,
      outcome: 'rejected',
      reviewerId: 'local-reviewer:robert',
      rationale: 'Direction remains ambiguous.',
    });
    expect(rejected.content).toMatchObject({ revision: 1, supersedesDecisionId: null });
    expect(Date.parse(rejected.content.decidedAt)).toBeGreaterThan(0);

    const approved = await repository.recordDecision({
      reviewSetId: reviewSet.reviewSetId,
      reviewSubjectId: subject.reviewSubjectId,
      expectedCurrentDecisionId: rejected.decisionId,
      outcome: 'approved',
      canonicalClubIds: ['afl-club:st-kilda', 'afl-club:gold-coast'],
      transferDirection: 'listed_club_received_assets',
      reviewerId: 'local-reviewer:robert',
      rationale: 'Identity and direction are resolved.',
    });
    expect(approved.content).toMatchObject({
      revision: 2,
      supersedesDecisionId: rejected.decisionId,
    });
    await expect(repository.loadCurrentDecisions(reviewSet.reviewSetId)).resolves.toEqual([
      approved,
    ]);
    await expect(repository.assess(reviewSet.reviewSetId)).resolves.toMatchObject({
      approved: 1,
      rejected: 0,
      pending: 0,
      readyForShadowOracle: true,
    });
    await expect(
      repository.recordDecision({
        reviewSetId: reviewSet.reviewSetId,
        reviewSubjectId: subject.reviewSubjectId,
        expectedCurrentDecisionId: rejected.decisionId,
        outcome: 'rejected',
        reviewerId: 'local-reviewer:robert',
        rationale: 'Stale operator write.',
      })
    ).rejects.toThrow(/stale/i);
    const history = await pool.query<{ decision_id: string }>(
      `SELECT decision_id FROM outcome_workbook_transaction_review_decision
        WHERE review_set_id=$1 ORDER BY revision`,
      [reviewSet.reviewSetId]
    );
    expect(history.rows).toEqual([
      { decision_id: rejected.decisionId },
      { decision_id: approved.decisionId },
    ]);
  });

  it('rejects a resealed subject whose labels differ from the retained row payload', async () => {
    const repository = new PostgresAflTradeWorkbookTransactionReviewRepository(
      createPgAflOutcomeSqlClient(pool)
    );

    await expect(
      repository.registerReviewSet({ importRunId, reviewSet: relabelledReviewSet() })
    ).rejects.toThrow(/retained import row/i);
  });

  it('rejects mutation of retained review evidence', async () => {
    await expect(
      pool.query(
        `UPDATE outcome_workbook_transaction_review_set SET transaction_count=2
          WHERE review_set_id=$1`,
        [reviewSet.reviewSetId]
      )
    ).rejects.toThrow(/append-only/i);
  });
});
