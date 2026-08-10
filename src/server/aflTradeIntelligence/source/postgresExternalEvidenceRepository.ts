import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import type { AflOutcomeSqlClient } from '../outcomes/postgresOutcomeReleaseRepository';
import {
  parseAflTradeExternalEvidenceBatch,
  type AflTradeExternalEvidenceBatch,
} from './externalDraftTradeEvidenceContracts';

export interface AflTradeExternalStagingIssue {
  code: string;
  sourceKey: string;
  detail: string;
}

export interface PersistAflTradeExternalEvidenceInput {
  batch: AflTradeExternalEvidenceBatch;
  issues: readonly AflTradeExternalStagingIssue[];
}

export interface PersistedAflTradeExternalEvidence {
  batchId: string;
  idempotentReplay: boolean;
}

export class AflTradeExternalEvidencePersistenceError extends Error {
  constructor(
    readonly code: 'INVALID_PACKAGE' | 'CAPTURE_MISMATCH' | 'BATCH_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalEvidencePersistenceError';
  }
}

interface StoredIssue {
  issueId: string;
  ordinal: number;
  code: string;
  sourceKey: string;
  detail: string;
}

function parseIssues(issues: readonly AflTradeExternalStagingIssue[]): StoredIssue[] {
  if (issues.length > 100_000) {
    throw new AflTradeExternalEvidencePersistenceError(
      'INVALID_PACKAGE',
      'External evidence issue count exceeds the bounded maximum.'
    );
  }
  return issues.map((issue, index) => {
    const code = issue.code.trim();
    const sourceKey = issue.sourceKey.trim();
    const detail = issue.detail.trim();
    if (
      !/^[a-z][a-z0-9_]*$/.test(code) ||
      sourceKey.length === 0 ||
      sourceKey.length > 500 ||
      detail.length === 0 ||
      detail.length > 4_000
    ) {
      throw new AflTradeExternalEvidencePersistenceError(
        'INVALID_PACKAGE',
        'External evidence issues require a bounded code, source key and detail.'
      );
    }
    const content = { ordinal: index + 1, code, sourceKey, detail };
    return {
      issueId: createAflTradeContentAddress('external-evidence-issue', content),
      ...content,
    };
  });
}

export class PostgresAflTradeExternalEvidenceRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persist(
    input: PersistAflTradeExternalEvidenceInput
  ): Promise<PersistedAflTradeExternalEvidence> {
    let batch: AflTradeExternalEvidenceBatch;
    try {
      batch = parseAflTradeExternalEvidenceBatch(input.batch);
    } catch {
      throw new AflTradeExternalEvidencePersistenceError(
        'INVALID_PACKAGE',
        'External evidence batch failed its content-addressed contract.'
      );
    }
    const issues = parseIssues(input.issues);
    const issueSetSha256 = sha256AflTradeCanonicalJson(
      issues.map(({ issueId, ordinal, code, sourceKey }) => ({ issueId, ordinal, code, sourceKey }))
    );
    const batchJson = canonicalizeAflTradeJson(batch);
    const rowJson = canonicalizeAflTradeJson(
      batch.content.evidence.map((evidence) => ({
        evidence_id: evidence.evidenceId,
        ordinal: evidence.content.sourceRow.ordinal,
        source_key: evidence.content.sourceRow.sourceKey,
        claim_kind: evidence.content.claim.kind,
        evidence_json: evidence,
      }))
    );
    const issueJson = canonicalizeAflTradeJson(
      issues.map((issue) => ({
        issue_id: issue.issueId,
        ordinal: issue.ordinal,
        code: issue.code,
        source_key: issue.sourceKey,
        detail: issue.detail,
        issue_json: issue,
      }))
    );

    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-external-evidence:${batch.content.captureId}`,
      ]);
      const capture = await transaction.query<{ provider: string }>(
        `SELECT provider FROM outcome_source_capture WHERE capture_id=$1 FOR SHARE`,
        [batch.content.captureId]
      );
      if (capture.rows.length !== 1 || capture.rows[0]?.provider !== batch.content.provider) {
        throw new AflTradeExternalEvidencePersistenceError(
          'CAPTURE_MISMATCH',
          'External evidence provider does not match its exact persisted source capture.'
        );
      }

      const exactReplay = await transaction.query<{ batch_id: string }>(
        `SELECT batch_id FROM outcome_external_evidence_batch
          WHERE batch_id=$1 AND capture_id=$2 AND provider=$3 AND evidence_count=$4
            AND issue_count=$5 AND row_set_sha256=$6 AND issue_set_sha256=$7
            AND status='finalized' AND finalized_at=$8 AND batch_json=$9::jsonb
          FOR SHARE`,
        [
          batch.batchId,
          batch.content.captureId,
          batch.content.provider,
          batch.content.rowCount,
          issues.length,
          batch.content.rowSetSha256,
          issueSetSha256,
          batch.content.finalizedAt,
          batchJson,
        ]
      );
      if (exactReplay.rows.length === 1) {
        return { batchId: batch.batchId, idempotentReplay: true };
      }
      const conflict = await transaction.query<{ batch_id: string }>(
        `SELECT batch_id FROM outcome_external_evidence_batch WHERE capture_id=$1 FOR SHARE`,
        [batch.content.captureId]
      );
      if (conflict.rows.length !== 0) {
        throw new AflTradeExternalEvidencePersistenceError(
          'BATCH_CONFLICT',
          'Source capture already has a different external evidence batch.'
        );
      }

      await transaction.query(
        `INSERT INTO outcome_external_evidence_batch
          (batch_id,capture_id,provider,evidence_count,issue_count,row_set_sha256,
           issue_set_sha256,status,finalized_at,batch_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',NULL,$8::jsonb)`,
        [
          batch.batchId,
          batch.content.captureId,
          batch.content.provider,
          batch.content.rowCount,
          issues.length,
          batch.content.rowSetSha256,
          issueSetSha256,
          batchJson,
        ]
      );
      await transaction.query(
        `INSERT INTO outcome_external_evidence_row
          (evidence_id,batch_id,ordinal,source_key,claim_kind,evidence_json)
         SELECT item.evidence_id,$1,item.ordinal,item.source_key,item.claim_kind,item.evidence_json
           FROM jsonb_to_recordset($2::jsonb) AS item(
             evidence_id TEXT, ordinal INTEGER, source_key TEXT, claim_kind TEXT, evidence_json JSONB
           )`,
        [batch.batchId, rowJson]
      );
      if (issues.length > 0) {
        await transaction.query(
          `INSERT INTO outcome_external_evidence_issue
            (issue_id,batch_id,ordinal,code,source_key,detail,issue_json)
           SELECT item.issue_id,$1,item.ordinal,item.code,item.source_key,item.detail,item.issue_json
             FROM jsonb_to_recordset($2::jsonb) AS item(
               issue_id TEXT, ordinal INTEGER, code TEXT, source_key TEXT, detail TEXT, issue_json JSONB
             )`,
          [batch.batchId, issueJson]
        );
      }
      const finalized = await transaction.query(
        `UPDATE outcome_external_evidence_batch
            SET status='finalized', finalized_at=$2
          WHERE batch_id=$1 AND status='open'`,
        [batch.batchId, batch.content.finalizedAt]
      );
      if (finalized.rowCount !== 1) {
        throw new AflTradeExternalEvidencePersistenceError(
          'BATCH_CONFLICT',
          'External evidence batch did not finalize exactly once.'
        );
      }
      return { batchId: batch.batchId, idempotentReplay: false };
    });
  }
}
