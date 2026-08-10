import { beforeEach, describe, expect, it, vi } from 'vitest';

const readExcelFileMock = vi.hoisted(() => vi.fn());
const extractOoxmlMock = vi.hoisted(() => vi.fn());

vi.mock('read-excel-file/node', () => ({ default: readExcelFileMock }));
vi.mock('@/server/aflTradeIntelligence/source/workbookOoxmlEvidence', () => ({
  extractAflTradeWorkbookOoxmlEvidence: extractOoxmlMock,
}));

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER } from '@/server/aflTradeIntelligence/source/draftTradeWorkbookEvaluation';
import { AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MEDIA_TYPE } from '@/server/aflTradeIntelligence/source/developmentWorkbookLoader';
import {
  AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM,
  AFL_TRADE_WORKBOOK_CAPTURE_DATASET,
  AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER,
  AflTradeWorkbookPersistenceError,
  PostgresAflTradeWorkbookStagingRepository,
} from '@/server/aflTradeIntelligence/source/postgresWorkbookStagingRepository';
import {
  AflTradeWorkbookStagingError,
  parseAflTradeWorkbookForStaging,
} from '@/server/aflTradeIntelligence/source/workbookStagingParser';

const numberCell = (lexicalValue: string) => ({ kind: 'parsed_number', lexicalValue });

function workbookSheets() {
  return [
    {
      sheet: 'AFL VFL Trades',
      data: [
        ['Full\u00a0All-Time\u00a0List\u00a0of\u00a0VFL/AFL\u00a0Trades', null],
        [numberCell('2025'), null],
        ['2025 Trade for Example Player', null],
        ['Carlton', 'Example Player'],
        ['Fremantle', 'Pick 10'],
      ],
    },
    {
      sheet: 'Draft Overview by year',
      data: [
        ['Year', 'Picks'],
        [numberCell('2025'), numberCell('1')],
      ],
    },
    {
      sheet: '2025',
      data: [
        [...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER],
        [
          '2025_0001',
          numberCell('2025'),
          'Academy',
          'Mid-Season',
          numberCell('1'),
          'Carlton',
          null,
          'Example Player',
          numberCell('20'),
          numberCell('190'),
          null,
          'Example Club',
          'A',
          '12 (3)',
          numberCell('5'),
          null,
          numberCell('0'),
          'B&F: 2025',
        ],
      ],
    },
    {
      sheet: 'Awards Glossary',
      data: [
        ['award_id', 'display_name'],
        ['bnf', 'Best and fairest'],
      ],
    },
    { sheet: 'Unexpected', data: [['unreviewed']] },
  ];
}

function createSource() {
  const bytes = new TextEncoder().encode('synthetic-xlsx-bytes');
  return {
    bytes,
    artifact: createAflTradeByteArtifactRef(
      bytes,
      AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MEDIA_TYPE,
      '2026-08-07T00:00:00.000Z'
    ),
  };
}

beforeEach(() => {
  readExcelFileMock.mockReset();
  readExcelFileMock.mockResolvedValue(workbookSheets());
  const sheetRows = [5, 2, 2, 2, 1];
  const sheetNames = [
    'AFL VFL Trades',
    'Draft Overview by year',
    '2025',
    'Awards Glossary',
    'Unexpected',
  ];
  extractOoxmlMock.mockReturnValue({
    evidenceVersion: 'afl-trade-workbook-ooxml-evidence/v1',
    evidenceSha256: 'a'.repeat(64),
    archiveEntryCount: 12,
    inflatedByteLength: 1024,
    physicalRowCount: 12,
    physicalCellCount: 36,
    hyperlinkCount: 1,
    date1904: false,
    referencedParts: [
      { partName: 'xl/workbook.xml', byteLength: 10, contentSha256: 'b'.repeat(64) },
    ],
    supportingTables: {
      workbookProperties: {},
      styles: null,
      sharedStrings: null,
    },
    sheets: sheetNames.map((sheet, ordinal) => ({
      sheet,
      ordinal,
      visibility: 'visible',
      worksheetPath: `xl/worksheets/sheet${ordinal + 1}.xml`,
      physicalRowCount: sheetRows[ordinal],
      physicalCellCount: sheetRows[ordinal] * 3,
      rows: Array.from({ length: sheetRows[ordinal] }, (_, row) => ({
        rowNumber: row + 1,
        hidden: false,
        physicalCellCount: 0,
        cells: [],
      })),
      hyperlinks:
        ordinal === 0
          ? [
              {
                reference: 'A3',
                relationshipId: 'rId1',
                target: 'https://www.draftguru.com.au/trades/example',
                targetMode: 'External',
                location: null,
                display: null,
                tooltip: null,
              },
            ]
          : [],
    })),
  });
});

describe('AFL trade workbook staging parser', () => {
  it('preserves typed cells, classifies every sheet, and quarantines unknown content', async () => {
    const source = createSource();
    const staging = await parseAflTradeWorkbookForStaging({
      bytes: source.bytes,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
    });

    expect(staging.publicationEligible).toBe(false);
    expect(staging.counts).toMatchObject({
      sheets: 5,
      physicalRows: 12,
      physicalCells: 36,
      hyperlinks: 1,
      annualSheets: 1,
      annualAcquisitions: 1,
      tradeTransactions: 1,
      tradeParties: 2,
      supplementaryRows: 4,
      quarantinedRows: 1,
      blockingIssues: 1,
    });
    expect(staging.counts.acquisitionMechanisms.midseason_draft).toBe(1);
    expect(staging.partitions.map(({ partitionKey }) => partitionKey)).toEqual([
      'workbook_annual_acquisitions:2025',
      'workbook_trade_ledger:2025',
    ]);
    const annualRow = staging.partitions[0]!.rows.find(
      ({ recordKind }) => recordKind === 'annual_acquisition'
    )!;
    expect(annualRow.cells[1]).toEqual({ kind: 'number', lexicalValue: '2025' });
    expect(annualRow.cells[10]).toEqual({ kind: 'blank' });
    expect(annualRow.parseStatus).toBe('needs_review');
    expect(staging.quarantinedRows[0]).toMatchObject({
      sheet: 'Unexpected',
      recordKind: 'quarantined_row',
      parseStatus: 'rejected',
    });
    expect(staging.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'unknown_sheet',
        'composite_games',
        'labelled_pick',
        'missing_weight',
        'workbook_grade_is_non_authoritative',
        'award_requires_resolution',
      ])
    );
  });

  it('is deterministic and rejects bytes that do not match the artifact', async () => {
    const source = createSource();
    const input = {
      bytes: source.bytes,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
    };
    const first = await parseAflTradeWorkbookForStaging(input);
    const second = await parseAflTradeWorkbookForStaging(input);
    expect(second).toEqual(first);

    await expect(
      parseAflTradeWorkbookForStaging({
        ...input,
        bytes: new TextEncoder().encode('different'),
      })
    ).rejects.toBeInstanceOf(AflTradeWorkbookStagingError);
  });

  it('rejects every occurrence of a duplicated workbook document identifier', async () => {
    const sheets = workbookSheets();
    const annualSheet = sheets[2]!;
    annualSheet.data.push([...(annualSheet.data[1] ?? [])]);
    readExcelFileMock.mockResolvedValue(sheets);
    const rawEvidence = structuredClone(extractOoxmlMock());
    const rawAnnualSheet = rawEvidence.sheets[2]!;
    rawAnnualSheet.rows.push({
      rowNumber: 3,
      hidden: false,
      physicalCellCount: 18,
      cells: [],
    });
    rawAnnualSheet.physicalRowCount += 1;
    rawAnnualSheet.physicalCellCount += 18;
    rawEvidence.physicalRowCount += 1;
    rawEvidence.physicalCellCount += 18;
    extractOoxmlMock.mockReturnValue(rawEvidence);

    const source = createSource();
    const staging = await parseAflTradeWorkbookForStaging({
      bytes: source.bytes,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
    });
    const duplicates = staging.rows.filter(
      ({ recordKind, issueIds }) =>
        recordKind === 'annual_acquisition' &&
        issueIds.some((issueId) =>
          staging.issues.some(
            (rowIssue) => rowIssue.issueId === issueId && rowIssue.code === 'duplicate_document_id'
          )
        )
    );

    expect(duplicates).toHaveLength(2);
    expect(duplicates.every(({ parseStatus }) => parseStatus === 'rejected')).toBe(true);
  });

  it('closes an incomplete transaction as one rejected group without duplicating its issue', async () => {
    const sheets = workbookSheets();
    sheets[0]!.data.pop();
    readExcelFileMock.mockResolvedValue(sheets);
    const rawEvidence = structuredClone(extractOoxmlMock());
    rawEvidence.sheets[0]!.rows.pop();
    rawEvidence.sheets[0]!.physicalRowCount -= 1;
    rawEvidence.sheets[0]!.physicalCellCount -= 3;
    rawEvidence.physicalRowCount -= 1;
    rawEvidence.physicalCellCount -= 3;
    extractOoxmlMock.mockReturnValue(rawEvidence);

    const source = createSource();
    const staging = await parseAflTradeWorkbookForStaging({
      bytes: source.bytes,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
    });
    const groupedRows = staging.rows.filter(
      ({ recordKind, sourceGroupId }) =>
        sourceGroupId !== null && ['trade_transaction', 'trade_party'].includes(recordKind)
    );
    const groupIssues = staging.issues.filter(
      ({ code }) => code === 'trade_has_fewer_than_two_parties'
    );

    expect(groupedRows).toHaveLength(2);
    expect(groupedRows.every(({ parseStatus }) => parseStatus === 'rejected')).toBe(true);
    expect(groupIssues).toHaveLength(1);
    expect(groupedRows.every(({ issueIds }) => issueIds.includes(groupIssues[0]!.issueId))).toBe(
      true
    );
  });

  it('propagates a ledger-level structural failure through every dependent trade row', async () => {
    const sheets = workbookSheets();
    sheets[0]!.data[0] = ['Wrong trade ledger title', null];
    readExcelFileMock.mockResolvedValue(sheets);

    const source = createSource();
    const staging = await parseAflTradeWorkbookForStaging({
      bytes: source.bytes,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
    });
    const tradeRows = staging.rows.filter(({ recordKind }) => recordKind.startsWith('trade_'));

    expect(tradeRows).not.toHaveLength(0);
    expect(tradeRows.every(({ parseStatus }) => parseStatus === 'rejected')).toBe(true);
    expect(staging.issues.filter(({ code }) => code === 'invalid_trade_title')).toHaveLength(1);
  });

  it('records a sheet-level quarantine issue for an empty unknown sheet', async () => {
    const sheets = [...workbookSheets(), { sheet: 'Empty Unknown', data: [] }];
    readExcelFileMock.mockResolvedValue(sheets);
    const rawEvidence = structuredClone(extractOoxmlMock());
    rawEvidence.sheets.push({
      sheet: 'Empty Unknown',
      ordinal: 5,
      visibility: 'visible',
      worksheetPath: 'xl/worksheets/sheet6.xml',
      physicalRowCount: 0,
      physicalCellCount: 0,
      rows: [],
      hyperlinks: [],
    });
    extractOoxmlMock.mockReturnValue(rawEvidence);

    const source = createSource();
    const staging = await parseAflTradeWorkbookForStaging({
      bytes: source.bytes,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
    });

    expect(staging.sheetInventory.at(-1)).toMatchObject({
      sheet: 'Empty Unknown',
      rowCount: 0,
      partitionEligible: false,
    });
    expect(staging.issues).toContainEqual(
      expect.objectContaining({
        code: 'unknown_sheet',
        locator: { sheet: 'Empty Unknown', row: 1 },
      })
    );
  });
});

function createSqlClient(input: { captureId: string; artifactId: string; contentSha256: string }) {
  let run:
    | {
        importRunId: string;
        status: 'needs_review' | 'rejected';
        startedAt: string;
        completedAt: string;
        manifest: unknown;
      }
    | undefined;
  let rowCount = 0;
  let partitionCount = 0;
  let issueCount = 0;
  const insertedPayloads: unknown[] = [];
  const transaction: AflOutcomeSqlTransaction = {
    async query<Row>(sql: string, parameters: readonly unknown[] = []) {
      if (sql.includes('pg_advisory_xact_lock')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM outcome_source_capture capture')) {
        return {
          rows: [
            {
              capture_id: input.captureId,
              environment: 'test_fixture',
              provider: AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER,
              dataset: AFL_TRADE_WORKBOOK_CAPTURE_DATASET,
              access_mechanism: AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM,
              status: 'approved',
              artifact_id: input.artifactId,
              content_sha256: input.contentSha256,
            },
          ] as Row[],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM outcome_source_capture_season')) {
        return {
          rows: [{ competition: 'AFL', season_year: 2025 }] as Row[],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM outcome_import_run')) {
        return {
          rows: run
            ? ([
                {
                  import_run_id: run.importRunId,
                  status: run.status,
                  started_at: run.startedAt,
                  completed_at: run.completedAt,
                  manifest_json: run.manifest,
                },
              ] as Row[])
            : [],
          rowCount: run ? 1 : 0,
        };
      }
      if (sql.startsWith('INSERT INTO outcome_import_run')) {
        run = {
          importRunId: parameters[0] as string,
          startedAt: parameters[4] as string,
          completedAt: parameters[5] as string,
          status: parameters[6] as 'needs_review' | 'rejected',
          manifest: parameters[7],
        };
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO outcome_import_row')) {
        rowCount += parameters.length / 9;
        for (let index = 7; index < parameters.length; index += 9) {
          insertedPayloads.push(parameters[index]);
        }
        return { rows: [], rowCount: parameters.length / 9 };
      }
      if (sql.startsWith('INSERT INTO outcome_import_partition_row')) {
        return { rows: [], rowCount: parameters.length / 4 };
      }
      if (sql.startsWith('INSERT INTO outcome_import_partition')) {
        partitionCount += 1;
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO outcome_data_exception')) {
        issueCount += parameters.length / 9;
        return { rows: [], rowCount: parameters.length / 9 };
      }
      if (sql.includes('AS row_count')) {
        return {
          rows: [
            { row_count: rowCount, partition_count: partitionCount, issue_count: issueCount },
          ] as Row[],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL in workbook staging test: ${sql}`);
    },
  };
  const client: AflOutcomeSqlClient = {
    query: transaction.query,
    async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>) {
      return work(transaction);
    },
  };
  return { client, insertedPayloads, getRunManifest: () => run?.manifest };
}

describe('PostgreSQL workbook staging repository', () => {
  it('persists the exact approved workbook once and returns an idempotent replay', async () => {
    const source = createSource();
    const staging = await parseAflTradeWorkbookForStaging({
      bytes: source.bytes,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
    });
    const sql = createSqlClient({
      captureId: 'capture-2025',
      artifactId: source.artifact.artifactId,
      contentSha256: source.artifact.contentSha256,
    });
    const artifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'raw_source',
    });
    await artifactRepository.putIfAbsent(source.artifact, source.bytes);
    const repository = new PostgresAflTradeWorkbookStagingRepository(
      sql.client,
      artifactRepository
    );
    const request = {
      captureId: 'capture-2025',
      environment: 'test_fixture' as const,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
      startedAt: '2026-08-07T01:00:00.000Z',
      completedAt: '2026-08-07T01:00:01.000Z',
    };

    const first = await repository.persistPackage(request);
    const replay = await repository.persistPackage(request);
    expect(first).toMatchObject({
      captureId: 'capture-2025',
      rowCount: 12,
      partitionCount: 2,
      issueCount: staging.issues.length,
      status: 'rejected',
      idempotentReplay: false,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect(sql.insertedPayloads).toHaveLength(12);
    expect(sql.insertedPayloads).toContainEqual(
      expect.objectContaining({
        stagingPackageId: staging.stagingPackageId,
        authenticatedPayload: expect.objectContaining({
          sheet: '2025',
          seasonYear: 2025,
          acquisitionMechanism: 'midseason_draft',
        }),
      })
    );
    for (const payload of sql.insertedPayloads as Array<{
      rowSha256: string;
      authenticatedPayload: unknown;
    }>) {
      expect(sha256AflTradeCanonicalJson(payload.authenticatedPayload)).toBe(payload.rowSha256);
    }
    expect(sql.getRunManifest()).toMatchObject({
      sheetInventory: expect.arrayContaining([
        expect.objectContaining({ sheet: 'Unexpected', partitionEligible: false }),
      ]),
      rawWorkbookEvidence: expect.objectContaining({
        hyperlinks: [expect.objectContaining({ sheet: 'AFL VFL Trades', reference: 'A3' })],
      }),
    });
  });

  it('fails closed when immutable import chronology conflicts', async () => {
    const source = createSource();
    const sql = createSqlClient({
      captureId: 'capture-2025',
      artifactId: source.artifact.artifactId,
      contentSha256: source.artifact.contentSha256,
    });
    const artifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'raw_source',
    });
    await artifactRepository.putIfAbsent(source.artifact, source.bytes);
    const repository = new PostgresAflTradeWorkbookStagingRepository(
      sql.client,
      artifactRepository
    );
    const request = {
      captureId: 'capture-2025',
      environment: 'test_fixture' as const,
      sourceArtifact: source.artifact,
      originalFilename: 'fixture.xlsx',
      startedAt: '2026-08-07T01:00:00.000Z',
      completedAt: '2026-08-07T01:00:01.000Z',
    };
    await repository.persistPackage(request);
    await expect(
      repository.persistPackage({
        ...request,
        completedAt: '2026-08-07T01:00:02.000Z',
      })
    ).rejects.toBeInstanceOf(AflTradeWorkbookPersistenceError);
  });
});
