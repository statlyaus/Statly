import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import {
  AFL_DRAFT_TRADE_ANNUAL_WORKBOOK_HEADER,
  validateAflDraftTradeAnnualWorkbookHeader,
} from './draftTradeWorkbookEvaluation';

export const AFL_OUTCOMES_DEVELOPMENT_WORKBOOK_SCHEMA_VERSION =
  'afl-outcomes-development-workbook-report/v1' as const;

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
  | 'NO_ANNUAL_SHEETS'
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
  | string
  | number
  | boolean
  | Date
  | typeof Date
  | null;

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
      ignoredSheetCount: input.sheets.length - annualSheets.length,
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
