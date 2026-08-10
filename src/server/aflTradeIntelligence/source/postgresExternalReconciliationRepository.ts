import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  parseAflTradeExternalIdentityResolution,
  type AflTradeExternalIdentityResolution,
} from './externalEvidenceReconciliation';
import {
  parseAflTradeExternalReconciliationCandidate,
  type AflTradeExternalReconciliationCandidateRecord,
} from './externalReconciliationCandidateContracts';

export interface PersistAflTradeExternalReconciliationInput {
  candidate: unknown;
  identityResolutions: readonly unknown[];
}

export interface PersistedAflTradeExternalReconciliation {
  candidateId: string;
  status: 'finalized';
  blockingIssueCount: number;
  idempotentReplay: boolean;
}

export class AflTradeExternalReconciliationPersistenceError extends Error {
  constructor(
    readonly code:
      | 'INVALID_CANDIDATE'
      | 'SOURCE_BATCH_UNAVAILABLE'
      | 'IDENTITY_EVIDENCE_MISMATCH'
      | 'IMMUTABLE_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalReconciliationPersistenceError';
  }
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
  } catch {
    return false;
  }
}

function parseInput(input: PersistAflTradeExternalReconciliationInput): {
  candidate: AflTradeExternalReconciliationCandidateRecord;
  identityResolutions: AflTradeExternalIdentityResolution[];
} {
  try {
    const candidate = parseAflTradeExternalReconciliationCandidate(input.candidate);
    const identityResolutions = input.identityResolutions
      .map(parseAflTradeExternalIdentityResolution)
      .sort((left, right) => left.resolutionId.localeCompare(right.resolutionId));
    const suppliedIds = identityResolutions.map(({ resolutionId }) => resolutionId);
    if (
      new Set(suppliedIds).size !== suppliedIds.length ||
      !exactJson(suppliedIds, candidate.content.identityResolutionIds)
    ) {
      throw new AflTradeExternalReconciliationPersistenceError(
        'IDENTITY_EVIDENCE_MISMATCH',
        'Candidate identity-resolution membership does not match the supplied reviewed evidence.'
      );
    }
    return { candidate, identityResolutions };
  } catch (error) {
    if (error instanceof AflTradeExternalReconciliationPersistenceError) throw error;
    throw new AflTradeExternalReconciliationPersistenceError(
      'INVALID_CANDIDATE',
      error instanceof Error ? error.message : 'External reconciliation candidate is invalid.'
    );
  }
}

async function requireFinalizedSourceBatches(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeExternalReconciliationCandidateRecord
): Promise<void> {
  const allowedSeasonYears = new Set([
    ...candidate.content.transactions.map(({ seasonYear }) => seasonYear),
    ...candidate.content.transfers.flatMap(({ asset }) =>
      asset.kind === 'pick_entitlement' ? [asset.draftYear] : []
    ),
    ...candidate.content.draftSelections.map(({ draftYear }) => draftYear),
    ...candidate.content.pickCustody.map(({ draftYear }) => draftYear),
  ]);
  for (const batchId of candidate.content.sourceBatchIds) {
    const source = await transaction.query<{
      status: string;
      finalized_at: string | Date | null;
      environment: string;
      competition: string;
      anchor_season_year: number;
      issue_count: number | string;
    }>(
      `SELECT batch.status,batch.finalized_at,capture.environment,capture.competition,
              capture.anchor_season_year,batch.issue_count
         FROM outcome_external_evidence_batch batch
         JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
        WHERE batch.batch_id=$1
        FOR SHARE`,
      [batchId]
    );
    if (
      source.rows.length !== 1 ||
      source.rows[0]?.status !== 'finalized' ||
      source.rows[0].finalized_at === null ||
      Number(source.rows[0].issue_count) !== 0 ||
      source.rows[0].environment !== candidate.content.environment ||
      source.rows[0].competition !== candidate.content.competition ||
      !allowedSeasonYears.has(Number(source.rows[0].anchor_season_year))
    ) {
      throw new AflTradeExternalReconciliationPersistenceError(
        'SOURCE_BATCH_UNAVAILABLE',
        `Source evidence batch ${batchId} is absent, unfinalized, out of scope, or contains unresolved parser issues.`
      );
    }
  }
}

async function requireSourceEvidenceMembership(
  transaction: AflOutcomeSqlTransaction,
  candidate: AflTradeExternalReconciliationCandidateRecord
): Promise<void> {
  const records = [
    ...candidate.content.transactions,
    ...candidate.content.transfers,
    ...candidate.content.draftSelections,
    ...candidate.content.pickCustody,
    ...candidate.content.pickLineage,
    ...candidate.content.issues,
  ];
  const evidenceIds = [...new Set(records.flatMap(({ evidenceIds }) => evidenceIds))].sort();
  for (const evidenceId of evidenceIds) {
    const membership = await transaction.query(
      `SELECT evidence.evidence_id
         FROM outcome_external_evidence_row evidence
         JOIN outcome_external_reconciliation_source_batch source
           ON source.batch_id=evidence.batch_id
        WHERE source.candidate_id=$1 AND evidence.evidence_id=$2
        LIMIT 1`,
      [candidate.candidateId, evidenceId]
    );
    if (membership.rows.length !== 1) {
      throw new AflTradeExternalReconciliationPersistenceError(
        'SOURCE_BATCH_UNAVAILABLE',
        `Evidence ${evidenceId} is not a member of the candidate source batches.`
      );
    }
  }
  const unreferenced = await transaction.query(
    `SELECT evidence.evidence_id
       FROM outcome_external_evidence_row evidence
       JOIN outcome_external_reconciliation_source_batch source
         ON source.batch_id=evidence.batch_id
      WHERE source.candidate_id=$1
        AND NOT (evidence.evidence_id = ANY($2::text[]))
      LIMIT 1`,
    [candidate.candidateId, evidenceIds]
  );
  if (unreferenced.rows.length !== 0) {
    throw new AflTradeExternalReconciliationPersistenceError(
      'SOURCE_BATCH_UNAVAILABLE',
      'Every staged evidence row must be conserved by an exact reconciliation record or issue.'
    );
  }
}

async function insertJsonChild(
  transaction: AflOutcomeSqlTransaction,
  table: string,
  columns: readonly string[],
  parameters: readonly unknown[]
): Promise<void> {
  const placeholders = parameters.map((_, index) => `$${index + 1}`).join(',');
  await transaction.query(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`,
    parameters
  );
}

export class PostgresAflTradeExternalReconciliationRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persistCandidate(
    unparsedInput: PersistAflTradeExternalReconciliationInput
  ): Promise<PersistedAflTradeExternalReconciliation> {
    const { candidate, identityResolutions } = parseInput(unparsedInput);
    const content = candidate.content;
    const candidateJson = canonicalizeAflTradeJson(candidate);
    const sourceAuthority = content.sourceAuthority ?? null;

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-external-reconciliation:${candidate.candidateId}`,
      ]);

      const existing = await transaction.query<{
        status: string;
        finalized_at: string | Date | null;
        candidate_json: unknown;
      }>(
        `SELECT status,finalized_at,candidate_json
           FROM outcome_external_reconciliation_candidate
          WHERE candidate_id=$1
          FOR SHARE`,
        [candidate.candidateId]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (
          existing.rows.length !== 1 ||
          row?.status !== 'finalized' ||
          row.finalized_at === null ||
          !exactJson(row.candidate_json, candidate)
        ) {
          throw new AflTradeExternalReconciliationPersistenceError(
            'IMMUTABLE_CONFLICT',
            'Candidate identity is already bound to different or incomplete evidence.'
          );
        }
        return {
          candidateId: candidate.candidateId,
          status: 'finalized',
          blockingIssueCount: content.issues.length,
          idempotentReplay: true,
        };
      }

      await requireFinalizedSourceBatches(transaction, candidate);
      await transaction.query(
        `INSERT INTO outcome_external_reconciliation_candidate
          (candidate_id,source_authority_kind,historical_completion_id,
           environment,competition,anchor_season_year,reconciled_at,
           source_batch_count,identity_resolution_count,
           transaction_count,transfer_count,draft_selection_count,pick_custody_count,
           pick_lineage_count,issue_count,status,finalized_at,source_authority_json,
           candidate_canonical_json,candidate_json)
         VALUES ($1,$2,$3,$4::"OutcomeEnvironment",$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 'open',NULL,$16::jsonb,$17,$18::jsonb)`,
        [
          candidate.candidateId,
          sourceAuthority?.kind ?? null,
          sourceAuthority?.kind === 'historical_plan_completion'
            ? sourceAuthority.completionId
            : null,
          content.environment,
          content.competition,
          content.anchorSeasonYear,
          content.reconciledAt,
          content.sourceBatchIds.length,
          content.identityResolutionIds.length,
          content.transactions.length,
          content.transfers.length,
          content.draftSelections.length,
          content.pickCustody.length,
          content.pickLineage.length,
          content.issues.length,
          sourceAuthority === null ? null : canonicalizeAflTradeJson(sourceAuthority),
          sourceAuthority === null ? null : canonicalizeAflTradeJson(content),
          candidateJson,
        ]
      );

      for (const [index, batchId] of content.sourceBatchIds.entries()) {
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_source_batch',
          ['candidate_id', 'ordinal', 'batch_id'],
          [candidate.candidateId, index + 1, batchId]
        );
      }
      for (const [index, resolution] of identityResolutions.entries()) {
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_identity_resolution',
          [
            'candidate_id',
            'ordinal',
            'resolution_id',
            'review_decision_id',
            'provider',
            'entity_kind',
            'canonical_id',
            'resolution_json',
          ],
          [
            candidate.candidateId,
            index + 1,
            resolution.resolutionId,
            resolution.content.reviewDecisionId,
            resolution.content.provider,
            resolution.content.entityKind,
            resolution.content.canonicalId,
            canonicalizeAflTradeJson(resolution),
          ]
        );
      }
      for (const [index, record] of content.transactions.entries()) {
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_transaction',
          ['candidate_id', 'ordinal', 'transaction_id', 'status', 'transaction_json'],
          [
            candidate.candidateId,
            index + 1,
            record.transactionId,
            record.status,
            canonicalizeAflTradeJson(record),
          ]
        );
      }
      for (const [index, record] of content.transfers.entries()) {
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_transfer',
          [
            'candidate_id',
            'ordinal',
            'transfer_id',
            'transaction_id',
            'pick_id',
            'status',
            'transfer_json',
          ],
          [
            candidate.candidateId,
            index + 1,
            record.transferId,
            record.transactionId,
            record.asset.kind === 'pick_entitlement' ? record.asset.pickId : null,
            record.status,
            canonicalizeAflTradeJson(record),
          ]
        );
      }
      for (const [index, record] of content.draftSelections.entries()) {
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_draft_selection',
          [
            'candidate_id',
            'ordinal',
            'selection_id',
            'draft_year',
            'draft_type',
            'selection_number',
            'pick_id',
            'status',
            'selection_json',
          ],
          [
            candidate.candidateId,
            index + 1,
            record.selectionId,
            record.draftYear,
            record.draftType,
            record.selectionNumber,
            record.pickId,
            record.status,
            canonicalizeAflTradeJson(record),
          ]
        );
      }
      for (const [index, record] of content.pickCustody.entries()) {
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_pick_custody',
          ['candidate_id', 'ordinal', 'custody_id', 'pick_id', 'status', 'custody_json'],
          [
            candidate.candidateId,
            index + 1,
            record.custodyId,
            record.pickId,
            record.status,
            canonicalizeAflTradeJson(record),
          ]
        );
      }
      for (const [index, record] of content.pickLineage.entries()) {
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_pick_lineage',
          [
            'candidate_id',
            'ordinal',
            'lineage_id',
            'transfer_id',
            'selection_id',
            'pick_id',
            'status',
            'lineage_json',
          ],
          [
            candidate.candidateId,
            index + 1,
            record.lineageId,
            record.transferId,
            record.selectionId,
            record.pickId,
            record.status,
            canonicalizeAflTradeJson(record),
          ]
        );
      }
      for (const [index, issue] of content.issues.entries()) {
        const issueId = createAflTradeContentAddress('external-reconciliation-issue', {
          candidateId: candidate.candidateId,
          ...issue,
        });
        await insertJsonChild(
          transaction,
          'outcome_external_reconciliation_issue',
          ['candidate_id', 'ordinal', 'issue_id', 'code', 'subject_key', 'issue_json'],
          [
            candidate.candidateId,
            index + 1,
            issueId,
            issue.code,
            issue.subjectKey,
            canonicalizeAflTradeJson(issue),
          ]
        );
      }

      await requireSourceEvidenceMembership(transaction, candidate);

      const finalized = await transaction.query(
        `UPDATE outcome_external_reconciliation_candidate
            SET status='finalized',finalized_at=$2
          WHERE candidate_id=$1 AND status='open' AND finalized_at IS NULL`,
        [candidate.candidateId, content.reconciledAt]
      );
      if (finalized.rowCount !== 1) {
        throw new AflTradeExternalReconciliationPersistenceError(
          'IMMUTABLE_CONFLICT',
          'External reconciliation candidate could not be finalized exactly once.'
        );
      }
      return {
        candidateId: candidate.candidateId,
        status: 'finalized',
        blockingIssueCount: content.issues.length,
        idempotentReplay: false,
      };
    });
  }
}
