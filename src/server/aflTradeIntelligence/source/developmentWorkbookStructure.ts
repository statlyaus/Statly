import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import {
  AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER,
  validateAflDraftTradeAnnualWorkbookHeader,
} from './draftTradeWorkbookEvaluation';

export const AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_SCHEMA_VERSION =
  'afl-outcomes-development-workbook-report/v1' as const;
export const AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_NAME = 'AFL VFL Trades' as const;
const AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_TITLE = 'Full All-Time List of VFL/AFL Trades' as const;

export type AflOutcomesDevelopmentWorkbookErrorCode =
  | 'PRODUCTION_DISABLED'
  | 'MISSING_PATH'
  | 'PATH_NOT_ABSOLUTE'
  | 'WORKSPACE_PATH_FORBIDDEN'
  | 'INVALID_EXTENSION'
  | 'INVALID_DIGEST'
  | 'DIGEST_MISMATCH'
  | 'NOT_A_FILE'
  | 'EMPTY_FILE'
  | 'SIZE_LIMIT_EXCEEDED'
  | 'INVALID_WORKBOOK'
  | 'UNSUPPORTED_ACQUISITION_TYPE'
  | 'NO_ANNUAL_SHEETS'
  | 'MISSING_TRADE_SHEET'
  | 'INVALID_TRADE_SHEET'
  | 'INVALID_ANNUAL_HEADER'
  | 'INVALID_CELL_VALUE'
  | 'EXTRA_ANNUAL_COLUMNS'
  | 'INVALID_DOCUMENT_ID'
  | 'DUPLICATE_DOCUMENT_ID'
  | 'YEAR_MISMATCH';

export class AflOutcomesDevelopmentWorkbookError extends Error {
  readonly code: AflOutcomesDevelopmentWorkbookErrorCode;

  constructor(code: AflOutcomesDevelopmentWorkbookErrorCode, message: string) {
    super(message);
    this.name = 'AflOutcomesDevelopmentWorkbookError';
    this.code = code;
  }
}

export type AflOutcomesDevelopmentWorkbookCell =
  string | number | boolean | Date | typeof Date | null;

export interface AflOutcomesDevelopmentWorkbookSheetInput {
  sheet: string;
  data: readonly (readonly AflOutcomesDevelopmentWorkbookCell[])[];
}

export interface AflOutcomesDevelopmentWorkbookAnnualRow {
  rowNumber: number;
  cells: readonly string[];
}

export interface AflOutcomesDevelopmentWorkbookAnnualSheet {
  sheet: string;
  header: readonly string[];
  rows: readonly AflOutcomesDevelopmentWorkbookAnnualRow[];
}

export interface AflOutcomesDevelopmentWorkbookTradeRow {
  rowNumber: number;
  cells: readonly [string, string];
}

export interface AflOutcomesDevelopmentWorkbookTradeSheet {
  sheet: typeof AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_NAME;
  rows: readonly AflOutcomesDevelopmentWorkbookTradeRow[];
  tradeCount: number;
  partyCount: number;
  years: readonly number[];
}

export interface AflOutcomesDevelopmentWorkbookReport {
  schemaVersion: typeof AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_SCHEMA_VERSION;
  source: Readonly<{
    originalFilename: string;
    mediaType: string;
    byteLength: number;
    sha256: string;
    observedAt: string;
  }>;
  annualSheetCount: number;
  annualSheets: readonly Readonly<{ year: number; rowCount: number }>[];
  tradeSheet: Readonly<{
    tradeCount: number;
    partyCount: number;
    years: readonly number[];
  }>;
  ignoredSheetCount: number;
  totalRows: number;
  anomalyCounts: Readonly<{
    compositeGamesRows: number;
    unresolvedGamesRows: number;
    blankPickRows: number;
    labelledPickRows: number;
    missingWeightRows: number;
    awardRows: number;
  }>;
}

export interface AflOutcomesDevelopmentWorkbook {
  sourceArtifact: AflTradeArtifactRef;
  annualSheets: readonly AflOutcomesDevelopmentWorkbookAnnualSheet[];
  tradeSheet: AflOutcomesDevelopmentWorkbookTradeSheet;
  report: AflOutcomesDevelopmentWorkbookReport;
}

interface NormalizeDevelopmentWorkbookInput {
  sheets: readonly AflOutcomesDevelopmentWorkbookSheetInput[];
  sourceArtifact: AflTradeArtifactRef;
  originalFilename: string;
}

function normalizeCellValue(
  value: AflOutcomesDevelopmentWorkbookCell,
  sheet: string,
  rowNumber: number,
  columnNumber: number
): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  throw new AflOutcomesDevelopmentWorkbookError(
    'INVALID_CELL_VALUE',
    `Annual sheet ${sheet} row ${rowNumber} column ${columnNumber} contains an unsupported cell value.`
  );
}

function normalizeAnnualRow(
  row: readonly AflOutcomesDevelopmentWorkbookCell[],
  sheet: string,
  rowNumber: number
): string[] {
  const expectedColumns = AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER.length;
  const extraValues = row.slice(expectedColumns);
  if (extraValues.some((value) => value !== null && value !== '')) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'EXTRA_ANNUAL_COLUMNS',
      `Annual sheet ${sheet} row ${rowNumber} contains data after column ${expectedColumns}.`
    );
  }
  return Array.from({ length: expectedColumns }, (_, index) =>
    normalizeCellValue(row[index] ?? null, sheet, rowNumber, index + 1)
  );
}

function normalizeTradeCell(
  value: AflOutcomesDevelopmentWorkbookCell,
  rowNumber: number,
  columnNumber: number
): string {
  return normalizeCellValue(
    value,
    AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_NAME,
    rowNumber,
    columnNumber
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTradeSheet(
  input: AflOutcomesDevelopmentWorkbookSheetInput
): AflOutcomesDevelopmentWorkbookTradeSheet {
  const rows = input.data.map((unparsedRow, index) => {
    const rowNumber = index + 1;
    if (
      unparsedRow
        .slice(2)
        .some((value) => value !== null && normalizeTradeCell(value, rowNumber, 3) !== '')
    ) {
      throw new AflOutcomesDevelopmentWorkbookError(
        'INVALID_TRADE_SHEET',
        `Trade sheet row ${rowNumber} contains data after column 2.`
      );
    }
    return {
      rowNumber,
      cells: [
        normalizeTradeCell(unparsedRow[0] ?? null, rowNumber, 1),
        normalizeTradeCell(unparsedRow[1] ?? null, rowNumber, 2),
      ] as const,
    };
  });

  if (
    rows[0]?.cells[0] !== AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_TITLE ||
    rows[0]?.cells[1] !== ''
  ) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_TRADE_SHEET',
      `Trade sheet must begin with "${AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_TITLE}".`
    );
  }

  const years: number[] = [];
  let activeYear: number | null = null;
  let activeTradeOpen = false;
  let activeTradePartyCount = 0;
  let tradeCount = 0;
  let partyCount = 0;

  const closeTrade = (rowNumber: number) => {
    if (activeTradeOpen && activeTradePartyCount < 2) {
      throw new AflOutcomesDevelopmentWorkbookError(
        'INVALID_TRADE_SHEET',
        `Trade ending before row ${rowNumber} must contain at least two club rows.`
      );
    }
    activeTradeOpen = false;
    activeTradePartyCount = 0;
  };

  for (const row of rows.slice(1)) {
    const [label, assets] = row.cells;
    if (!label || assets) {
      if (!label || !assets || activeYear === null || !activeTradeOpen) {
        throw new AflOutcomesDevelopmentWorkbookError(
          'INVALID_TRADE_SHEET',
          `Trade sheet row ${row.rowNumber} is not a valid club-and-assets row.`
        );
      }
      activeTradePartyCount += 1;
      partyCount += 1;
      continue;
    }

    if (/^\d{4}$/.test(label)) {
      closeTrade(row.rowNumber);
      const year = Number(label);
      if (years.includes(year) || (years.length > 0 && year <= years[years.length - 1]!)) {
        throw new AflOutcomesDevelopmentWorkbookError(
          'INVALID_TRADE_SHEET',
          `Trade sheet year ${year} is duplicated or out of order.`
        );
      }
      years.push(year);
      activeYear = year;
      continue;
    }

    const titleMatch = /^(\d{4})\s+.*\bTrade\b/i.exec(label);
    if (!titleMatch || activeYear === null || Number(titleMatch[1]) !== activeYear) {
      throw new AflOutcomesDevelopmentWorkbookError(
        'INVALID_TRADE_SHEET',
        `Trade sheet row ${row.rowNumber} is not a valid trade title for the active year.`
      );
    }
    closeTrade(row.rowNumber);
    tradeCount += 1;
    activeTradeOpen = true;
  }
  closeTrade(rows.length + 1);

  if (years.length === 0 || tradeCount === 0) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_TRADE_SHEET',
      'Trade sheet must contain at least one year and one trade.'
    );
  }

  return {
    sheet: AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_NAME,
    rows,
    tradeCount,
    partyCount,
    years,
  };
}

function validateAnnualIdentity(sheet: string, row: AflOutcomesDevelopmentWorkbookAnnualRow) {
  const documentId = row.cells[0].trim();
  const year = row.cells[1].trim();
  if (!/^\d{4}_\d{4}$/.test(documentId)) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'INVALID_DOCUMENT_ID',
      `Annual sheet ${sheet} row ${row.rowNumber} has an invalid document_id.`
    );
  }
  if (year !== sheet || !documentId.startsWith(`${sheet}_`)) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'YEAR_MISMATCH',
      `Annual sheet ${sheet} row ${row.rowNumber} does not match its document identity.`
    );
  }
  return documentId;
}

export function normalizeAflOutcomesDevelopmentWorkbook(
  input: NormalizeDevelopmentWorkbookInput
): AflOutcomesDevelopmentWorkbook {
  const tradeInput = input.sheets.find(
    ({ sheet }) => sheet === AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_NAME
  );
  if (!tradeInput) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'MISSING_TRADE_SHEET',
      `The development workbook is missing the ${AFL_OUTCOMES_DEVELOPMENT_TRADE_SHEET_NAME} sheet.`
    );
  }
  const tradeSheet = normalizeTradeSheet(tradeInput);
  const annualInputs = input.sheets
    .filter(({ sheet }) => /^\d{4}$/.test(sheet))
    .sort((left, right) => left.sheet.localeCompare(right.sheet));
  if (annualInputs.length === 0) {
    throw new AflOutcomesDevelopmentWorkbookError(
      'NO_ANNUAL_SHEETS',
      'The development workbook contains no four-digit annual sheets.'
    );
  }

  const seenDocumentIds = new Set<string>();
  let compositeGamesRows = 0;
  let unresolvedGamesRows = 0;
  let blankPickRows = 0;
  let labelledPickRows = 0;
  let missingWeightRows = 0;
  let awardRows = 0;

  const annualSheets = annualInputs.map(({ sheet, data }) => {
    if (data.length === 0) {
      throw new AflOutcomesDevelopmentWorkbookError(
        'INVALID_ANNUAL_HEADER',
        `Annual sheet ${sheet} is empty.`
      );
    }
    const header = normalizeAnnualRow(data[0], sheet, 1);
    try {
      validateAflDraftTradeAnnualWorkbookHeader(header);
    } catch {
      throw new AflOutcomesDevelopmentWorkbookError(
        'INVALID_ANNUAL_HEADER',
        `Annual sheet ${sheet} does not have the exact ordered 18-column header.`
      );
    }

    const rows = data.slice(1).map((unparsedRow, index) => {
      const row = {
        rowNumber: index + 2,
        cells: normalizeAnnualRow(unparsedRow, sheet, index + 2),
      };
      const documentId = validateAnnualIdentity(sheet, row);
      if (seenDocumentIds.has(documentId)) {
        throw new AflOutcomesDevelopmentWorkbookError(
          'DUPLICATE_DOCUMENT_ID',
          `Annual workbook document_id ${documentId} is duplicated.`
        );
      }
      seenDocumentIds.add(documentId);

      const games = row.cells[13].trim();
      if (/^\d+\s*\(\s*\d+\s*\)$/.test(games)) compositeGamesRows += 1;
      else if (games !== '' && !/^\d+$/.test(games)) unresolvedGamesRows += 1;
      const pick = row.cells[2].trim();
      if (pick === '') blankPickRows += 1;
      else if (!/^\d+$/.test(pick)) labelledPickRows += 1;
      if (row.cells[10].trim() === '') missingWeightRows += 1;
      if (row.cells[17].trim() !== '') awardRows += 1;
      return row;
    });

    return { sheet, header, rows };
  });

  const totalRows = annualSheets.reduce((total, sheet) => total + sheet.rows.length, 0);
  return {
    sourceArtifact: input.sourceArtifact,
    annualSheets,
    tradeSheet,
    report: {
      schemaVersion: AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_SCHEMA_VERSION,
      source: {
        originalFilename: input.originalFilename,
        mediaType: input.sourceArtifact.mediaType,
        byteLength: input.sourceArtifact.byteLength,
        sha256: input.sourceArtifact.contentSha256,
        observedAt: input.sourceArtifact.createdAt,
      },
      annualSheetCount: annualSheets.length,
      annualSheets: annualSheets.map(({ sheet, rows }) => ({
        year: Number(sheet),
        rowCount: rows.length,
      })),
      tradeSheet: {
        tradeCount: tradeSheet.tradeCount,
        partyCount: tradeSheet.partyCount,
        years: tradeSheet.years,
      },
      ignoredSheetCount: input.sheets.length - annualSheets.length - 1,
      totalRows,
      anomalyCounts: {
        compositeGamesRows,
        unresolvedGamesRows,
        blankPickRows,
        labelledPickRows,
        missingWeightRows,
        awardRows,
      },
    },
  };
}
