import readExcelFile from 'read-excel-file/node';

import {
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER } from './draftTradeWorkbookEvaluation';
import { AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MEDIA_TYPE } from './developmentWorkbookLoader';
import {
  AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS,
  AFL_TRADE_WORKBOOK_IMPORT_CONTRACT_VERSION,
  AFL_TRADE_WORKBOOK_PARSER_VERSION,
  type AflTradeWorkbookAcquisitionMechanism,
  type AflTradeWorkbookAuthenticatedRowPayload,
  type AflTradeWorkbookCell,
  type AflTradeWorkbookImportPartition,
  type AflTradeWorkbookIssue,
  type AflTradeWorkbookIssueCode,
  type AflTradeWorkbookRecordKind,
  type AflTradeWorkbookRawEvidence,
  type AflTradeWorkbookSheetClassification,
  type AflTradeWorkbookStagingPackage,
  type AflTradeWorkbookStagingRow,
} from './workbookImportContracts';
import { extractAflTradeWorkbookOoxmlEvidence } from './workbookOoxmlEvidence';

const TRADE_SHEET_NAME = 'AFL VFL Trades';
const TRADE_SHEET_TITLE = 'Full All-Time List of VFL/AFL Trades';
const OVERVIEW_SHEET_NAME = 'Draft Overview by year';
const AWARDS_GLOSSARY_SHEET_NAME = 'Awards Glossary';
const MAX_WORKBOOK_BYTES = 128 * 1024 * 1024;

interface ParsedNumberToken {
  readonly kind: 'parsed_number';
  readonly lexicalValue: string;
}

type ParsedCell = string | ParsedNumberToken | boolean | Date | typeof Date | null;

interface MutableRow {
  sheet: string;
  rowNumber: number;
  recordKind: AflTradeWorkbookRecordKind;
  sourceGroupId: string | null;
  seasonYear: number | null;
  acquisitionMechanism: AflTradeWorkbookAcquisitionMechanism | null;
  cells: readonly AflTradeWorkbookCell[];
  issues: AflTradeWorkbookIssue[];
}

export class AflTradeWorkbookStagingError extends Error {
  constructor(
    readonly code: 'INVALID_BYTES' | 'ARTIFACT_MISMATCH' | 'INVALID_FILENAME' | 'INVALID_WORKBOOK',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeWorkbookStagingError';
  }
}

function normalizeVisibleText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsedCellToContractCell(value: ParsedCell): AflTradeWorkbookCell {
  if (value === null) return { kind: 'blank' };
  if (typeof value === 'string') return { kind: 'text', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (value instanceof Date) return { kind: 'date', isoValue: value.toISOString() };
  if (typeof value === 'object' && value.kind === 'parsed_number') {
    return { kind: 'number', lexicalValue: value.lexicalValue };
  }
  throw new AflTradeWorkbookStagingError(
    'INVALID_WORKBOOK',
    'The workbook contains a cell type that the staging contract cannot preserve.'
  );
}

function observableCellText(cell: AflTradeWorkbookCell | undefined): string {
  if (!cell || cell.kind === 'blank') return '';
  if (cell.kind === 'text') return cell.value;
  if (cell.kind === 'number') return cell.lexicalValue;
  if (cell.kind === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  return cell.isoValue;
}

function parsedCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString();
  if (isParsedNumberToken(value)) return value.lexicalValue;
  return '';
}

function isParsedNumberToken(value: unknown): value is ParsedNumberToken {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'parsed_number' &&
    'lexicalValue' in value &&
    typeof value.lexicalValue === 'string'
  );
}

function issue(input: {
  code: AflTradeWorkbookIssueCode;
  severity: 'review' | 'blocking';
  sheet: string;
  row: number;
  field?: string;
  rawValue?: string;
  message: string;
}): AflTradeWorkbookIssue {
  const content = {
    code: input.code,
    severity: input.severity,
    locator: { sheet: input.sheet, row: input.row },
    field: input.field ?? null,
    rawValue: input.rawValue ?? null,
    message: input.message,
  } as const;
  return {
    issueId: createAflTradeContentAddress('workbook-issue', content),
    ...content,
  };
}

function rowStatus(issues: readonly AflTradeWorkbookIssue[]) {
  if (issues.some(({ severity }) => severity === 'blocking')) return 'rejected' as const;
  if (issues.length > 0) return 'needs_review' as const;
  return 'staged' as const;
}

function finalizeRow(
  sourceArtifact: AflTradeArtifactRef,
  row: MutableRow,
  sourceOrdinal: number,
  rawEvidence: AflTradeWorkbookRawEvidence
): AflTradeWorkbookStagingRow {
  const sourceLocator = `${row.sheet}!R${row.rowNumber}`;
  const rawSheet = rawEvidence.sheets.find(({ sheet }) => sheet === row.sheet)!;
  const rawOoxml = {
    evidenceSha256: rawEvidence.evidenceSha256,
    sheet: {
      ordinal: rawSheet.ordinal,
      visibility: rawSheet.visibility,
      worksheetPath: rawSheet.worksheetPath,
    },
    row: rawSheet.rows.find(({ rowNumber }) => rowNumber === row.rowNumber) ?? null,
    hyperlinks: rawSheet.hyperlinks.filter(({ reference }) => {
      const match = /^[A-Z]{1,3}([1-9]\d*)/.exec(reference);
      return Number(match?.[1]) === row.rowNumber;
    }),
  } as const;
  const authenticatedPayload: AflTradeWorkbookAuthenticatedRowPayload = {
    sourceLocator,
    sourceOrdinal,
    sheet: row.sheet,
    rowNumber: row.rowNumber,
    recordKind: row.recordKind,
    sourceGroupId: row.sourceGroupId,
    seasonYear: row.seasonYear,
    acquisitionMechanism: row.acquisitionMechanism,
    parseStatus: rowStatus(row.issues),
    interpretedCellSemantics: 'cooked_observable_values',
    cells: row.cells,
    rawOoxml,
    issueIds: row.issues.map(({ issueId }) => issueId).sort(),
  };
  const rowSha256 = sha256AflTradeCanonicalJson(authenticatedPayload);
  return {
    stagingRowId: createAflTradeContentAddress('workbook-row', {
      sourceArtifactId: sourceArtifact.artifactId,
      sourceLocator,
      rowSha256,
    }),
    sourceLocator,
    sourceOrdinal,
    sheet: row.sheet,
    rowNumber: row.rowNumber,
    recordKind: row.recordKind,
    sourceGroupId: row.sourceGroupId,
    seasonYear: row.seasonYear,
    acquisitionMechanism: row.acquisitionMechanism,
    parseStatus: authenticatedPayload.parseStatus,
    rowSha256,
    authenticatedPayload,
    cells: row.cells,
    rawOoxml,
    issueIds: authenticatedPayload.issueIds,
  };
}

function classifySheet(sheet: string): AflTradeWorkbookSheetClassification {
  if (/^\d{4}$/.test(sheet)) return 'annual_acquisitions';
  if (sheet === TRADE_SHEET_NAME) return 'trade_ledger';
  if (sheet === OVERVIEW_SHEET_NAME) return 'supplementary_overview';
  if (sheet === AWARDS_GLOSSARY_SHEET_NAME) return 'supplementary_awards_glossary';
  return 'quarantined_unknown';
}

function annualRows(input: {
  sheet: string;
  cells: readonly (readonly AflTradeWorkbookCell[])[];
  duplicateDocumentIds: ReadonlySet<string>;
}): MutableRow[] {
  const seasonYear = Number(input.sheet);
  const expectedHeader = [...AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER];
  const observedHeader = (input.cells[0] ?? []).map((cell) => observableCellText(cell).trim());
  const headerValid =
    observedHeader.length === expectedHeader.length &&
    expectedHeader.every((expected, index) => observedHeader[index] === expected);
  const headerIssues = headerValid
    ? []
    : [
        issue({
          code: 'invalid_annual_header',
          severity: 'blocking',
          sheet: input.sheet,
          row: 1,
          message: 'Annual sheets require the exact ordered 18-column source header.',
        }),
      ];
  const rows: MutableRow[] = [
    {
      sheet: input.sheet,
      rowNumber: 1,
      recordKind: 'annual_header',
      sourceGroupId: null,
      seasonYear,
      acquisitionMechanism: null,
      cells: input.cells[0] ?? [],
      issues: headerIssues,
    },
  ];

  for (let index = 1; index < input.cells.length; index += 1) {
    const rowNumber = index + 1;
    const cells = input.cells[index] ?? [];
    const rowIssues = headerValid ? [] : [...headerIssues];
    const text = (column: number) => observableCellText(cells[column]).trim();
    const documentId = text(0);
    const year = text(1);
    const acquisitionLabel = text(3);
    const acquisitionMechanism = Object.prototype.hasOwnProperty.call(
      AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS,
      acquisitionLabel
    )
      ? AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS[
          acquisitionLabel as keyof typeof AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS
        ]
      : null;

    if (cells.slice(expectedHeader.length).some((cell) => observableCellText(cell) !== '')) {
      rowIssues.push(
        issue({
          code: 'extra_annual_columns',
          severity: 'blocking',
          sheet: input.sheet,
          row: rowNumber,
          message: 'Annual acquisition rows cannot contain data beyond the governed 18 columns.',
        })
      );
    }
    for (const [column, field] of [
      [5, 'club'],
      [7, 'player'],
    ] as const) {
      if (!text(column)) {
        rowIssues.push(
          issue({
            code: 'missing_required_annual_field',
            severity: 'blocking',
            sheet: input.sheet,
            row: rowNumber,
            field,
            message: `Annual acquisition ${field} is required source evidence.`,
          })
        );
      }
    }

    if (!/^\d{4}_\d{4}$/.test(documentId)) {
      rowIssues.push(
        issue({
          code: 'invalid_document_id',
          severity: 'blocking',
          sheet: input.sheet,
          row: rowNumber,
          field: 'document_id',
          rawValue: documentId,
          message: 'Annual acquisition document_id must use YYYY_NNNN.',
        })
      );
    } else if (input.duplicateDocumentIds.has(documentId)) {
      rowIssues.push(
        issue({
          code: 'duplicate_document_id',
          severity: 'blocking',
          sheet: input.sheet,
          row: rowNumber,
          field: 'document_id',
          rawValue: documentId,
          message: 'Annual acquisition document_id is duplicated in this workbook.',
        })
      );
    }
    if (year !== input.sheet || !documentId.startsWith(`${input.sheet}_`)) {
      rowIssues.push(
        issue({
          code: 'year_mismatch',
          severity: 'blocking',
          sheet: input.sheet,
          row: rowNumber,
          field: 'year',
          rawValue: year,
          message: 'Annual acquisition year and document identity must match the sheet year.',
        })
      );
    }
    if (!acquisitionMechanism) {
      rowIssues.push(
        issue({
          code: 'unsupported_acquisition_mechanism',
          severity: 'blocking',
          sheet: input.sheet,
          row: rowNumber,
          field: 'draft_type',
          rawValue: acquisitionLabel,
          message: 'The acquisition mechanism is not in the governed ten-value mapping.',
        })
      );
    }

    const games = text(13);
    if (/^\d+\s*\(\s*\d+\s*\)$/.test(games)) {
      rowIssues.push(
        issue({
          code: 'composite_games',
          severity: 'review',
          sheet: input.sheet,
          row: rowNumber,
          field: 'games',
          rawValue: games,
          message: 'Composite games are preserved and require scope interpretation.',
        })
      );
    } else if (games && !/^\d+$/.test(games)) {
      rowIssues.push(
        issue({
          code: 'unresolved_games',
          severity: 'review',
          sheet: input.sheet,
          row: rowNumber,
          field: 'games',
          rawValue: games,
          message: 'The recorded games value is not an exact non-negative integer.',
        })
      );
    }
    const pick = text(2);
    if (pick && !/^\d+$/.test(pick)) {
      rowIssues.push(
        issue({
          code: 'labelled_pick',
          severity: 'review',
          sheet: input.sheet,
          row: rowNumber,
          field: 'pick',
          rawValue: pick,
          message: 'The pick is a source label and has not been resolved to a canonical pick.',
        })
      );
    }
    if (!text(10)) {
      rowIssues.push(
        issue({
          code: 'missing_weight',
          severity: 'review',
          sheet: input.sheet,
          row: rowNumber,
          field: 'weight_kg',
          message: 'Missing weight remains null and is not zero-filled.',
        })
      );
    }
    const grade = text(12);
    if (grade) {
      rowIssues.push(
        issue({
          code: 'workbook_grade_is_non_authoritative',
          severity: 'review',
          sheet: input.sheet,
          row: rowNumber,
          field: 'grade',
          rawValue: grade,
          message: 'Workbook grade is retained as source evidence, not a Statly grade.',
        })
      );
    }
    const awards = text(17);
    if (awards) {
      rowIssues.push(
        issue({
          code: 'award_requires_resolution',
          severity: 'review',
          sheet: input.sheet,
          row: rowNumber,
          field: 'awards',
          rawValue: awards,
          message: 'Award tokens require governed identity and season resolution.',
        })
      );
    }
    rows.push({
      sheet: input.sheet,
      rowNumber,
      recordKind: 'annual_acquisition',
      sourceGroupId: createAflTradeContentAddress('workbook-source-group', {
        sheet: input.sheet,
        rowNumber,
        documentId,
      }),
      seasonYear,
      acquisitionMechanism,
      cells,
      issues: rowIssues,
    });
  }
  return rows;
}

function tradeRows(
  sheet: string,
  cells: readonly (readonly AflTradeWorkbookCell[])[]
): MutableRow[] {
  const rows: MutableRow[] = [];
  const firstText = normalizeVisibleText(observableCellText(cells[0]?.[0]));
  const titleIssues =
    firstText === TRADE_SHEET_TITLE
      ? []
      : [
          issue({
            code: 'invalid_trade_title',
            severity: 'blocking',
            sheet,
            row: 1,
            rawValue: firstText,
            message: 'The trade ledger title does not match the governed source structure.',
          }),
        ];
  rows.push({
    sheet,
    rowNumber: 1,
    recordKind: 'trade_ledger_title',
    sourceGroupId: null,
    seasonYear: null,
    acquisitionMechanism: null,
    cells: cells[0] ?? [],
    issues: titleIssues,
  });

  let activeYear: number | null = null;
  let activeYearIssues: AflTradeWorkbookIssue[] = titleIssues.filter(
    ({ severity }) => severity === 'blocking'
  );
  let openTrade: {
    rowIndex: number;
    partyRowIndexes: number[];
    validPartyCount: number;
    groupId: string;
  } | null = null;
  const seenYears = new Set<number>();
  let lastYear: number | null = null;
  const closeTrade = () => {
    if (openTrade && openTrade.validPartyCount < 2) {
      const groupIssue = issue({
        code: 'trade_has_fewer_than_two_parties',
        severity: 'blocking',
        sheet,
        row: rows[openTrade.rowIndex]!.rowNumber,
        message: 'A trade transaction must retain at least two source party rows.',
      });
      for (const rowIndex of [openTrade.rowIndex, ...openTrade.partyRowIndexes]) {
        rows[rowIndex]?.issues.push(groupIssue);
      }
    }
    if (openTrade) {
      const groupIndexes = [openTrade.rowIndex, ...openTrade.partyRowIndexes];
      const blockingIssues = groupIndexes.flatMap((rowIndex) =>
        (rows[rowIndex]?.issues ?? []).filter(({ severity }) => severity === 'blocking')
      );
      for (const rowIndex of groupIndexes) {
        const groupRow = rows[rowIndex];
        if (!groupRow) continue;
        for (const blockingIssue of blockingIssues) {
          if (!groupRow.issues.some(({ issueId }) => issueId === blockingIssue.issueId)) {
            groupRow.issues.push(blockingIssue);
          }
        }
      }
    }
    openTrade = null;
  };

  for (let index = 1; index < cells.length; index += 1) {
    const rowNumber = index + 1;
    const sourceCells = cells[index] ?? [];
    const label = normalizeVisibleText(observableCellText(sourceCells[0]));
    const assets = normalizeVisibleText(observableCellText(sourceCells[1]));
    if (/^\d{4}$/.test(label) && !assets) {
      closeTrade();
      activeYear = Number(label);
      const rowIssues: AflTradeWorkbookIssue[] = [...titleIssues];
      if (seenYears.has(activeYear) || (lastYear !== null && activeYear <= lastYear)) {
        rowIssues.push(
          issue({
            code: 'invalid_trade_year',
            severity: 'blocking',
            sheet,
            row: rowNumber,
            rawValue: label,
            message: 'Trade ledger years must be unique and strictly ascending.',
          })
        );
      }
      seenYears.add(activeYear);
      lastYear = activeYear;
      if (sourceCells.slice(2).some((cell) => normalizeVisibleText(observableCellText(cell)))) {
        rowIssues.push(
          issue({
            code: 'invalid_trade_year',
            severity: 'blocking',
            sheet,
            row: rowNumber,
            message: 'Trade year marker rows cannot contain data beyond column two.',
          })
        );
      }
      rows.push({
        sheet,
        rowNumber,
        recordKind: 'trade_year_marker',
        sourceGroupId: null,
        seasonYear: activeYear,
        acquisitionMechanism: null,
        cells: sourceCells,
        issues: rowIssues,
      });
      activeYearIssues = rowIssues.filter(({ severity }) => severity === 'blocking');
      continue;
    }

    const tradeTitle = /^(\d{4})\s+.*\bTrade\b/i.exec(label);
    if (tradeTitle && !assets) {
      closeTrade();
      const titleYear = Number(tradeTitle[1]);
      const rowIssues: AflTradeWorkbookIssue[] = [
        ...activeYearIssues,
        ...(activeYear === titleYear
          ? []
          : [
              issue({
                code: 'invalid_trade_title',
                severity: 'blocking',
                sheet,
                row: rowNumber,
                rawValue: label,
                message: 'Trade title year must match the active ledger year.',
              }),
            ]),
      ];
      if (sourceCells.slice(2).some((cell) => normalizeVisibleText(observableCellText(cell)))) {
        rowIssues.push(
          issue({
            code: 'invalid_trade_title',
            severity: 'blocking',
            sheet,
            row: rowNumber,
            message: 'Trade transaction rows cannot contain data beyond column two.',
          })
        );
      }
      rows.push({
        sheet,
        rowNumber,
        recordKind: 'trade_transaction',
        sourceGroupId: createAflTradeContentAddress('workbook-source-group', {
          sheet,
          rowNumber,
          label,
        }),
        seasonYear: activeYear,
        acquisitionMechanism: 'trade',
        cells: sourceCells,
        issues: rowIssues,
      });
      openTrade = {
        rowIndex: rows.length - 1,
        partyRowIndexes: [],
        validPartyCount: 0,
        groupId: rows.at(-1)!.sourceGroupId!,
      };
      continue;
    }

    const rowIssues: AflTradeWorkbookIssue[] = [];
    if (!label || !assets || activeYear === null || openTrade === null) {
      rowIssues.push(
        issue({
          code: 'invalid_trade_party',
          severity: 'blocking',
          sheet,
          row: rowNumber,
          rawValue: `${label} | ${assets}`,
          message: 'Trade party rows require an active year, transaction, club, and asset text.',
        })
      );
    } else {
      openTrade.validPartyCount += 1;
    }
    if (openTrade) openTrade.partyRowIndexes.push(rows.length);
    if (sourceCells.slice(2).some((cell) => normalizeVisibleText(observableCellText(cell)))) {
      rowIssues.push(
        issue({
          code: 'invalid_trade_party',
          severity: 'blocking',
          sheet,
          row: rowNumber,
          message: 'Trade party rows cannot contain data beyond column two.',
        })
      );
    }
    rows.push({
      sheet,
      rowNumber,
      recordKind: 'trade_party',
      sourceGroupId: openTrade?.groupId ?? null,
      seasonYear: activeYear,
      acquisitionMechanism: 'trade',
      cells: sourceCells,
      issues: rowIssues,
    });
  }
  closeTrade();
  return rows;
}

function supplementaryRows(input: {
  sheet: string;
  cells: readonly (readonly AflTradeWorkbookCell[])[];
  unknown: boolean;
}): MutableRow[] {
  return input.cells.map((cells, index) => {
    const rowNumber = index + 1;
    const rowIssues = input.unknown
      ? [
          issue({
            code: 'unknown_sheet',
            severity: 'blocking',
            sheet: input.sheet,
            row: rowNumber,
            message: 'Unknown sheets are quarantined and cannot enter a release partition.',
          }),
        ]
      : [];
    return {
      sheet: input.sheet,
      rowNumber,
      recordKind: input.unknown
        ? ('quarantined_row' as const)
        : index === 0
          ? ('supplementary_header' as const)
          : ('supplementary_record' as const),
      sourceGroupId: null,
      seasonYear: null,
      acquisitionMechanism: null,
      cells,
      issues: rowIssues,
    };
  });
}

function createPartitions(rows: readonly AflTradeWorkbookStagingRow[]) {
  const grouped = new Map<string, AflTradeWorkbookStagingRow[]>();
  for (const row of rows) {
    if (row.seasonYear === null) continue;
    const importKind = row.recordKind.startsWith('annual_')
      ? 'workbook_annual_acquisitions'
      : row.recordKind.startsWith('trade_')
        ? 'workbook_trade_ledger'
        : null;
    if (!importKind) continue;
    const partitionKey = `${importKind}:${row.seasonYear}`;
    const partitionRows = grouped.get(partitionKey) ?? [];
    partitionRows.push(row);
    grouped.set(partitionKey, partitionRows);
  }
  const tradeLedgerTitle = rows.find(({ recordKind }) => recordKind === 'trade_ledger_title');
  if (tradeLedgerTitle) {
    for (const [partitionKey, partitionRows] of grouped) {
      if (partitionKey.startsWith('workbook_trade_ledger:')) {
        partitionRows.unshift(tradeLedgerTitle);
      }
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([partitionKey, partitionRows]): AflTradeWorkbookImportPartition => {
      const [importKind, season] = partitionKey.split(':') as [
        AflTradeWorkbookImportPartition['importKind'],
        string,
      ];
      return {
        partitionKey,
        importKind,
        seasonYear: Number(season),
        rowCount: partitionRows.length,
        rowsSha256: sha256AflTradeCanonicalJson(
          partitionRows.map(({ stagingRowId, rowSha256, sourceLocator }) => ({
            stagingRowId,
            rowSha256,
            sourceLocator,
          }))
        ),
        rows: partitionRows,
      };
    });
}

export async function parseAflTradeWorkbookForStaging(input: {
  bytes: Uint8Array;
  sourceArtifact: AflTradeArtifactRef;
  originalFilename: string;
}): Promise<AflTradeWorkbookStagingPackage> {
  if (
    !ArrayBuffer.isView(input.bytes) ||
    !('length' in input.bytes) ||
    typeof input.bytes.length !== 'number' ||
    input.bytes.byteLength !== input.bytes.length ||
    input.bytes.byteLength === 0
  ) {
    throw new AflTradeWorkbookStagingError('INVALID_BYTES', 'Workbook bytes must be non-empty.');
  }
  if (input.bytes.byteLength > MAX_WORKBOOK_BYTES) {
    throw new AflTradeWorkbookStagingError(
      'INVALID_BYTES',
      'Workbook bytes exceed the 128 MiB parser boundary.'
    );
  }
  if (
    !doesAflTradeArtifactRefMatchBytes(
      input.sourceArtifact,
      input.bytes,
      AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_MEDIA_TYPE
    )
  ) {
    throw new AflTradeWorkbookStagingError(
      'ARTIFACT_MISMATCH',
      'Workbook bytes do not match the exact source artifact reference.'
    );
  }
  if (
    !input.originalFilename.trim() ||
    input.originalFilename.includes('/') ||
    input.originalFilename.includes('\\') ||
    !input.originalFilename.toLowerCase().endsWith('.xlsx')
  ) {
    throw new AflTradeWorkbookStagingError(
      'INVALID_FILENAME',
      'Workbook staging accepts a basename ending in .xlsx, never a local path.'
    );
  }

  const rawEvidence = extractAflTradeWorkbookOoxmlEvidence(input.bytes);

  let parsedSheets;
  try {
    parsedSheets = await readExcelFile<ParsedNumberToken>(Buffer.from(input.bytes), {
      trim: false,
      parseNumber: (lexicalValue) => ({ kind: 'parsed_number', lexicalValue }),
    });
  } catch {
    throw new AflTradeWorkbookStagingError(
      'INVALID_WORKBOOK',
      'Source bytes could not be parsed as a valid XLSX workbook.'
    );
  }

  const sheetNames = parsedSheets.map(({ sheet }) => sheet);
  if (
    new Set(sheetNames).size !== sheetNames.length ||
    sheetNames.filter((sheet) => sheet === TRADE_SHEET_NAME).length !== 1 ||
    !sheetNames.some((sheet) => /^\d{4}$/.test(sheet))
  ) {
    throw new AflTradeWorkbookStagingError(
      'INVALID_WORKBOOK',
      'Workbook staging requires unique sheet names, one trade ledger, and at least one annual sheet.'
    );
  }
  if (
    rawEvidence.sheets.length !== sheetNames.length ||
    rawEvidence.sheets.some(({ sheet }, ordinal) => sheet !== sheetNames[ordinal])
  ) {
    throw new AflTradeWorkbookStagingError(
      'INVALID_WORKBOOK',
      'Cooked workbook sheets do not match the exact OOXML sheet order.'
    );
  }

  const documentIdCounts = new Map<string, number>();
  for (const parsedSheet of parsedSheets) {
    if (!/^\d{4}$/.test(parsedSheet.sheet)) continue;
    for (const row of parsedSheet.data.slice(1)) {
      const documentId = parsedCellText(row[0]).trim();
      if (documentId) documentIdCounts.set(documentId, (documentIdCounts.get(documentId) ?? 0) + 1);
    }
  }
  const duplicateDocumentIds = new Set(
    [...documentIdCounts].filter(([, count]) => count > 1).map(([documentId]) => documentId)
  );
  const mutableRows: MutableRow[] = [];
  const sheetIssues: AflTradeWorkbookIssue[] = [];
  const inventory = [];
  for (let sheetOrdinal = 0; sheetOrdinal < parsedSheets.length; sheetOrdinal += 1) {
    const parsedSheet = parsedSheets[sheetOrdinal]!;
    const classification = classifySheet(parsedSheet.sheet);
    const cells = parsedSheet.data.map((row) =>
      row.map((cell) => parsedCellToContractCell(cell as ParsedCell))
    );
    const rows =
      classification === 'annual_acquisitions'
        ? annualRows({ sheet: parsedSheet.sheet, cells, duplicateDocumentIds })
        : classification === 'trade_ledger'
          ? tradeRows(parsedSheet.sheet, cells)
          : supplementaryRows({
              sheet: parsedSheet.sheet,
              cells,
              unknown: classification === 'quarantined_unknown',
            });
    mutableRows.push(...rows);
    if (classification === 'quarantined_unknown' && rows.length === 0) {
      sheetIssues.push(
        issue({
          code: 'unknown_sheet',
          severity: 'blocking',
          sheet: parsedSheet.sheet,
          row: 1,
          message: 'An empty unknown sheet is quarantined and cannot enter a release partition.',
        })
      );
    }
    inventory.push({
      sheet: parsedSheet.sheet,
      ordinal: sheetOrdinal,
      classification,
      rowCount: rows.length,
      sheetSha256: sha256AflTradeCanonicalJson(cells),
      partitionEligible:
        classification === 'annual_acquisitions' || classification === 'trade_ledger',
    });
  }

  const interpretedLocators = new Set(
    mutableRows.map(({ sheet, rowNumber }) => `${sheet}!R${rowNumber}`)
  );
  for (const rawSheet of rawEvidence.sheets) {
    for (const rawRow of rawSheet.rows) {
      const locator = `${rawSheet.sheet}!R${rawRow.rowNumber}`;
      if (interpretedLocators.has(locator)) continue;
      const rowIssue = issue({
        code: 'raw_row_without_interpreted_value',
        severity: 'blocking',
        sheet: rawSheet.sheet,
        row: rawRow.rowNumber,
        message:
          'A physical OOXML row was not exposed by the cooked reader and remains quarantined.',
      });
      mutableRows.push({
        sheet: rawSheet.sheet,
        rowNumber: rawRow.rowNumber,
        recordKind: 'quarantined_row',
        sourceGroupId: null,
        seasonYear: null,
        acquisitionMechanism: null,
        cells: [],
        issues: [rowIssue],
      });
      const inventoryItem = inventory.find(({ sheet }) => sheet === rawSheet.sheet);
      if (inventoryItem) inventoryItem.rowCount += 1;
    }
  }

  const rows = mutableRows.map((row, sourceOrdinal) =>
    finalizeRow(input.sourceArtifact, row, sourceOrdinal, rawEvidence)
  );
  const issues = [
    ...new Map(
      [...sheetIssues, ...mutableRows.flatMap(({ issues: rowIssues }) => rowIssues)].map(
        (rowIssue) => [rowIssue.issueId, rowIssue] as const
      )
    ).values(),
  ];
  const partitions = createPartitions(rows);
  const supplementary = rows.filter(({ recordKind }) => recordKind.startsWith('supplementary_'));
  const quarantined = rows.filter(({ recordKind }) => recordKind === 'quarantined_row');
  const mechanismCounts = Object.fromEntries(
    Object.values(AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS).map((mechanism) => [mechanism, 0])
  ) as Record<AflTradeWorkbookAcquisitionMechanism, number>;
  for (const row of rows) {
    if (row.recordKind === 'annual_acquisition' && row.acquisitionMechanism) {
      mechanismCounts[row.acquisitionMechanism] += 1;
    }
  }
  const counts = {
    sheets: inventory.length,
    physicalRows: rawEvidence.physicalRowCount,
    physicalCells: rawEvidence.physicalCellCount,
    hyperlinks: rawEvidence.hyperlinkCount,
    annualSheets: inventory.filter(({ classification }) => classification === 'annual_acquisitions')
      .length,
    annualAcquisitions: rows.filter(({ recordKind }) => recordKind === 'annual_acquisition').length,
    tradeTransactions: rows.filter(({ recordKind }) => recordKind === 'trade_transaction').length,
    tradeParties: rows.filter(({ recordKind }) => recordKind === 'trade_party').length,
    supplementaryRows: supplementary.length,
    quarantinedRows: quarantined.length,
    blockingIssues: issues.filter(({ severity }) => severity === 'blocking').length,
    reviewIssues: issues.filter(({ severity }) => severity === 'review').length,
    acquisitionMechanisms: mechanismCounts,
  };
  const packageContent = {
    contractVersion: AFL_TRADE_WORKBOOK_IMPORT_CONTRACT_VERSION,
    parserVersion: AFL_TRADE_WORKBOOK_PARSER_VERSION,
    sourceArtifactId: input.sourceArtifact.artifactId,
    rawEvidenceSha256: rawEvidence.evidenceSha256,
    originalFilename: input.originalFilename,
    sheetInventory: inventory,
    partitions: partitions.map(
      ({ partitionKey, importKind, seasonYear, rowCount, rowsSha256 }) => ({
        partitionKey,
        importKind,
        seasonYear,
        rowCount,
        rowsSha256,
      })
    ),
    allRowIds: rows.map(({ stagingRowId }) => stagingRowId),
    issueIds: issues.map(({ issueId }) => issueId).sort(),
    counts,
  };
  return {
    contractVersion: AFL_TRADE_WORKBOOK_IMPORT_CONTRACT_VERSION,
    parserVersion: AFL_TRADE_WORKBOOK_PARSER_VERSION,
    stagingPackageId: createAflTradeContentAddress('workbook-import', packageContent),
    sourceArtifact: input.sourceArtifact,
    originalFilename: input.originalFilename,
    rawAuthority: 'immutable_xlsx_artifact',
    interpretedCellSemantics: 'cooked_observable_values',
    rawEvidence,
    sheetInventory: inventory,
    rows,
    partitions,
    supplementaryRows: supplementary,
    quarantinedRows: quarantined,
    issues,
    counts,
    publicationEligible: false,
  };
}
