import type { AflTradeArtifactRef } from '../artifacts/artifactReference';

export const AFL_TRADE_WORKBOOK_IMPORT_CONTRACT_VERSION = 'afl-trade-workbook-import/v1' as const;
export const AFL_TRADE_WORKBOOK_PARSER_VERSION = 'afl-trade-workbook-parser/1.0.0' as const;

export const AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS = {
  National: 'national_draft',
  Rookie: 'rookie_draft',
  'Mid-Season': 'midseason_draft',
  'Pre-Season': 'preseason_draft',
  'Mini-Draft': 'mini_draft',
  Trade: 'trade',
  'Free Agency': 'free_agency',
  'Pre-Draft': 'pre_draft',
  'Post-Draft': 'post_draft',
  'Training Squad Selection': 'training_squad',
} as const;

export type AflTradeWorkbookAcquisitionLabel =
  keyof typeof AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS;
export type AflTradeWorkbookAcquisitionMechanism =
  (typeof AFL_TRADE_WORKBOOK_ACQUISITION_MECHANISMS)[AflTradeWorkbookAcquisitionLabel];

export type AflTradeWorkbookCell =
  | Readonly<{ kind: 'blank' }>
  | Readonly<{ kind: 'text'; value: string }>
  | Readonly<{ kind: 'number'; lexicalValue: string }>
  | Readonly<{ kind: 'boolean'; value: boolean }>
  | Readonly<{ kind: 'date'; isoValue: string }>;

export interface AflTradeWorkbookRawFormula {
  text: string | null;
  attributes: Readonly<Record<string, string>>;
  formulaType: string | null;
  sharedIndex: string | null;
  reference: string | null;
}

export interface AflTradeWorkbookRawCell {
  coordinate: string;
  attributes: Readonly<Record<string, string>>;
  sourceType: string | null;
  styleIndex: string | null;
  cachedValue: string | null;
  inlineText: string | null;
  inlineStructure: unknown | null;
  formula: AflTradeWorkbookRawFormula | null;
}

export interface AflTradeWorkbookRawRow {
  rowNumber: number;
  hidden: boolean;
  physicalCellCount: number;
  cells: readonly AflTradeWorkbookRawCell[];
}

export interface AflTradeWorkbookRawHyperlink {
  reference: string;
  relationshipId: string | null;
  target: string | null;
  targetMode: string | null;
  location: string | null;
  display: string | null;
  tooltip: string | null;
}

export interface AflTradeWorkbookRawSheetEvidence {
  sheet: string;
  ordinal: number;
  visibility: 'visible' | 'hidden' | 'veryHidden';
  worksheetPath: string;
  physicalRowCount: number;
  physicalCellCount: number;
  rows: readonly AflTradeWorkbookRawRow[];
  hyperlinks: readonly AflTradeWorkbookRawHyperlink[];
}

export interface AflTradeWorkbookRawEvidence {
  evidenceVersion: 'afl-trade-workbook-ooxml-evidence/v1';
  evidenceSha256: string;
  archiveEntryCount: number;
  inflatedByteLength: number;
  physicalRowCount: number;
  physicalCellCount: number;
  hyperlinkCount: number;
  date1904: boolean;
  referencedParts: readonly Readonly<{
    partName: string;
    byteLength: number;
    contentSha256: string;
  }>[];
  supportingTables: Readonly<{
    workbookProperties: Readonly<Record<string, string>>;
    styles: unknown | null;
    sharedStrings: unknown | null;
  }>;
  sheets: readonly AflTradeWorkbookRawSheetEvidence[];
}

export type AflTradeWorkbookSheetClassification =
  | 'annual_acquisitions'
  | 'trade_ledger'
  | 'supplementary_overview'
  | 'supplementary_awards_glossary'
  | 'quarantined_unknown';

export type AflTradeWorkbookRecordKind =
  | 'annual_header'
  | 'annual_acquisition'
  | 'trade_ledger_title'
  | 'trade_year_marker'
  | 'trade_transaction'
  | 'trade_party'
  | 'supplementary_header'
  | 'supplementary_record'
  | 'quarantined_row';

export type AflTradeWorkbookIssueCode =
  | 'unknown_sheet'
  | 'invalid_annual_header'
  | 'invalid_document_id'
  | 'duplicate_document_id'
  | 'year_mismatch'
  | 'extra_annual_columns'
  | 'missing_required_annual_field'
  | 'unsupported_acquisition_mechanism'
  | 'invalid_trade_year'
  | 'invalid_trade_title'
  | 'invalid_trade_party'
  | 'trade_has_fewer_than_two_parties'
  | 'composite_games'
  | 'unresolved_games'
  | 'labelled_pick'
  | 'missing_weight'
  | 'workbook_grade_is_non_authoritative'
  | 'award_requires_resolution'
  | 'raw_row_without_interpreted_value';

export interface AflTradeWorkbookSourceLocator {
  sheet: string;
  row: number;
}

export interface AflTradeWorkbookIssue {
  issueId: string;
  code: AflTradeWorkbookIssueCode;
  severity: 'review' | 'blocking';
  locator: AflTradeWorkbookSourceLocator;
  field: string | null;
  rawValue: string | null;
  message: string;
}

export interface AflTradeWorkbookAuthenticatedRowPayload {
  sourceLocator: string;
  sourceOrdinal: number;
  sheet: string;
  rowNumber: number;
  recordKind: AflTradeWorkbookRecordKind;
  sourceGroupId: string | null;
  seasonYear: number | null;
  acquisitionMechanism: AflTradeWorkbookAcquisitionMechanism | null;
  parseStatus: 'staged' | 'needs_review' | 'rejected';
  interpretedCellSemantics: 'cooked_observable_values';
  cells: readonly AflTradeWorkbookCell[];
  rawOoxml: Readonly<{
    evidenceSha256: string;
    sheet: Readonly<{
      ordinal: number;
      visibility: AflTradeWorkbookRawSheetEvidence['visibility'];
      worksheetPath: string;
    }>;
    row: AflTradeWorkbookRawRow | null;
    hyperlinks: readonly AflTradeWorkbookRawHyperlink[];
  }>;
  issueIds: readonly string[];
}

export interface AflTradeWorkbookStagingRow {
  stagingRowId: string;
  sourceLocator: string;
  sourceOrdinal: number;
  sheet: string;
  rowNumber: number;
  recordKind: AflTradeWorkbookRecordKind;
  sourceGroupId: string | null;
  seasonYear: number | null;
  acquisitionMechanism: AflTradeWorkbookAcquisitionMechanism | null;
  parseStatus: 'staged' | 'needs_review' | 'rejected';
  rowSha256: string;
  authenticatedPayload: AflTradeWorkbookAuthenticatedRowPayload;
  cells: readonly AflTradeWorkbookCell[];
  rawOoxml: AflTradeWorkbookAuthenticatedRowPayload['rawOoxml'];
  issueIds: readonly string[];
}

export interface AflTradeWorkbookSheetInventoryItem {
  sheet: string;
  ordinal: number;
  classification: AflTradeWorkbookSheetClassification;
  rowCount: number;
  sheetSha256: string;
  partitionEligible: boolean;
}

export interface AflTradeWorkbookImportPartition {
  partitionKey: string;
  importKind: 'workbook_annual_acquisitions' | 'workbook_trade_ledger';
  seasonYear: number;
  rowCount: number;
  rowsSha256: string;
  rows: readonly AflTradeWorkbookStagingRow[];
}

export interface AflTradeWorkbookStagingPackage {
  contractVersion: typeof AFL_TRADE_WORKBOOK_IMPORT_CONTRACT_VERSION;
  parserVersion: typeof AFL_TRADE_WORKBOOK_PARSER_VERSION;
  stagingPackageId: string;
  sourceArtifact: AflTradeArtifactRef;
  originalFilename: string;
  rawAuthority: 'immutable_xlsx_artifact';
  interpretedCellSemantics: 'cooked_observable_values';
  rawEvidence: AflTradeWorkbookRawEvidence;
  sheetInventory: readonly AflTradeWorkbookSheetInventoryItem[];
  rows: readonly AflTradeWorkbookStagingRow[];
  partitions: readonly AflTradeWorkbookImportPartition[];
  supplementaryRows: readonly AflTradeWorkbookStagingRow[];
  quarantinedRows: readonly AflTradeWorkbookStagingRow[];
  issues: readonly AflTradeWorkbookIssue[];
  counts: Readonly<{
    sheets: number;
    physicalRows: number;
    physicalCells: number;
    hyperlinks: number;
    annualSheets: number;
    annualAcquisitions: number;
    tradeTransactions: number;
    tradeParties: number;
    supplementaryRows: number;
    quarantinedRows: number;
    blockingIssues: number;
    reviewIssues: number;
    acquisitionMechanisms: Readonly<Record<AflTradeWorkbookAcquisitionMechanism, number>>;
  }>;
  publicationEligible: false;
}

export interface PersistAflTradeWorkbookPackageInput {
  captureId: string;
  environment: 'test_fixture' | 'non_production' | 'production';
  sourceArtifact: AflTradeArtifactRef;
  originalFilename: string;
  startedAt: string;
  completedAt: string;
}

export interface PersistedAflTradeWorkbookPackage {
  importRunId: string;
  stagingPackageId: string;
  captureId: string;
  rowCount: number;
  partitionCount: number;
  issueCount: number;
  status: 'needs_review' | 'rejected';
  idempotentReplay: boolean;
}
