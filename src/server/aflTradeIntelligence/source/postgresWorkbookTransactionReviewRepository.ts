import { canonicalizeAflTradeJson, sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  assessAflTradeWorkbookTransactionReviewSet,
  createAflTradeWorkbookTransactionReviewDecision,
  parseAflTradeWorkbookTransactionReviewDecision,
  type AflTradeWorkbookTransactionReviewAssessment,
  type AflTradeWorkbookTransactionReviewDecision,
} from './workbookTransactionReviewDecision';
import {
  parseAflTradeWorkbookTransactionReviewSet,
  type AflTradeWorkbookTransactionReviewSet,
} from './workbookTransactionReviewSet';

export class AflTradeWorkbookTransactionReviewPersistenceError extends Error {
  constructor(
    readonly code:
      'INVALID_INPUT' | 'IMPORT_MISMATCH' | 'IMMUTABLE_CONFLICT' | 'NOT_FOUND' | 'STALE_DECISION',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeWorkbookTransactionReviewPersistenceError';
  }
}

export type RecordAflTradeWorkbookTransactionReviewDecisionInput = Readonly<{
  reviewSetId: string;
  reviewSubjectId: string;
  expectedCurrentDecisionId: string | null;
  reviewerId: string;
  rationale: string;
}> &
  (
    | Readonly<{
        outcome: 'approved';
        canonicalClubIds: readonly string[];
        transferDirection: 'listed_club_received_assets';
      }>
    | Readonly<{
        outcome: 'rejected';
        canonicalClubIds?: never;
        transferDirection?: never;
      }>
  );

interface ImportRunRow extends Record<string, unknown> {
  import_kind: string;
  status: string;
  manifest_json: unknown;
  provider: string;
  dataset: string;
  access_mechanism: string;
  capture_status: string;
  artifact_id: string;
  content_sha256: string;
  media_type: string;
  byte_length: number | string;
}

interface ImportRow extends Record<string, unknown> {
  source_locator: string;
  source_ordinal: number | string;
  record_kind: string;
  row_sha256: string;
  parse_status: string;
  raw_payload: unknown;
}

interface ReviewSetRow extends Record<string, unknown> {
  import_run_id: string;
  staging_package_id: string;
  transaction_count: number | string;
  transaction_set_sha256: string;
  review_set_json: unknown;
}

interface HeadRow extends Record<string, unknown> {
  review_subject_id: string;
  revision: number | string;
  decision_id: string;
  outcome: string;
  updated_at: Date | string;
  decision_json: unknown;
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function instant(value: Date | string): string {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (new Date(normalized).toISOString() !== normalized) {
    throw new AflTradeWorkbookTransactionReviewPersistenceError(
      'IMMUTABLE_CONFLICT',
      'PostgreSQL returned a non-canonical review instant.'
    );
  }
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function observableImportedCell(value: unknown): string {
  const cell = asRecord(value);
  if (!cell || cell.kind === 'blank') return '';
  if (cell.kind === 'text') return typeof cell.value === 'string' ? cell.value.trim() : '';
  if (cell.kind === 'number') {
    return typeof cell.lexicalValue === 'string' ? cell.lexicalValue.trim() : '';
  }
  if (cell.kind === 'date') return typeof cell.isoValue === 'string' ? cell.isoValue : '';
  return cell.value === undefined || cell.value === null ? '' : String(cell.value);
}

async function requireExactImport(
  transaction: AflOutcomeSqlTransaction,
  importRunId: string,
  reviewSet: AflTradeWorkbookTransactionReviewSet
): Promise<void> {
  const run = await transaction.query<ImportRunRow>(
    `SELECT run.import_kind,run.status,run.manifest_json,
            capture.provider,capture.dataset,capture.access_mechanism,
            capture.status AS capture_status,
            artifact.artifact_id,artifact.content_sha256,artifact.media_type,artifact.byte_length
       FROM outcome_import_run run
       JOIN outcome_source_capture capture ON capture.capture_id=run.capture_id
       JOIN outcome_artifact_custody artifact ON artifact.artifact_id=capture.source_artifact_id
      WHERE run.import_run_id=$1
      FOR SHARE OF run,capture,artifact`,
    [importRunId]
  );
  const row = run.rows[0];
  const manifest = asRecord(row?.manifest_json);
  const manifestArtifact = asRecord(manifest?.sourceArtifact);
  const manifestCounts = asRecord(manifest?.counts);
  if (
    run.rows.length !== 1 ||
    !row ||
    row.import_kind !== 'workbook_full_archive' ||
    row.status !== 'needs_review' ||
    row.provider !== 'statly-curated-workbook' ||
    row.dataset !== 'afl-drafts-trades' ||
    row.access_mechanism !== 'reviewed_workbook_upload' ||
    row.capture_status !== 'approved' ||
    row.artifact_id !== reviewSet.content.sourceArtifactId ||
    row.content_sha256 !== reviewSet.content.sourceArtifactSha256 ||
    manifest?.stagingPackageId !== reviewSet.content.stagingPackageId ||
    manifest?.rawEvidenceSha256 !== reviewSet.content.rawEvidenceSha256 ||
    manifest?.publicationEligible !== false ||
    manifestArtifact?.artifactId !== row.artifact_id ||
    manifestArtifact?.contentSha256 !== row.content_sha256 ||
    manifestArtifact?.mediaType !== row.media_type ||
    Number(manifestArtifact?.byteLength) !== Number(row.byte_length) ||
    Number(manifestCounts?.tradeTransactions) !== reviewSet.content.transactionCount ||
    Number(manifestCounts?.tradeParties) !==
      reviewSet.content.transactions.reduce((sum, subject) => sum + subject.parties.length, 0)
  ) {
    throw new AflTradeWorkbookTransactionReviewPersistenceError(
      'IMPORT_MISMATCH',
      'Workbook transaction review set does not match one exact retained private import.'
    );
  }

  const imported = await transaction.query<ImportRow>(
    `SELECT source_locator,source_ordinal,record_kind,row_sha256,parse_status,raw_payload
       FROM outcome_import_row
      WHERE import_run_id=$1 AND record_kind IN ('trade_transaction','trade_party')
      ORDER BY source_ordinal
      FOR SHARE`,
    [importRunId]
  );
  const expectedRows = reviewSet.content.transactions.flatMap((subject) => [
    {
      stagingRowId: subject.transactionRowId,
      sourceLocator: subject.sourceLocator,
      sourceOrdinal: subject.sourceOrdinal,
      recordKind: 'trade_transaction',
      rowSha256: subject.transactionRowSha256,
      sourceGroupId: subject.sourceGroupId,
      seasonYear: subject.seasonYear,
      observableCells: [subject.sourceTitle],
    },
    ...subject.parties.map((party) => ({
      stagingRowId: party.stagingRowId,
      sourceLocator: party.sourceLocator,
      sourceOrdinal: party.sourceOrdinal,
      recordKind: 'trade_party',
      rowSha256: party.rowSha256,
      sourceGroupId: subject.sourceGroupId,
      seasonYear: subject.seasonYear,
      observableCells: [party.clubLabel, party.assetText],
    })),
  ]);
  if (imported.rows.length !== expectedRows.length) {
    throw new AflTradeWorkbookTransactionReviewPersistenceError(
      'IMPORT_MISMATCH',
      'Workbook transaction review set does not cover every exact retained trade row.'
    );
  }
  const expectedById = new Map(expectedRows.map((expected) => [expected.stagingRowId, expected]));
  for (const importedRow of imported.rows) {
    const payload = asRecord(importedRow.raw_payload);
    const authenticatedPayload = asRecord(payload?.authenticatedPayload);
    const cells = Array.isArray(authenticatedPayload?.cells) ? authenticatedPayload.cells : [];
    const expected = expectedById.get(String(payload?.stagingRowId ?? ''));
    if (
      !expected ||
      payload?.stagingPackageId !== reviewSet.content.stagingPackageId ||
      payload?.rawEvidenceSha256 !== reviewSet.content.rawEvidenceSha256 ||
      payload?.rowSha256 !== importedRow.row_sha256 ||
      !authenticatedPayload ||
      sha256AflTradeCanonicalJson(authenticatedPayload) !== importedRow.row_sha256 ||
      authenticatedPayload.sourceLocator !== importedRow.source_locator ||
      Number(authenticatedPayload.sourceOrdinal) !== Number(importedRow.source_ordinal) ||
      authenticatedPayload.recordKind !== importedRow.record_kind ||
      authenticatedPayload.sourceGroupId !== expected.sourceGroupId ||
      Number(authenticatedPayload.seasonYear) !== expected.seasonYear ||
      authenticatedPayload.parseStatus !== importedRow.parse_status ||
      importedRow.parse_status !== 'staged' ||
      importedRow.source_locator !== expected.sourceLocator ||
      Number(importedRow.source_ordinal) !== expected.sourceOrdinal ||
      importedRow.record_kind !== expected.recordKind ||
      importedRow.row_sha256 !== expected.rowSha256 ||
      expected.observableCells.some(
        (cell, index) => observableImportedCell(cells[index]) !== cell
      )
    ) {
      throw new AflTradeWorkbookTransactionReviewPersistenceError(
        'IMPORT_MISMATCH',
        'Workbook transaction review subject differs from its exact retained import row.'
      );
    }
    expectedById.delete(expected.stagingRowId);
  }
  if (expectedById.size !== 0) {
    throw new AflTradeWorkbookTransactionReviewPersistenceError(
      'IMPORT_MISMATCH',
      'Workbook transaction review set omits retained trade rows.'
    );
  }
}

async function loadReviewSetFrom(
  client: Pick<AflOutcomeSqlClient, 'query'>,
  reviewSetId: string,
  lock = false
): Promise<AflTradeWorkbookTransactionReviewSet | null> {
  const result = await client.query<ReviewSetRow>(
    `SELECT import_run_id,staging_package_id,transaction_count,transaction_set_sha256,
            review_set_json
       FROM outcome_workbook_transaction_review_set
      WHERE review_set_id=$1${lock ? ' FOR SHARE' : ''}`,
    [reviewSetId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) {
    throw new AflTradeWorkbookTransactionReviewPersistenceError(
      'IMMUTABLE_CONFLICT',
      'Workbook transaction review set has conflicting retained rows.'
    );
  }
  const reviewSet = parseAflTradeWorkbookTransactionReviewSet(row.review_set_json);
  if (
    reviewSet.reviewSetId !== reviewSetId ||
    reviewSet.content.stagingPackageId !== row.staging_package_id ||
    reviewSet.content.transactionCount !== Number(row.transaction_count) ||
    reviewSet.content.transactionSetSha256 !== row.transaction_set_sha256
  ) {
    throw new AflTradeWorkbookTransactionReviewPersistenceError(
      'IMMUTABLE_CONFLICT',
      'Workbook transaction review columns differ from their exact retained content.'
    );
  }
  const subjects = await client.query<{ review_subject_id: string; subject_json: unknown }>(
    `SELECT review_subject_id,subject_json
       FROM outcome_workbook_transaction_review_subject
      WHERE review_set_id=$1 ORDER BY source_ordinal${lock ? ' FOR SHARE' : ''}`,
    [reviewSetId]
  );
  if (
    subjects.rows.length !== reviewSet.content.transactions.length ||
    subjects.rows.some(
      (subject, index) =>
        subject.review_subject_id !== reviewSet.content.transactions[index]?.reviewSubjectId ||
        !exactJson(subject.subject_json, reviewSet.content.transactions[index])
    )
  ) {
    throw new AflTradeWorkbookTransactionReviewPersistenceError(
      'IMMUTABLE_CONFLICT',
      'Workbook transaction review subjects are incomplete or differ from the retained set.'
    );
  }
  return reviewSet;
}

export class PostgresAflTradeWorkbookTransactionReviewRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async registerReviewSet(input: {
    importRunId: string;
    reviewSet: unknown;
  }): Promise<AflTradeWorkbookTransactionReviewSet> {
    let reviewSet: AflTradeWorkbookTransactionReviewSet;
    try {
      reviewSet = parseAflTradeWorkbookTransactionReviewSet(input.reviewSet);
    } catch (error) {
      throw new AflTradeWorkbookTransactionReviewPersistenceError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Workbook transaction review set is invalid.'
      );
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-workbook-transaction-review-set:${reviewSet.reviewSetId}`,
      ]);
      await requireExactImport(transaction, input.importRunId, reviewSet);
      await transaction.query(
        `INSERT INTO outcome_workbook_transaction_review_set
          (review_set_id,import_run_id,staging_package_id,source_artifact_id,
           source_artifact_sha256,raw_evidence_sha256,transaction_count,
           transaction_set_sha256,transaction_set_canonical_json,review_set_content_sha256,
           review_set_content_canonical_json,review_set_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         ON CONFLICT (review_set_id) DO NOTHING`,
        [
          reviewSet.reviewSetId,
          input.importRunId,
          reviewSet.content.stagingPackageId,
          reviewSet.content.sourceArtifactId,
          reviewSet.content.sourceArtifactSha256,
          reviewSet.content.rawEvidenceSha256,
          reviewSet.content.transactionCount,
          reviewSet.content.transactionSetSha256,
          canonicalizeAflTradeJson(reviewSet.content.transactions),
          reviewSet.reviewSetId.split(':')[1],
          canonicalizeAflTradeJson(reviewSet.content),
          canonicalizeAflTradeJson(reviewSet),
        ]
      );
      for (const subject of reviewSet.content.transactions) {
        const addressContent = {
          stagingPackageId: reviewSet.content.stagingPackageId,
          sourceGroupId: subject.sourceGroupId,
          transactionRowId: subject.transactionRowId,
          transactionRowSha256: subject.transactionRowSha256,
          partySetSha256: subject.partySetSha256,
        };
        await transaction.query(
          `INSERT INTO outcome_workbook_transaction_review_subject
            (review_set_id,review_subject_id,source_ordinal,season_year,
             subject_address_sha256,subject_address_canonical_json,
             subject_sha256,party_set_canonical_json,subject_canonical_json,subject_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           ON CONFLICT (review_set_id,review_subject_id) DO NOTHING`,
          [
            reviewSet.reviewSetId,
            subject.reviewSubjectId,
            subject.sourceOrdinal,
            subject.seasonYear,
            subject.reviewSubjectId.split(':')[1],
            canonicalizeAflTradeJson(addressContent),
            sha256AflTradeCanonicalJson(subject),
            canonicalizeAflTradeJson(subject.parties),
            canonicalizeAflTradeJson(subject),
            canonicalizeAflTradeJson(subject),
          ]
        );
      }
      const retained = await loadReviewSetFrom(transaction, reviewSet.reviewSetId, true);
      if (!retained || !exactJson(retained, reviewSet)) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'IMMUTABLE_CONFLICT',
          'Retained workbook transaction review set conflicts with exact registration.'
        );
      }
      return retained;
    });
  }

  async loadReviewSet(reviewSetId: string): Promise<AflTradeWorkbookTransactionReviewSet | null> {
    return loadReviewSetFrom(this.client, reviewSetId);
  }

  async recordDecision(
    input: RecordAflTradeWorkbookTransactionReviewDecisionInput
  ): Promise<AflTradeWorkbookTransactionReviewDecision> {
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-workbook-transaction-review:${input.reviewSetId}:${input.reviewSubjectId}`,
      ]);
      const reviewSet = await loadReviewSetFrom(transaction, input.reviewSetId, true);
      if (!reviewSet) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'NOT_FOUND',
          'Workbook transaction review set is unavailable.'
        );
      }
      if (
        !reviewSet.content.transactions.some(
          ({ reviewSubjectId }) => reviewSubjectId === input.reviewSubjectId
        )
      ) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'NOT_FOUND',
          'Workbook transaction review subject is unavailable.'
        );
      }
      const headResult = await transaction.query<HeadRow>(
        `SELECT head.review_subject_id,head.revision,head.decision_id,head.outcome,
                head.updated_at,decision.decision_json
           FROM outcome_workbook_transaction_review_head head
           JOIN outcome_workbook_transaction_review_decision decision
             ON decision.decision_id=head.decision_id
          WHERE head.review_set_id=$1 AND head.review_subject_id=$2
          FOR UPDATE OF head`,
        [input.reviewSetId, input.reviewSubjectId]
      );
      if (headResult.rows.length > 1) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'IMMUTABLE_CONFLICT',
          'Workbook transaction review has more than one current head.'
        );
      }
      const head = headResult.rows[0] ?? null;
      if ((head?.decision_id ?? null) !== input.expectedCurrentDecisionId) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'STALE_DECISION',
          'Stale workbook transaction review decision; current head has changed.'
        );
      }
      const clock = await transaction.query<{ decided_at: Date | string }>(
        `SELECT clock_timestamp() AS decided_at`
      );
      const decidedAt = instant(clock.rows[0]!.decided_at);
      const base = {
        reviewSet,
        reviewSubjectId: input.reviewSubjectId,
        revision: head ? Number(head.revision) + 1 : 1,
        supersedesDecisionId: head?.decision_id ?? null,
        reviewerId: input.reviewerId,
        rationale: input.rationale,
        decidedAt,
      };
      let decision: AflTradeWorkbookTransactionReviewDecision;
      try {
        decision =
          input.outcome === 'approved'
            ? createAflTradeWorkbookTransactionReviewDecision({
                ...base,
                outcome: 'approved',
                canonicalClubIds: input.canonicalClubIds,
                transferDirection: input.transferDirection,
              })
            : createAflTradeWorkbookTransactionReviewDecision({ ...base, outcome: 'rejected' });
      } catch (error) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Workbook review decision is invalid.'
        );
      }
      await transaction.query(
        `INSERT INTO outcome_workbook_transaction_review_decision
          (decision_id,review_set_id,review_subject_id,revision,supersedes_decision_id,outcome,
           reviewer_id,decided_at,decision_sha256,decision_content_canonical_json,decision_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
        [
          decision.decisionId,
          input.reviewSetId,
          input.reviewSubjectId,
          decision.content.revision,
          decision.content.supersedesDecisionId,
          decision.content.outcome,
          decision.content.reviewerId,
          decision.content.decidedAt,
          decision.decisionId.split(':')[1],
          canonicalizeAflTradeJson(decision.content),
          canonicalizeAflTradeJson(decision),
        ]
      );
      const written = head
        ? await transaction.query(
            `UPDATE outcome_workbook_transaction_review_head
                SET revision=$3,decision_id=$4,outcome=$5,updated_at=$6
              WHERE review_set_id=$1 AND review_subject_id=$2
                AND revision=$7 AND decision_id=$8`,
            [
              input.reviewSetId,
              input.reviewSubjectId,
              decision.content.revision,
              decision.decisionId,
              decision.content.outcome,
              decision.content.decidedAt,
              head.revision,
              head.decision_id,
            ]
          )
        : await transaction.query(
            `INSERT INTO outcome_workbook_transaction_review_head
              (review_set_id,review_subject_id,revision,decision_id,outcome,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              input.reviewSetId,
              input.reviewSubjectId,
              decision.content.revision,
              decision.decisionId,
              decision.content.outcome,
              decision.content.decidedAt,
            ]
          );
      if (written.rowCount !== 1) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'STALE_DECISION',
          'Stale workbook transaction review decision failed compare-and-swap.'
        );
      }
      return decision;
    });
  }

  async loadCurrentDecisions(
    reviewSetId: string
  ): Promise<readonly AflTradeWorkbookTransactionReviewDecision[]> {
    const reviewSet = await this.loadReviewSet(reviewSetId);
    if (!reviewSet) return [];
    const result = await this.client.query<HeadRow>(
      `SELECT head.review_subject_id,head.revision,head.decision_id,head.outcome,
              head.updated_at,decision.decision_json
         FROM outcome_workbook_transaction_review_head head
         JOIN outcome_workbook_transaction_review_decision decision
           ON decision.decision_id=head.decision_id
         JOIN outcome_workbook_transaction_review_subject subject
           ON subject.review_set_id=head.review_set_id
          AND subject.review_subject_id=head.review_subject_id
        WHERE head.review_set_id=$1 ORDER BY subject.source_ordinal
        FOR SHARE OF head,decision,subject`,
      [reviewSetId]
    );
    return result.rows.map((row) => {
      const decision = parseAflTradeWorkbookTransactionReviewDecision(row.decision_json);
      if (
        decision.content.reviewSetId !== reviewSetId ||
        decision.content.reviewSubjectId !== row.review_subject_id ||
        decision.content.revision !== Number(row.revision) ||
        decision.decisionId !== row.decision_id ||
        decision.content.outcome !== row.outcome ||
        decision.content.decidedAt !== instant(row.updated_at)
      ) {
        throw new AflTradeWorkbookTransactionReviewPersistenceError(
          'IMMUTABLE_CONFLICT',
          'Workbook transaction review head differs from its exact decision.'
        );
      }
      return decision;
    });
  }

  async assess(reviewSetId: string): Promise<AflTradeWorkbookTransactionReviewAssessment | null> {
    const reviewSet = await this.loadReviewSet(reviewSetId);
    if (!reviewSet) return null;
    return assessAflTradeWorkbookTransactionReviewSet({
      reviewSet,
      currentDecisions: await this.loadCurrentDecisions(reviewSetId),
    });
  }
}
