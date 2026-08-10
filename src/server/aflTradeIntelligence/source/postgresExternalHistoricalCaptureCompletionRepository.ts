import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeExternalHistoricalCapturePlanSchema,
  type AflTradeExternalHistoricalCapturePlan,
} from './externalDraftTradeDiscoveryContracts';
import {
  aflTradeExternalHistoricalCaptureCompletionSchema,
  createAflTradeExternalHistoricalCaptureCompletion,
  type AflTradeExternalHistoricalCaptureCompletion,
  type AflTradeExternalHistoricalCaptureCompletionResult,
} from './externalHistoricalCaptureCompletionContracts';

export type AflTradeExternalHistoricalCaptureCompletionPersistenceErrorCode =
  'PLAN_NOT_FOUND' | 'PLAN_INCOMPLETE' | 'EVIDENCE_MISMATCH' | 'COMPLETION_CONFLICT';

export class AflTradeExternalHistoricalCaptureCompletionPersistenceError extends Error {
  constructor(
    readonly code: AflTradeExternalHistoricalCaptureCompletionPersistenceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AflTradeExternalHistoricalCaptureCompletionPersistenceError';
  }
}

export interface PersistedAflTradeExternalHistoricalCaptureCompletion {
  completionId: string;
  planId: string;
  targetCount: number;
  sourceBatchCount: number;
  completedAt: string;
  idempotentReplay: boolean;
  publicationEligible: false;
}

interface PlanRow {
  plan_json: unknown;
  finalized_at: string | Date | null;
}

interface CompletionRow {
  completion_json: unknown;
  finalized_at: string | Date | null;
}

interface OccurrenceRow {
  dispatch_key: string;
  status: string;
  revision: number;
  event_id: string;
  event_revision: number;
  completed_at: string | Date | null;
  result_id: string | null;
}

interface EvidenceBatchRow {
  batch_id: string;
  capture_id: string;
  evidence_count: number;
  issue_count: number;
  status: string;
  finalized_at: string | Date | null;
  environment: 'test_fixture' | 'non_production' | 'production';
  provider: string;
  competition: string;
  anchor_season_year: number;
  capability_id: string | null;
  source_url: string | null;
}

function exactInstant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePlan(row: PlanRow | undefined): AflTradeExternalHistoricalCapturePlan {
  if (!row || row.finalized_at === null) {
    throw new AflTradeExternalHistoricalCaptureCompletionPersistenceError(
      'PLAN_NOT_FOUND',
      'Historical capture completion requires the exact finalized plan.'
    );
  }
  try {
    const plan = aflTradeExternalHistoricalCapturePlanSchema.parse(row.plan_json);
    if (exactInstant(row.finalized_at) !== plan.content.plannedAt) {
      throw new TypeError('Plan finalization timestamp mismatch.');
    }
    return plan;
  } catch (error) {
    throw new AflTradeExternalHistoricalCaptureCompletionPersistenceError(
      'PLAN_NOT_FOUND',
      'Stored historical capture plan failed authentication.',
      { cause: error }
    );
  }
}

function parseCompletion(
  row: CompletionRow | undefined
): AflTradeExternalHistoricalCaptureCompletion | null {
  if (!row) return null;
  try {
    const completion = aflTradeExternalHistoricalCaptureCompletionSchema.parse(row.completion_json);
    if (
      row.finalized_at === null ||
      exactInstant(row.finalized_at) !== completion.content.completedAt
    ) {
      throw new TypeError('Completion finalization timestamp mismatch.');
    }
    return completion;
  } catch (error) {
    throw new AflTradeExternalHistoricalCaptureCompletionPersistenceError(
      'COMPLETION_CONFLICT',
      'Stored historical capture completion failed authentication.',
      { cause: error }
    );
  }
}

function completionResult(
  plan: AflTradeExternalHistoricalCapturePlan,
  targetIndex: number,
  occurrence: OccurrenceRow | undefined,
  batch: EvidenceBatchRow | undefined
): AflTradeExternalHistoricalCaptureCompletionResult {
  const target = plan.content.targets[targetIndex];
  if (
    !target ||
    !occurrence ||
    occurrence.completed_at === null ||
    occurrence.result_id === null ||
    !['completed', 'not_modified'].includes(occurrence.status) ||
    occurrence.revision !== occurrence.event_revision
  ) {
    throw new AflTradeExternalHistoricalCaptureCompletionPersistenceError(
      'PLAN_INCOMPLETE',
      `Historical target ${targetIndex + 1} has no usable terminal capture occurrence.`
    );
  }
  const request = target.content.schedule.definition.requestTemplate;
  if (
    !batch ||
    batch.status !== 'finalized' ||
    batch.finalized_at === null ||
    batch.issue_count !== 0 ||
    batch.evidence_count < 1 ||
    batch.environment !== plan.content.environment ||
    batch.provider !== request.provider ||
    batch.competition !== plan.content.competition ||
    batch.anchor_season_year !== request.anchorSeasonYear ||
    batch.capability_id !== request.capabilityId ||
    batch.source_url !== request.sourceUrl
  ) {
    throw new AflTradeExternalHistoricalCaptureCompletionPersistenceError(
      'EVIDENCE_MISMATCH',
      `Historical target ${target.content.ordinal} does not resolve to exact issue-free evidence.`
    );
  }
  return {
    ordinal: target.content.ordinal,
    targetId: target.targetId,
    scheduleId: target.content.schedule.scheduleId,
    dispatchKey: occurrence.dispatch_key,
    occurrenceEventId: occurrence.event_id,
    occurrenceRevision: occurrence.revision,
    captureMode: occurrence.status === 'completed' ? 'captured' : 'not_modified',
    resultId: occurrence.result_id,
    captureId: batch.capture_id,
    evidenceBatchId: batch.batch_id,
    evidenceBatchSha256: batch.batch_id.slice('external-evidence-batch:'.length),
    evidenceCount: batch.evidence_count,
    finalizedAt: exactInstant(batch.finalized_at),
  };
}

async function loadOccurrence(
  transaction: AflOutcomeSqlTransaction,
  scheduleId: string,
  dueAt: string
): Promise<OccurrenceRow | undefined> {
  const result = await transaction.query<OccurrenceRow>(
    `SELECT occurrence.dispatch_key,occurrence.status,occurrence.revision,
            occurrence.event_id,event.revision AS event_revision,
            occurrence.completed_at,occurrence.result_id
       FROM outcome_external_capture_occurrence occurrence
       JOIN outcome_external_capture_occurrence_event event
         ON event.event_id=occurrence.event_id
      WHERE occurrence.schedule_id=$1 AND occurrence.due_at=$2::timestamptz
      FOR SHARE OF occurrence,event`,
    [scheduleId, dueAt]
  );
  return result.rows[0];
}

async function loadCapturedBatch(
  transaction: AflOutcomeSqlTransaction,
  batchId: string
): Promise<EvidenceBatchRow | undefined> {
  const result = await transaction.query<EvidenceBatchRow>(
    `SELECT batch.batch_id,batch.capture_id,batch.evidence_count,batch.issue_count,
            batch.status,batch.finalized_at,capture.environment::text AS environment,
            capture.provider,capture.competition,capture.anchor_season_year,
            capture.capability_id,capture.manifest_json->>'sourceUrl' AS source_url
       FROM outcome_external_evidence_batch batch
       JOIN outcome_source_capture capture ON capture.capture_id=batch.capture_id
      WHERE batch.batch_id=$1
      FOR SHARE OF batch,capture`,
    [batchId]
  );
  return result.rows[0];
}

async function loadPriorBatch(
  transaction: AflOutcomeSqlTransaction,
  attemptId: string
): Promise<EvidenceBatchRow | undefined> {
  const result = await transaction.query<EvidenceBatchRow>(
    `SELECT batch.batch_id,batch.capture_id,batch.evidence_count,batch.issue_count,
            batch.status,batch.finalized_at,capture.environment::text AS environment,
            capture.provider,capture.competition,capture.anchor_season_year,
            capture.capability_id,capture.manifest_json->>'sourceUrl' AS source_url
       FROM outcome_source_capture_attempt attempt
       JOIN outcome_source_capture capture
         ON capture.capture_id=attempt.attempt_json->>'priorCaptureId'
       JOIN outcome_external_evidence_batch batch ON batch.capture_id=capture.capture_id
      WHERE attempt.attempt_id=$1 AND attempt.status='not_modified'
      FOR SHARE OF attempt,capture,batch`,
    [attemptId]
  );
  return result.rows[0];
}

function latestInstant(values: readonly string[]): string {
  return new Date(Math.max(...values.map((value) => Date.parse(value)))).toISOString();
}

export class PostgresAflTradeExternalHistoricalCaptureCompletionRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async completePlan(
    planId: string
  ): Promise<PersistedAflTradeExternalHistoricalCaptureCompletion> {
    if (!/^external-historical-capture-plan:[a-f0-9]{64}$/.test(planId)) {
      throw new TypeError('Historical capture completion requires one content-addressed plan ID.');
    }
    return this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `external-historical-capture-completion:${planId}`,
      ]);
      const existingResult = await transaction.query<CompletionRow>(
        `SELECT completion_json,finalized_at
           FROM outcome_external_historical_capture_completion
          WHERE plan_id=$1
          FOR SHARE`,
        [planId]
      );
      const existing = parseCompletion(existingResult.rows[0]);
      if (existing) {
        return {
          completionId: existing.completionId,
          planId,
          targetCount: existing.content.targetCount,
          sourceBatchCount: existing.content.sourceBatchIds.length,
          completedAt: existing.content.completedAt,
          idempotentReplay: true,
          publicationEligible: false,
        };
      }
      const planResult = await transaction.query<PlanRow>(
        `SELECT plan_json,finalized_at
           FROM outcome_external_historical_capture_plan
          WHERE plan_id=$1
          FOR SHARE`,
        [planId]
      );
      const plan = parsePlan(planResult.rows[0]);
      const results: AflTradeExternalHistoricalCaptureCompletionResult[] = [];
      const chronology = [plan.content.plannedAt];
      for (const [index, target] of plan.content.targets.entries()) {
        const dueAt = target.content.schedule.definition.cadence.anchorAt;
        const occurrence = await loadOccurrence(
          transaction,
          target.content.schedule.scheduleId,
          dueAt
        );
        if (
          !occurrence ||
          occurrence.completed_at === null ||
          occurrence.result_id === null ||
          !['completed', 'not_modified'].includes(occurrence.status)
        ) {
          throw new AflTradeExternalHistoricalCaptureCompletionPersistenceError(
            'PLAN_INCOMPLETE',
            `Historical target ${target.content.ordinal} is not durably complete.`
          );
        }
        const batch =
          occurrence.status === 'completed'
            ? await loadCapturedBatch(transaction, occurrence.result_id)
            : await loadPriorBatch(transaction, occurrence.result_id);
        const resolved = completionResult(plan, index, occurrence, batch);
        results.push(resolved);
        chronology.push(exactInstant(occurrence.completed_at), resolved.finalizedAt);
      }
      const completion = createAflTradeExternalHistoricalCaptureCompletion({
        plan,
        completedAt: latestInstant(chronology),
        results,
      });
      await transaction.query(
        `INSERT INTO outcome_external_historical_capture_completion
          (completion_id,plan_id,environment,competition,target_count,result_set_sha256,
           source_batch_set_sha256,completed_at,status,reconciliation_eligible,completion_json,
           completion_canonical_json,finalized_at)
         VALUES ($1,$2,$3::"OutcomeEnvironment",$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NULL)`,
        [
          completion.completionId,
          planId,
          completion.content.environment,
          completion.content.competition,
          completion.content.targetCount,
          completion.content.resultSetSha256,
          completion.content.sourceBatchSetSha256,
          completion.content.completedAt,
          completion.content.status,
          completion.content.reconciliationEligible,
          canonicalizeAflTradeJson(completion),
          canonicalizeAflTradeJson(completion.content),
        ]
      );
      for (const result of completion.content.results) {
        await transaction.query(
          `INSERT INTO outcome_external_historical_capture_completion_result
            (completion_id,ordinal,plan_id,target_id,schedule_id,dispatch_key,occurrence_event_id,
             occurrence_revision,capture_mode,result_id,capture_id,evidence_batch_id,
             evidence_count,finalized_at,result_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,
          [
            completion.completionId,
            result.ordinal,
            planId,
            result.targetId,
            result.scheduleId,
            result.dispatchKey,
            result.occurrenceEventId,
            result.occurrenceRevision,
            result.captureMode,
            result.resultId,
            result.captureId,
            result.evidenceBatchId,
            result.evidenceCount,
            result.finalizedAt,
            canonicalizeAflTradeJson(result),
          ]
        );
      }
      await transaction.query(
        `UPDATE outcome_external_historical_capture_completion
            SET finalized_at=$2
          WHERE completion_id=$1 AND finalized_at IS NULL`,
        [completion.completionId, completion.content.completedAt]
      );
      return {
        completionId: completion.completionId,
        planId,
        targetCount: completion.content.targetCount,
        sourceBatchCount: completion.content.sourceBatchIds.length,
        completedAt: completion.content.completedAt,
        idempotentReplay: false,
        publicationEligible: false,
      };
    });
  }
}
