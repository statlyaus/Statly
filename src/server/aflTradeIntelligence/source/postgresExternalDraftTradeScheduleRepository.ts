import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradeExternalCaptureScheduleSchema,
  createAflTradeExternalCaptureDispatchKey,
  evaluateAflTradeExternalCaptureOccurrence,
  type AflTradeExternalCaptureClaim,
  type AflTradeExternalCaptureOccurrence,
  type AflTradeExternalCaptureSchedule,
  type AflTradeExternalCaptureScheduleDecision,
} from './externalDraftTradeScheduling';

export class AflTradeExternalCaptureSchedulePersistenceError extends Error {
  constructor(
    readonly code: 'SCHEDULE_CONFLICT' | 'SCHEDULE_INACTIVE' | 'OCCURRENCE_CONFLICT' | 'LEASE_LOST',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeExternalCaptureSchedulePersistenceError';
  }
}

export interface RegisterAflTradeExternalCaptureScheduleResult {
  scheduleId: string;
  idempotentReplay: boolean;
}

export interface ClaimAflTradeExternalCaptureOccurrenceInput {
  scheduleId: string;
  dueAt: string;
  observedAt: string;
  workerId: string;
  leaseTokenSha256: string;
}

export interface CompleteAflTradeExternalCaptureOccurrenceInput {
  claim: AflTradeExternalCaptureClaim;
  completedAt: string;
  outcome:
    | { status: 'completed' | 'not_modified'; resultId: string }
    | { status: 'failed'; failureCode: string };
}

export interface ListDueAflTradeExternalCaptureOccurrencesInput {
  environment: 'test_fixture' | 'non_production' | 'production';
  observedAt: string;
  limit: number;
}

export interface DueAflTradeExternalCaptureOccurrence {
  scheduleId: string;
  dueAt: string;
}

interface ScheduleRow {
  definition_json: unknown;
  state: string | null;
}

interface OccurrenceRow {
  dispatch_key: string;
  schedule_id: string;
  due_at: string | Date;
  status: AflTradeExternalCaptureOccurrence['status'];
  available_at: string | Date;
  attempt_number: number;
  completed_at: string | Date | null;
  result_id: string | null;
  failure_code: string | null;
  claim_id: string | null;
  worker_id: string | null;
  lease_token_sha256: string | null;
  claimed_at: string | Date | null;
  lease_expires_at: string | Date | null;
}

interface CircuitRow {
  consecutive_failures: number;
  opened_at: string | Date | null;
}

function instant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function storedOccurrence(
  row: OccurrenceRow | undefined
): AflTradeExternalCaptureOccurrence | null {
  if (!row) return null;
  const lastClaim =
    row.claim_id === null
      ? null
      : {
          claimId: row.claim_id,
          dispatchKey: row.dispatch_key,
          scheduleId: row.schedule_id,
          dueAt: instant(row.due_at),
          attemptNumber: row.attempt_number,
          claimedAt: instant(row.claimed_at!),
          leaseExpiresAt: instant(row.lease_expires_at!),
          workerId: row.worker_id!,
          leaseTokenSha256: row.lease_token_sha256!,
        };
  return {
    dispatchKey: row.dispatch_key,
    scheduleId: row.schedule_id,
    dueAt: instant(row.due_at),
    status: row.status,
    availableAt: instant(row.available_at),
    completedAt: row.completed_at === null ? null : instant(row.completed_at),
    resultId: row.result_id,
    failureCode: row.failure_code,
    lastClaim,
  };
}

async function loadSchedule(
  transaction: AflOutcomeSqlTransaction,
  scheduleId: string
): Promise<AflTradeExternalCaptureSchedule> {
  const stored = await transaction.query<ScheduleRow>(
    `SELECT schedule.definition_json, head.state
       FROM outcome_external_capture_schedule schedule
       LEFT JOIN outcome_external_capture_schedule_head head USING (schedule_id)
      WHERE schedule.schedule_id=$1`,
    [scheduleId]
  );
  const row = stored.rows[0];
  if (!row || row.state !== 'active') {
    throw new AflTradeExternalCaptureSchedulePersistenceError(
      'SCHEDULE_INACTIVE',
      'The exact external capture schedule is not currently active.'
    );
  }
  return aflTradeExternalCaptureScheduleSchema.parse({
    scheduleId,
    definition: row.definition_json,
  });
}

async function loadOccurrence(
  transaction: AflOutcomeSqlTransaction,
  dispatchKey: string
): Promise<OccurrenceRow | undefined> {
  const stored = await transaction.query<OccurrenceRow>(
    `SELECT occurrence.dispatch_key, occurrence.schedule_id, occurrence.due_at,
            occurrence.status, occurrence.available_at, occurrence.attempt_number,
            occurrence.completed_at, occurrence.result_id, occurrence.failure_code,
            attempt.claim_id, attempt.worker_id, attempt.lease_token_sha256,
            attempt.claimed_at, attempt.lease_expires_at
       FROM outcome_external_capture_occurrence occurrence
       LEFT JOIN outcome_external_capture_attempt attempt
         ON attempt.claim_id=occurrence.last_claim_id
      WHERE occurrence.dispatch_key=$1`,
    [dispatchKey]
  );
  return stored.rows[0];
}

function occurrenceEvent(input: {
  dispatchKey: string;
  revision: number;
  state: AflTradeExternalCaptureOccurrence['status'];
  occurredAt: string;
  availableAt: string;
  claimId: string | null;
  resultId: string | null;
  failureCode: string | null;
  previousEventId: string | null;
  decisionId?: string;
}) {
  const content = {
    schemaVersion: 'afl-trade-external-capture-occurrence-event/v1' as const,
    ...input,
  };
  return {
    eventId: createAflTradeContentAddress('external-capture-occurrence-event', content),
    content,
  };
}

async function persistDecision(
  transaction: AflOutcomeSqlTransaction,
  decision: AflTradeExternalCaptureScheduleDecision,
  prior: OccurrenceRow | undefined
): Promise<void> {
  const proposed = decision.proposedOccurrence;
  if (!proposed) return;
  const revision = prior ? (await currentRevision(transaction, decision.dispatchKey)) + 1 : 1;
  const previousEventId = prior ? await currentEventId(transaction, decision.dispatchKey) : null;
  const event = occurrenceEvent({
    dispatchKey: decision.dispatchKey,
    revision,
    state: proposed.status,
    occurredAt: decision.observedAt,
    availableAt: proposed.availableAt,
    claimId: proposed.lastClaim?.claimId ?? null,
    resultId: proposed.resultId,
    failureCode: proposed.failureCode,
    previousEventId,
    decisionId: decision.decisionId,
  });

  if (!prior) {
    await transaction.query(
      `INSERT INTO outcome_external_capture_occurrence
       (dispatch_key,schedule_id,due_at,status,revision,event_id,available_at,last_claim_id,
        attempt_number,completed_at,result_id,failure_code,state_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        proposed.dispatchKey,
        proposed.scheduleId,
        proposed.dueAt,
        proposed.status,
        revision,
        event.eventId,
        proposed.availableAt,
        proposed.lastClaim?.claimId ?? null,
        proposed.lastClaim?.attemptNumber ?? 0,
        proposed.completedAt,
        proposed.resultId,
        proposed.failureCode,
        canonicalizeAflTradeJson(event.content),
      ]
    );
  }
  if (decision.proposedClaim) {
    const claim = decision.proposedClaim;
    await transaction.query(
      `INSERT INTO outcome_external_capture_attempt
       (claim_id,dispatch_key,attempt_number,worker_id,lease_token_sha256,claimed_at,lease_expires_at,claim_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        claim.claimId,
        claim.dispatchKey,
        claim.attemptNumber,
        claim.workerId,
        claim.leaseTokenSha256,
        claim.claimedAt,
        claim.leaseExpiresAt,
        canonicalizeAflTradeJson(claim),
      ]
    );
  }
  await insertOccurrenceEvent(transaction, event);
}

async function currentRevision(
  transaction: AflOutcomeSqlTransaction,
  dispatchKey: string
): Promise<number> {
  const result = await transaction.query<{ revision: number }>(
    `SELECT revision FROM outcome_external_capture_occurrence WHERE dispatch_key=$1`,
    [dispatchKey]
  );
  return result.rows[0]!.revision;
}

async function currentEventId(
  transaction: AflOutcomeSqlTransaction,
  dispatchKey: string
): Promise<string> {
  const result = await transaction.query<{ event_id: string }>(
    `SELECT event_id FROM outcome_external_capture_occurrence WHERE dispatch_key=$1`,
    [dispatchKey]
  );
  return result.rows[0]!.event_id;
}

async function insertOccurrenceEvent(
  transaction: AflOutcomeSqlTransaction,
  event: ReturnType<typeof occurrenceEvent>
): Promise<void> {
  const content = event.content;
  await transaction.query(
    `INSERT INTO outcome_external_capture_occurrence_event
     (event_id,dispatch_key,revision,state,occurred_at,available_at,claim_id,result_id,
      failure_code,previous_event_id,event_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      event.eventId,
      content.dispatchKey,
      content.revision,
      content.state,
      content.occurredAt,
      content.availableAt,
      content.claimId,
      content.resultId,
      content.failureCode,
      content.previousEventId,
      canonicalizeAflTradeJson(content),
    ]
  );
}

function retryAt(schedule: AflTradeExternalCaptureSchedule, claim: AflTradeExternalCaptureClaim) {
  const { retryBaseSeconds, retryMaximumSeconds } = schedule.definition.execution;
  const exponential = Math.min(
    retryMaximumSeconds,
    retryBaseSeconds * 2 ** Math.max(0, claim.attemptNumber - 1)
  );
  const fraction = Number.parseInt(claim.dispatchKey.slice(-4), 16) / 0xffff;
  const jitter = Math.floor(
    Math.min(exponential / 4, retryMaximumSeconds - exponential) * fraction
  );
  return new Date(Date.parse(claim.leaseExpiresAt) + (exponential + jitter) * 1_000).toISOString();
}

export async function persistAflTradeExternalCaptureSchedule(
  transaction: AflOutcomeSqlTransaction,
  unparsedSchedule: AflTradeExternalCaptureSchedule,
  registeredAt: string
): Promise<RegisterAflTradeExternalCaptureScheduleResult> {
  const schedule = aflTradeExternalCaptureScheduleSchema.parse(unparsedSchedule);
  await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `external-capture-schedule:${schedule.scheduleId}`,
  ]);
  const inserted = await transaction.query(
    `INSERT INTO outcome_external_capture_schedule
         (schedule_id,environment,provider,capability_id,competition,anchor_season_year,
          source_url,cadence_anchor_at,interval_seconds,registered_at,definition_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (schedule_id) DO NOTHING`,
    [
      schedule.scheduleId,
      schedule.definition.requestTemplate.environment,
      schedule.definition.requestTemplate.provider,
      schedule.definition.requestTemplate.capabilityId,
      schedule.definition.requestTemplate.competition,
      schedule.definition.requestTemplate.anchorSeasonYear,
      schedule.definition.requestTemplate.sourceUrl,
      schedule.definition.cadence.anchorAt,
      schedule.definition.cadence.intervalSeconds,
      registeredAt,
      canonicalizeAflTradeJson(schedule.definition),
    ]
  );
  const exact = await transaction.query<{ definition_json: unknown; state: string | null }>(
    `SELECT schedule.definition_json, head.state
           FROM outcome_external_capture_schedule schedule
           LEFT JOIN outcome_external_capture_schedule_head head USING (schedule_id)
          WHERE schedule.schedule_id=$1`,
    [schedule.scheduleId]
  );
  if (
    !exact.rows[0] ||
    canonicalizeAflTradeJson(exact.rows[0].definition_json) !==
      canonicalizeAflTradeJson(schedule.definition)
  ) {
    throw new AflTradeExternalCaptureSchedulePersistenceError(
      'SCHEDULE_CONFLICT',
      'Stored external capture schedule content conflicts with its identifier.'
    );
  }
  if (exact.rows[0].state === null) {
    const content = {
      schemaVersion: 'afl-trade-external-capture-schedule-event/v1' as const,
      scheduleId: schedule.scheduleId,
      revision: 1,
      state: 'active' as const,
      occurredAt: registeredAt,
      previousEventId: null,
    };
    await transaction.query(
      `INSERT INTO outcome_external_capture_schedule_event
           (event_id,schedule_id,revision,state,occurred_at,previous_event_id,event_json)
           VALUES ($1,$2,1,'active',$3,NULL,$4::jsonb)`,
      [
        createAflTradeContentAddress('external-capture-schedule-event', content),
        schedule.scheduleId,
        registeredAt,
        canonicalizeAflTradeJson(content),
      ]
    );
  }
  return { scheduleId: schedule.scheduleId, idempotentReplay: inserted.rowCount === 0 };
}

export class PostgresAflTradeExternalCaptureScheduleRepository {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async listDue(
    input: ListDueAflTradeExternalCaptureOccurrencesInput
  ): Promise<DueAflTradeExternalCaptureOccurrence[]> {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000 ||
      !Number.isFinite(Date.parse(input.observedAt))
    ) {
      throw new TypeError('External capture due-work query is not bounded and valid.');
    }
    const due = await this.client.query<{ schedule_id: string; next_due_at: string | Date }>(
      `SELECT cursor.schedule_id,cursor.next_due_at
         FROM outcome_external_capture_dispatch_cursor cursor
         JOIN outcome_external_capture_schedule schedule USING (schedule_id)
         JOIN outcome_external_capture_schedule_head head USING (schedule_id)
         LEFT JOIN outcome_external_capture_occurrence occurrence
           ON occurrence.schedule_id=cursor.schedule_id
          AND occurrence.due_at=cursor.next_due_at
         LEFT JOIN outcome_external_capture_attempt attempt
           ON attempt.claim_id=occurrence.last_claim_id
        WHERE schedule.environment=$1
          AND head.state='active'
          AND cursor.next_due_at<=$2
          AND (
            occurrence.dispatch_key IS NULL
            OR (occurrence.status='retry_wait' AND occurrence.available_at<=$2)
            OR (occurrence.status='leased' AND attempt.lease_expires_at<=$2)
          )
        ORDER BY cursor.next_due_at,cursor.schedule_id
        LIMIT $3`,
      [input.environment, input.observedAt, input.limit]
    );
    return due.rows.map((row) => ({
      scheduleId: row.schedule_id,
      dueAt: instant(row.next_due_at),
    }));
  }

  async register(
    unparsedSchedule: AflTradeExternalCaptureSchedule,
    registeredAt: string
  ): Promise<RegisterAflTradeExternalCaptureScheduleResult> {
    return this.client.transaction((transaction) =>
      persistAflTradeExternalCaptureSchedule(transaction, unparsedSchedule, registeredAt)
    );
  }

  async claim(
    input: ClaimAflTradeExternalCaptureOccurrenceInput
  ): Promise<AflTradeExternalCaptureScheduleDecision> {
    return this.client.transaction(async (transaction) => {
      const dispatchKey = createAflTradeExternalCaptureDispatchKey(input.scheduleId, input.dueAt);
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `external-capture-dispatch:${dispatchKey}`,
      ]);
      const schedule = await loadSchedule(transaction, input.scheduleId);
      const priorRow = await loadOccurrence(transaction, dispatchKey);
      const circuit = await transaction.query<CircuitRow>(
        `SELECT consecutive_failures, opened_at
           FROM outcome_external_capture_provider_circuit
          WHERE environment=$1 AND provider=$2`,
        [
          schedule.definition.requestTemplate.environment,
          schedule.definition.requestTemplate.provider,
        ]
      );
      const circuitRow = circuit.rows[0];
      const decision = evaluateAflTradeExternalCaptureOccurrence({
        schemaVersion: 'afl-trade-external-capture-schedule-evaluation/v1',
        schedule,
        dueAt: input.dueAt,
        observedAt: input.observedAt,
        workerId: input.workerId,
        leaseTokenSha256: input.leaseTokenSha256,
        priorOccurrence: storedOccurrence(priorRow),
        consecutiveProviderFailures: circuitRow?.consecutive_failures ?? 0,
        circuitOpenedAt: circuitRow?.opened_at ? instant(circuitRow.opened_at) : null,
      });
      await persistDecision(transaction, decision, priorRow);
      return decision;
    });
  }

  async complete(input: CompleteAflTradeExternalCaptureOccurrenceInput): Promise<void> {
    await this.client.transaction(async (transaction) => {
      await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `external-capture-dispatch:${input.claim.dispatchKey}`,
      ]);
      const schedule = await loadSchedule(transaction, input.claim.scheduleId);
      const current = await loadOccurrence(transaction, input.claim.dispatchKey);
      if (
        !current ||
        current.status !== 'leased' ||
        current.claim_id !== input.claim.claimId ||
        current.lease_token_sha256 !== input.claim.leaseTokenSha256
      ) {
        throw new AflTradeExternalCaptureSchedulePersistenceError(
          'LEASE_LOST',
          'The scheduled capture lease is no longer current.'
        );
      }
      const lease = await transaction.query<{ valid: boolean }>(
        `SELECT lease_expires_at > clock_timestamp() AS valid
           FROM outcome_external_capture_attempt WHERE claim_id=$1`,
        [input.claim.claimId]
      );
      if (!lease.rows[0]?.valid) {
        throw new AflTradeExternalCaptureSchedulePersistenceError(
          'LEASE_LOST',
          'The scheduled capture lease expired before completion.'
        );
      }
      const revision = await currentRevision(transaction, input.claim.dispatchKey);
      const previousEventId = await currentEventId(transaction, input.claim.dispatchKey);
      const succeeded = input.outcome.status !== 'failed';
      const exhausted = input.claim.attemptNumber >= schedule.definition.execution.maximumAttempts;
      const state: AflTradeExternalCaptureOccurrence['status'] =
        input.outcome.status === 'failed'
          ? exhausted
            ? 'dead_letter'
            : 'retry_wait'
          : input.outcome.status;
      const availableAt =
        succeeded || exhausted ? input.completedAt : retryAt(schedule, input.claim);
      const resultId = input.outcome.status === 'failed' ? null : input.outcome.resultId;
      const failureCode =
        input.outcome.status === 'failed' && !exhausted ? input.outcome.failureCode : null;
      const event = occurrenceEvent({
        dispatchKey: input.claim.dispatchKey,
        revision: revision + 1,
        state,
        occurredAt: input.completedAt,
        availableAt,
        claimId: input.claim.claimId,
        resultId,
        failureCode,
        previousEventId,
      });
      await insertOccurrenceEvent(transaction, event);
      const environment = schedule.definition.requestTemplate.environment;
      const provider = schedule.definition.requestTemplate.provider;
      if (succeeded) {
        await transaction.query(
          `INSERT INTO outcome_external_capture_provider_circuit
           (environment,provider,revision,consecutive_failures,opened_at,updated_at)
           VALUES ($1,$2,1,0,NULL,$3)
           ON CONFLICT (environment,provider) DO UPDATE
           SET revision=outcome_external_capture_provider_circuit.revision+1,
               consecutive_failures=0, opened_at=NULL, updated_at=EXCLUDED.updated_at`,
          [environment, provider, input.completedAt]
        );
      } else {
        const threshold = schedule.definition.execution.circuitFailureThreshold;
        await transaction.query(
          `INSERT INTO outcome_external_capture_provider_circuit
           (environment,provider,revision,consecutive_failures,opened_at,updated_at)
           VALUES ($1,$2,1,1,CASE WHEN $3=1 THEN $4::timestamptz ELSE NULL END,$4)
           ON CONFLICT (environment,provider) DO UPDATE
           SET revision=outcome_external_capture_provider_circuit.revision+1,
               consecutive_failures=outcome_external_capture_provider_circuit.consecutive_failures+1,
               opened_at=CASE
                 WHEN outcome_external_capture_provider_circuit.consecutive_failures+1 >= $3
                 THEN COALESCE(outcome_external_capture_provider_circuit.opened_at,$4::timestamptz)
                 ELSE NULL END,
               updated_at=$4`,
          [environment, provider, threshold, input.completedAt]
        );
      }
    });
  }
}
