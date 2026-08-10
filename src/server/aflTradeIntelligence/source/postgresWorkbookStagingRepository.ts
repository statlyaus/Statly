import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  AFL_TRADE_WORKBOOK_PARSER_VERSION,
  type AflTradeWorkbookStagingPackage,
  type PersistAflTradeWorkbookPackageInput,
  type PersistedAflTradeWorkbookPackage,
} from './workbookImportContracts';
import { parseAflTradeWorkbookForStaging } from './workbookStagingParser';

export const AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER = 'statly-curated-workbook' as const;
export const AFL_TRADE_WORKBOOK_CAPTURE_DATASET = 'afl-drafts-trades' as const;
export const AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM = 'reviewed_workbook_upload' as const;
const MAX_WORKBOOK_BYTES = 128 * 1024 * 1024;
const IMPORT_KIND = 'workbook_full_archive';

interface CaptureRow {
  capture_id: string;
  environment: PersistAflTradeWorkbookPackageInput['environment'];
  provider: string;
  dataset: string;
  access_mechanism: string;
  status: string;
  artifact_id: string;
  content_sha256: string;
}

interface CaptureScopeRow {
  competition: string;
  season_year: number;
}

interface ImportRunRow {
  import_run_id: string;
  status: 'needs_review' | 'rejected';
  started_at: Date | string;
  completed_at: Date | string | null;
  manifest_json: unknown;
}

export class AflTradeWorkbookPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'ARTIFACT_UNAVAILABLE'
      | 'CAPTURE_NOT_FOUND'
      | 'CAPTURE_MISMATCH'
      | 'IMPORT_CONFLICT'
      | 'IMPORT_INCOMPLETE',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeWorkbookPersistenceError';
  }
}

function parseIsoInstant(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new AflTradeWorkbookPersistenceError(
      'INVALID_REQUEST',
      `${field} must be an exact UTC ISO-8601 instant.`
    );
  }
  return value;
}

function createRunManifest(input: {
  request: PersistAflTradeWorkbookPackageInput;
  package: AflTradeWorkbookStagingPackage;
  importRunId: string;
}) {
  return {
    contractVersion: input.package.contractVersion,
    parserVersion: input.package.parserVersion,
    importRunId: input.importRunId,
    stagingPackageId: input.package.stagingPackageId,
    sourceArtifact: {
      artifactId: input.package.sourceArtifact.artifactId,
      contentSha256: input.package.sourceArtifact.contentSha256,
      byteLength: input.package.sourceArtifact.byteLength,
      mediaType: input.package.sourceArtifact.mediaType,
    },
    originalFilename: input.package.originalFilename,
    rawAuthority: input.package.rawAuthority,
    interpretedCellSemantics: input.package.interpretedCellSemantics,
    rawEvidenceSha256: input.package.rawEvidence.evidenceSha256,
    rawWorkbookEvidence: {
      date1904: input.package.rawEvidence.date1904,
      referencedParts: input.package.rawEvidence.referencedParts,
      supportingTables: input.package.rawEvidence.supportingTables,
      hyperlinks: input.package.rawEvidence.sheets.flatMap(({ sheet, hyperlinks }) =>
        hyperlinks.map((hyperlink) => ({ sheet, ...hyperlink }))
      ),
    },
    rawSheetEvidence: input.package.rawEvidence.sheets.map(
      ({
        sheet,
        ordinal,
        visibility,
        worksheetPath,
        physicalRowCount,
        physicalCellCount,
        hyperlinks,
      }) => ({
        sheet,
        ordinal,
        visibility,
        worksheetPath,
        physicalRowCount,
        physicalCellCount,
        hyperlinkCount: hyperlinks.length,
      })
    ),
    sheetInventory: input.package.sheetInventory,
    startedAt: input.request.startedAt,
    completedAt: input.request.completedAt,
    rowCount: input.package.rows.length,
    partitionCount: input.package.partitions.length,
    issueCount: input.package.issues.length,
    counts: input.package.counts,
    publicationEligible: false,
  } as const;
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

async function requireExactCapture(
  transaction: AflOutcomeSqlTransaction,
  input: PersistAflTradeWorkbookPackageInput,
  staging: AflTradeWorkbookStagingPackage
) {
  const result = await transaction.query<CaptureRow>(
    `SELECT capture.capture_id,
            capture.environment,
            capture.provider,
            capture.dataset,
            capture.access_mechanism,
            capture.status,
            artifact.artifact_id,
            artifact.content_sha256
       FROM outcome_source_capture capture
       JOIN outcome_artifact_custody artifact
         ON artifact.artifact_id = capture.source_artifact_id
      WHERE capture.capture_id = $1
      FOR SHARE OF capture, artifact`,
    [input.captureId]
  );
  if (result.rows.length !== 1) {
    throw new AflTradeWorkbookPersistenceError(
      'CAPTURE_NOT_FOUND',
      'The governed workbook source capture is unavailable.'
    );
  }
  const capture = result.rows[0]!;
  if (
    capture.environment !== input.environment ||
    capture.provider !== AFL_TRADE_WORKBOOK_CAPTURE_PROVIDER ||
    capture.dataset !== AFL_TRADE_WORKBOOK_CAPTURE_DATASET ||
    capture.access_mechanism !== AFL_TRADE_WORKBOOK_CAPTURE_ACCESS_MECHANISM ||
    capture.status !== 'approved' ||
    capture.artifact_id !== staging.sourceArtifact.artifactId ||
    capture.content_sha256 !== staging.sourceArtifact.contentSha256
  ) {
    throw new AflTradeWorkbookPersistenceError(
      'CAPTURE_MISMATCH',
      'The workbook import does not match its approved environment, provider, dataset, access mechanism, or exact source bytes.'
    );
  }
  const scopes = await transaction.query<CaptureScopeRow>(
    `SELECT competition, season_year
       FROM outcome_source_capture_season
      WHERE capture_id = $1
      ORDER BY competition, season_year
      FOR SHARE`,
    [input.captureId]
  );
  const approvedSeasons = new Set(
    scopes.rows
      .filter(({ competition }) => competition === 'AFL')
      .map(({ season_year }) => season_year)
  );
  const requiredSeasons = new Set(staging.partitions.map(({ seasonYear }) => seasonYear));
  if ([...requiredSeasons].some((seasonYear) => !approvedSeasons.has(seasonYear))) {
    throw new AflTradeWorkbookPersistenceError(
      'CAPTURE_MISMATCH',
      'The workbook capture does not authorize every AFL season represented by its partitions.'
    );
  }
}

async function verifyExistingRun(input: {
  transaction: AflOutcomeSqlTransaction;
  request: PersistAflTradeWorkbookPackageInput;
  staging: AflTradeWorkbookStagingPackage;
  importRunId: string;
  status: 'needs_review' | 'rejected';
  manifest: unknown;
}): Promise<PersistedAflTradeWorkbookPackage | null> {
  const result = await input.transaction.query<ImportRunRow>(
    `SELECT import_run_id, status, started_at, completed_at, manifest_json
       FROM outcome_import_run
      WHERE capture_id = $1 AND import_kind = $2 AND parser_version = $3
      FOR SHARE`,
    [input.request.captureId, IMPORT_KIND, input.staging.parserVersion]
  );
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw new AflTradeWorkbookPersistenceError(
      'IMPORT_CONFLICT',
      'The workbook import idempotency key resolved to more than one run.'
    );
  }
  const existing = result.rows[0]!;
  const startedAt =
    existing.started_at instanceof Date ? existing.started_at.toISOString() : existing.started_at;
  const completedAt =
    existing.completed_at instanceof Date
      ? existing.completed_at.toISOString()
      : existing.completed_at;
  if (
    existing.import_run_id !== input.importRunId ||
    existing.status !== input.status ||
    startedAt !== input.request.startedAt ||
    completedAt !== input.request.completedAt ||
    !sameJson(existing.manifest_json, input.manifest)
  ) {
    throw new AflTradeWorkbookPersistenceError(
      'IMPORT_CONFLICT',
      'The workbook import idempotency key already binds different immutable evidence.'
    );
  }
  const counts = await input.transaction.query<{
    row_count: string | number;
    partition_count: string | number;
    issue_count: string | number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM outcome_import_row WHERE import_run_id = $1) AS row_count,
       (SELECT COUNT(*) FROM outcome_import_partition WHERE import_run_id = $1) AS partition_count,
       (SELECT COUNT(*) FROM outcome_data_exception WHERE capture_id = $2 AND details_json->>'importRunId' = $1) AS issue_count`,
    [input.importRunId, input.request.captureId]
  );
  const count = counts.rows[0];
  if (
    Number(count?.row_count ?? -1) !== input.staging.rows.length ||
    Number(count?.partition_count ?? -1) !== input.staging.partitions.length ||
    Number(count?.issue_count ?? -1) !== input.staging.issues.length
  ) {
    throw new AflTradeWorkbookPersistenceError(
      'IMPORT_INCOMPLETE',
      'The immutable workbook import exists without its exact row, partition, and issue counts.'
    );
  }
  return {
    importRunId: input.importRunId,
    stagingPackageId: input.staging.stagingPackageId,
    captureId: input.request.captureId,
    rowCount: input.staging.rows.length,
    partitionCount: input.staging.partitions.length,
    issueCount: input.staging.issues.length,
    status: input.status,
    idempotentReplay: true,
  };
}

function databaseImportRowId(importRunId: string, stagingRowId: string) {
  return createAflTradeContentAddress('import-row', { importRunId, stagingRowId });
}

async function insertRows(input: {
  transaction: AflOutcomeSqlTransaction;
  importRunId: string;
  staging: AflTradeWorkbookStagingPackage;
  recordedAt: string;
}) {
  const chunkSize = 200;
  for (let offset = 0; offset < input.staging.rows.length; offset += chunkSize) {
    const chunk = input.staging.rows.slice(offset, offset + chunkSize);
    const parameters: unknown[] = [];
    const values = chunk.map((row, index) => {
      const parameterOffset = index * 9;
      parameters.push(
        databaseImportRowId(input.importRunId, row.stagingRowId),
        input.importRunId,
        row.sourceLocator,
        row.sourceOrdinal,
        row.recordKind,
        row.rowSha256,
        row.parseStatus,
        {
          stagingPackageId: input.staging.stagingPackageId,
          rawEvidenceSha256: input.staging.rawEvidence.evidenceSha256,
          stagingRowId: row.stagingRowId,
          rowSha256: row.rowSha256,
          authenticatedPayload: row.authenticatedPayload,
        },
        input.recordedAt
      );
      return `($${parameterOffset + 1}, $${parameterOffset + 2}, $${parameterOffset + 3}, $${parameterOffset + 4}, $${parameterOffset + 5}, $${parameterOffset + 6}, $${parameterOffset + 7}, $${parameterOffset + 8}, $${parameterOffset + 9})`;
    });
    await input.transaction.query(
      `INSERT INTO outcome_import_row
        (import_row_id, import_run_id, source_locator, source_ordinal, record_kind,
         row_sha256, parse_status, raw_payload, recorded_at)
       VALUES ${values.join(', ')}`,
      parameters
    );
  }
}

async function insertPartitions(input: {
  transaction: AflOutcomeSqlTransaction;
  importRunId: string;
  staging: AflTradeWorkbookStagingPackage;
}) {
  for (const partition of input.staging.partitions) {
    const importPartitionId = createAflTradeContentAddress('import-partition', {
      importRunId: input.importRunId,
      partitionKey: partition.partitionKey,
      rowsSha256: partition.rowsSha256,
    });
    await input.transaction.query(
      `INSERT INTO outcome_import_partition
        (import_partition_id, import_run_id, partition_key, partition_kind, competition,
         season_year, row_count, rows_sha256, partition_json)
       VALUES ($1, $2, $3, $4, 'AFL', $5, $6, $7, $8)`,
      [
        importPartitionId,
        input.importRunId,
        partition.partitionKey,
        partition.importKind,
        partition.seasonYear,
        partition.rowCount,
        partition.rowsSha256,
        {
          stagingPackageId: input.staging.stagingPackageId,
          partitionKey: partition.partitionKey,
          publicationEligible: false,
        },
      ]
    );
    const parameters: unknown[] = [];
    const values = partition.rows.map((row, ordinal) => {
      const offset = ordinal * 4;
      parameters.push(
        importPartitionId,
        databaseImportRowId(input.importRunId, row.stagingRowId),
        input.importRunId,
        ordinal
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    });
    await input.transaction.query(
      `INSERT INTO outcome_import_partition_row
        (import_partition_id, import_row_id, import_run_id, ordinal)
       VALUES ${values.join(', ')}`,
      parameters
    );
  }
}

async function insertIssues(input: {
  transaction: AflOutcomeSqlTransaction;
  importRunId: string;
  captureId: string;
  staging: AflTradeWorkbookStagingPackage;
  detectedAt: string;
}) {
  const rowByLocator = new Map(input.staging.rows.map((row) => [row.sourceLocator, row]));
  const chunkSize = 150;
  for (let offset = 0; offset < input.staging.issues.length; offset += chunkSize) {
    const chunk = input.staging.issues.slice(offset, offset + chunkSize);
    const parameters: unknown[] = [];
    const values = chunk.map((issue, index) => {
      const locator = `${issue.locator.sheet}!R${issue.locator.row}`;
      const stagingRow = rowByLocator.get(locator);
      const importRowId = stagingRow
        ? databaseImportRowId(input.importRunId, stagingRow.stagingRowId)
        : null;
      const parameterOffset = index * 9;
      parameters.push(
        createAflTradeContentAddress('data-exception', {
          importRunId: input.importRunId,
          issueId: issue.issueId,
        }),
        input.captureId,
        importRowId,
        issue.code,
        issue.severity,
        'workbook_row',
        stagingRow?.stagingRowId ?? issue.issueId,
        { importRunId: input.importRunId, issue },
        input.detectedAt
      );
      return `($${parameterOffset + 1}, $${parameterOffset + 2}, $${parameterOffset + 3}, $${parameterOffset + 4}, $${parameterOffset + 5}, $${parameterOffset + 6}, $${parameterOffset + 7}, $${parameterOffset + 8}, $${parameterOffset + 9})`;
    });
    await input.transaction.query(
      `INSERT INTO outcome_data_exception
        (exception_id, capture_id, import_row_id, exception_code, severity, subject_type,
         subject_id, details_json, detected_at)
       VALUES ${values.join(', ')}`,
      parameters
    );
  }
}

export class PostgresAflTradeWorkbookStagingRepository {
  constructor(
    private readonly client: AflOutcomeSqlClient,
    private readonly rawArtifactRepository: AflTradeImmutableArtifactRepository
  ) {
    if (rawArtifactRepository.artifactClass !== 'raw_source') {
      throw new AflTradeWorkbookPersistenceError(
        'INVALID_REQUEST',
        'Workbook import requires the isolated raw-source artifact repository.'
      );
    }
  }

  async persistPackage(
    input: PersistAflTradeWorkbookPackageInput
  ): Promise<PersistedAflTradeWorkbookPackage> {
    const startedAt = parseIsoInstant(input.startedAt, 'startedAt');
    const completedAt = parseIsoInstant(input.completedAt, 'completedAt');
    if (Date.parse(completedAt) < Date.parse(startedAt)) {
      throw new AflTradeWorkbookPersistenceError(
        'INVALID_REQUEST',
        'completedAt cannot precede startedAt.'
      );
    }
    if (
      input.environment !== 'test_fixture' &&
      this.rawArtifactRepository.assurance !== 'durable_object_storage'
    ) {
      throw new AflTradeWorkbookPersistenceError(
        'INVALID_REQUEST',
        'Non-fixture workbook import requires durable object-storage custody.'
      );
    }
    const stored = await this.rawArtifactRepository.loadExact(
      input.sourceArtifact,
      MAX_WORKBOOK_BYTES
    );
    if (!stored) {
      throw new AflTradeWorkbookPersistenceError(
        'ARTIFACT_UNAVAILABLE',
        'The exact governed workbook artifact is unavailable from raw custody.'
      );
    }
    const staging = await parseAflTradeWorkbookForStaging({
      bytes: stored.bytes,
      sourceArtifact: stored.reference,
      originalFilename: input.originalFilename,
    });
    const importRunId = createAflTradeContentAddress('workbook-import-run', {
      captureId: input.captureId,
      stagingPackageId: staging.stagingPackageId,
      parserVersion: AFL_TRADE_WORKBOOK_PARSER_VERSION,
      startedAt,
      completedAt,
    });
    const status =
      staging.counts.blockingIssues > 0 ? ('rejected' as const) : ('needs_review' as const);
    const manifest = createRunManifest({ request: input, package: staging, importRunId });

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `outcome-workbook-import:${input.captureId}:${AFL_TRADE_WORKBOOK_PARSER_VERSION}`,
      ]);
      await requireExactCapture(transaction, input, staging);
      const existing = await verifyExistingRun({
        transaction,
        request: input,
        staging,
        importRunId,
        status,
        manifest,
      });
      if (existing) return existing;

      await transaction.query(
        `INSERT INTO outcome_import_run
          (import_run_id, capture_id, import_kind, parser_version, started_at, completed_at,
           status, manifest_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          importRunId,
          input.captureId,
          IMPORT_KIND,
          staging.parserVersion,
          startedAt,
          completedAt,
          status,
          manifest,
        ]
      );
      await insertRows({ transaction, importRunId, staging, recordedAt: completedAt });
      await insertPartitions({ transaction, importRunId, staging });
      await insertIssues({
        transaction,
        importRunId,
        captureId: input.captureId,
        staging,
        detectedAt: completedAt,
      });
      return {
        importRunId,
        stagingPackageId: staging.stagingPackageId,
        captureId: input.captureId,
        rowCount: staging.rows.length,
        partitionCount: staging.partitions.length,
        issueCount: staging.issues.length,
        status,
        idempotentReplay: false,
      };
    });
  }
}
