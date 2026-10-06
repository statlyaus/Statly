import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  compareSourceCaptureClaims,
  createSourceCaptureSuccessorRecord,
  describeSourceCaptureSuccessorDecision,
  SOURCE_CAPTURE_SUCCESSOR_REVIEWER,
  type SourceCaptureClaimComparison,
  type SourceCaptureSuccessorRecord,
} from '../source/sourceCaptureSuccessor';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from './postgresOutcomeReleaseRepository';

export type SourceCaptureSuccessorRequest =
  | { kind: 'recaptured'; lostArtifactId: string; successorCaptureId: string }
  | { kind: 'omitted'; lostArtifactId: string; ownerDecisionRef: string };

export type SourceCaptureSuccessorOutcome =
  | { status: 'refused'; comparison: SourceCaptureClaimComparison }
  | {
      status: 'would_record' | 'recorded' | 'already_recorded';
      successorId: string;
      comparison: SourceCaptureClaimComparison | null;
    };

interface CaptureRow {
  capture_id: string;
  source_artifact_id: string;
  batch_json: unknown | null;
}

/**
 * Records a successor for one lost source capture (migration 0252) under the delegated
 * capture-successor rule. A recaptured successor is recorded only when every claim of the lost
 * capture's evidence batch reappears verbatim in the fresh capture's batch; otherwise nothing is
 * written and the comparison is returned for the owner. An omitted successor is recorded only with
 * an owner decision reference. The 0252 guard enforces the rest (same source, later approved
 * capture, located bytes, exact content-addressed record, current approval). Dry run by default.
 */
export class PostgresSourceCaptureSuccessorRepository {
  constructor(private readonly database: AflOutcomeSqlClient) {}

  async register(
    request: SourceCaptureSuccessorRequest,
    options: { apply: boolean }
  ): Promise<SourceCaptureSuccessorOutcome> {
    return this.database.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `outcome-source-capture-successor:${request.lostArtifactId}`,
      ]);
      const lost = await this.loadCapture(
        transaction,
        'source_artifact_id',
        request.lostArtifactId
      );
      let comparison: SourceCaptureClaimComparison | null = null;
      let fresh: CaptureRow | null = null;
      if (request.kind === 'recaptured') {
        fresh = await this.loadCapture(transaction, 'capture_id', request.successorCaptureId);
        if (lost.batch_json === null || fresh.batch_json === null) {
          throw new Error('Both captures need a finalized evidence batch to compare claims.');
        }
        comparison = compareSourceCaptureClaims(lost.batch_json, fresh.batch_json);
        if (!comparison.matches) return { status: 'refused', comparison };
      }

      const existing = await transaction.query<{
        successor_id: string;
        kind: string;
        successor_capture_id: string | null;
      }>(
        `SELECT successor_id,kind,successor_capture_id FROM outcome_source_capture_successor
          WHERE lost_artifact_id=$1`,
        [request.lostArtifactId]
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        const same =
          prior.kind === request.kind &&
          prior.successor_capture_id === (fresh === null ? null : fresh.capture_id);
        if (!same) {
          throw new Error('A different successor is already recorded for this lost capture.');
        }
        return { status: 'already_recorded', successorId: prior.successor_id, comparison };
      }

      const created = await this.now(transaction);
      const successor = createSourceCaptureSuccessorRecord(
        fresh === null
          ? { kind: 'omitted', lostArtifactId: request.lostArtifactId, createdAt: created }
          : {
              kind: 'recaptured',
              lostArtifactId: request.lostArtifactId,
              successorCaptureId: fresh.capture_id,
              successorArtifactId: fresh.source_artifact_id,
              createdAt: created,
            }
      );
      if (!options.apply) {
        return { status: 'would_record', successorId: successor.successorId, comparison };
      }
      const rationale =
        request.kind === 'omitted'
          ? describeSourceCaptureSuccessorDecision({
              kind: 'omitted',
              ownerDecisionRef: request.ownerDecisionRef,
            })
          : describeSourceCaptureSuccessorDecision({ kind: 'recaptured', comparison: comparison! });
      await this.record(transaction, successor, rationale);
      return { status: 'recorded', successorId: successor.successorId, comparison };
    });
  }

  private async loadCapture(
    transaction: AflOutcomeSqlTransaction,
    column: 'source_artifact_id' | 'capture_id',
    value: string
  ): Promise<CaptureRow> {
    const result = await transaction.query<CaptureRow>(
      `SELECT capture.capture_id,capture.source_artifact_id,batch.batch_json
         FROM outcome_source_capture capture
         LEFT JOIN outcome_external_evidence_batch batch
           ON batch.capture_id=capture.capture_id AND batch.status='finalized'
        WHERE capture.${column}=$1 AND capture.status='approved'`,
      [value]
    );
    if (result.rows.length !== 1) {
      throw new Error(`No single approved source capture has ${column} ${value}.`);
    }
    return result.rows[0]!;
  }

  private async now(transaction: AflOutcomeSqlTransaction): Promise<string> {
    const result = await transaction.query<{ at: string }>(
      `SELECT to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`
    );
    return result.rows[0]!.at;
  }

  /** The decision, then the successor: decided no earlier than created, recorded after decided. */
  private async record(
    transaction: AflOutcomeSqlTransaction,
    successor: SourceCaptureSuccessorRecord,
    rationale: string
  ): Promise<void> {
    const decisionId = `${successor.successorId}:approval`;
    const recordJson = canonicalizeAflTradeJson(successor.record);
    await transaction.query(
      `INSERT INTO outcome_review_decision
        (decision_id,subject_type,subject_id,decision,rationale,evidence_json,decided_by,decided_at)
       VALUES ($1,'source_capture_successor',$2,'approved',$3,$4::jsonb,$5,
         date_trunc('milliseconds',clock_timestamp()))`,
      [decisionId, successor.successorId, rationale, recordJson, SOURCE_CAPTURE_SUCCESSOR_REVIEWER]
    );
    await transaction.query(
      `INSERT INTO outcome_source_capture_successor
        (successor_id,lost_artifact_id,kind,successor_capture_id,successor_artifact_id,
         record_json,approval_decision_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        successor.successorId,
        successor.record.lostArtifactId,
        successor.record.kind,
        successor.record.successorCaptureId,
        successor.record.successorArtifactId,
        recordJson,
        decisionId,
      ]
    );
  }
}
