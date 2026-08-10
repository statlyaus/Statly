import { createAflTradeContentAddress } from '../artifacts/contentAddress';
import {
  aflTradeCalculationRunInputsSchema,
  aflTradeCalculationRunSchema,
  aflTradeLastGoodPublicationSnapshotSchema,
  createAflTradeCalculationRunId,
  type AflTradeCalculationAttempt,
  type AflTradeCalculationRun,
  type AflTradeCalculationRunInputs,
  type AflTradeLastGoodPublicationSnapshot,
} from './calculationRunContracts';

type FailedAttempt = Extract<AflTradeCalculationAttempt, { state: 'failed' }>;
type RunningAttempt = Extract<AflTradeCalculationAttempt, { state: 'running' }>;
type SuccessfulAttempt = Extract<AflTradeCalculationAttempt, { state: 'succeeded' }>;

export const AFL_TRADE_CALCULATION_TRANSITION_ERROR_CODES = [
  'invalid_transition',
  'stale_attempt',
  'lease_mismatch',
  'lease_expired',
  'attempt_not_retryable',
] as const;

export type AflTradeCalculationTransitionErrorCode =
  (typeof AFL_TRADE_CALCULATION_TRANSITION_ERROR_CODES)[number];

export class AflTradeCalculationTransitionError extends Error {
  readonly code: AflTradeCalculationTransitionErrorCode;

  constructor(code: AflTradeCalculationTransitionErrorCode, message: string) {
    super(message);
    this.name = 'AflTradeCalculationTransitionError';
    this.code = code;
  }
}

export interface StartAflTradeCalculationAttemptCommand {
  expectedAttemptId: string;
  workerIdentity: string;
  leaseId: string;
  startedAt: string;
  leaseExpiresAt: string;
}

export interface HeartbeatAflTradeCalculationAttemptCommand {
  expectedAttemptId: string;
  expectedLeaseId: string;
  heartbeatAt: string;
  renewedLeaseExpiresAt: string;
}

export interface FinishAflTradeCalculationAttemptCommand {
  expectedAttemptId: string;
  expectedLeaseId: string;
  finishedAt: string;
}

export interface CancelAflTradeCalculationAttemptCommand {
  expectedAttemptId: string;
  expectedLeaseId?: string;
  cancelledBy: string;
  reason: string;
  finishedAt: string;
}

export type AflTradeCalculationServingDisposition =
  | {
      action: 'retain_last_good';
      reason: 'run_not_successful';
      lastGood: AflTradeLastGoodPublicationSnapshot | null;
      candidatePublicationId: null;
      candidateProjectionId: null;
    }
  | {
      action: 'candidate_requires_governance';
      reason: 'calculation_succeeded';
      lastGood: AflTradeLastGoodPublicationSnapshot | null;
      candidatePublicationId: string;
      candidateProjectionId: string;
    };

function transitionError(code: AflTradeCalculationTransitionErrorCode, message: string): never {
  throw new AflTradeCalculationTransitionError(code, message);
}

function parseRun(run: AflTradeCalculationRun): AflTradeCalculationRun {
  return aflTradeCalculationRunSchema.parse(run);
}

function latestAttempt(run: AflTradeCalculationRun): AflTradeCalculationAttempt {
  const latest = run.attempts.at(-1);
  if (!latest) {
    return transitionError('invalid_transition', 'A calculation run must contain an attempt.');
  }
  return latest;
}

function assertExpectedAttempt(
  attempt: AflTradeCalculationAttempt,
  expectedAttemptId: string
): void {
  if (attempt.attemptId !== expectedAttemptId) {
    transitionError(
      'stale_attempt',
      `Expected attempt ${expectedAttemptId}, but ${attempt.attemptId} is current.`
    );
  }
}

function assertExpectedLease(attempt: RunningAttempt, expectedLeaseId: string): void {
  if (attempt.lease.leaseId !== expectedLeaseId) {
    transitionError(
      'lease_mismatch',
      `Lease ${expectedLeaseId} does not own attempt ${attempt.attemptId}.`
    );
  }
}

function replaceLatestAttempt(
  run: AflTradeCalculationRun,
  attempt: AflTradeCalculationAttempt,
  candidate: { publicationId: string; projectionId: string } | null = null
): AflTradeCalculationRun {
  return aflTradeCalculationRunSchema.parse({
    ...run,
    state: attempt.state,
    attempts: [...run.attempts.slice(0, -1), attempt],
    candidatePublicationId: candidate?.publicationId ?? null,
    candidateProjectionId: candidate?.projectionId ?? null,
    updatedAt:
      'finishedAt' in attempt
        ? attempt.finishedAt
        : 'heartbeatAt' in attempt
          ? attempt.heartbeatAt
          : attempt.queuedAt,
  });
}

export function queueAflTradeCalculationRun(params: {
  inputs: AflTradeCalculationRunInputs;
  lastGoodAtStart: AflTradeLastGoodPublicationSnapshot | null;
  queuedAt: string;
  initiatedBy: string;
}): AflTradeCalculationRun {
  const inputs = aflTradeCalculationRunInputsSchema.parse(params.inputs);
  const lastGoodAtStart = params.lastGoodAtStart
    ? aflTradeLastGoodPublicationSnapshotSchema.parse(params.lastGoodAtStart)
    : null;
  const runId = createAflTradeCalculationRunId(inputs);
  const attemptNumber = 1;
  const attemptId = createAflTradeContentAddress('calculation-attempt', {
    runId,
    attemptNumber,
  });

  return aflTradeCalculationRunSchema.parse({
    runId,
    inputs,
    state: 'queued',
    attempts: [
      {
        attemptId,
        attemptNumber,
        queuedAt: params.queuedAt,
        initiatedBy: params.initiatedBy,
        state: 'queued',
      },
    ],
    lastGoodAtStart,
    candidatePublicationId: null,
    candidateProjectionId: null,
    createdAt: params.queuedAt,
    updatedAt: params.queuedAt,
  });
}

export function startAflTradeCalculationAttempt(
  unparsedRun: AflTradeCalculationRun,
  command: StartAflTradeCalculationAttemptCommand
): AflTradeCalculationRun {
  const run = parseRun(unparsedRun);
  const latest = latestAttempt(run);
  assertExpectedAttempt(latest, command.expectedAttemptId);
  if (latest.state !== 'queued') {
    return transitionError('invalid_transition', 'Only a queued attempt may start.');
  }

  return replaceLatestAttempt(run, {
    ...latest,
    state: 'running',
    startedAt: command.startedAt,
    heartbeatAt: command.startedAt,
    lease: {
      leaseId: command.leaseId,
      workerIdentity: command.workerIdentity,
      acquiredAt: command.startedAt,
      expiresAt: command.leaseExpiresAt,
    },
  });
}

export function heartbeatAflTradeCalculationAttempt(
  unparsedRun: AflTradeCalculationRun,
  command: HeartbeatAflTradeCalculationAttemptCommand
): AflTradeCalculationRun {
  const run = parseRun(unparsedRun);
  const latest = latestAttempt(run);
  assertExpectedAttempt(latest, command.expectedAttemptId);
  if (latest.state !== 'running') {
    return transitionError('invalid_transition', 'Only a running attempt may heartbeat.');
  }
  assertExpectedLease(latest, command.expectedLeaseId);
  if (Date.parse(command.heartbeatAt) <= Date.parse(latest.heartbeatAt)) {
    return transitionError(
      'invalid_transition',
      'A heartbeat must advance the latest recorded worker activity.'
    );
  }
  if (Date.parse(command.heartbeatAt) >= Date.parse(latest.lease.expiresAt)) {
    return transitionError('lease_expired', 'An expired lease cannot be renewed.');
  }

  return replaceLatestAttempt(run, {
    ...latest,
    heartbeatAt: command.heartbeatAt,
    lease: {
      ...latest.lease,
      expiresAt: command.renewedLeaseExpiresAt,
    },
  });
}

export function succeedAflTradeCalculationAttempt(
  unparsedRun: AflTradeCalculationRun,
  command: FinishAflTradeCalculationAttemptCommand & {
    result: SuccessfulAttempt['result'];
  }
): AflTradeCalculationRun {
  const run = parseRun(unparsedRun);
  const latest = latestAttempt(run);
  assertExpectedAttempt(latest, command.expectedAttemptId);
  if (latest.state !== 'running') {
    return transitionError('invalid_transition', 'Only a running attempt may succeed.');
  }
  assertExpectedLease(latest, command.expectedLeaseId);
  if (Date.parse(command.finishedAt) >= Date.parse(latest.lease.expiresAt)) {
    return transitionError('lease_expired', 'An expired lease cannot commit a successful result.');
  }

  const attempt = {
    ...latest,
    state: 'succeeded' as const,
    finishedAt: command.finishedAt,
    result: command.result,
  };
  return replaceLatestAttempt(run, attempt, {
    publicationId: command.result.publicationId,
    projectionId: command.result.projectionId,
  });
}

export function failAflTradeCalculationAttempt(
  unparsedRun: AflTradeCalculationRun,
  command: FinishAflTradeCalculationAttemptCommand & {
    result: FailedAttempt['result'];
  }
): AflTradeCalculationRun {
  const run = parseRun(unparsedRun);
  const latest = latestAttempt(run);
  assertExpectedAttempt(latest, command.expectedAttemptId);
  if (latest.state !== 'running') {
    return transitionError('invalid_transition', 'Only a running attempt may fail.');
  }
  assertExpectedLease(latest, command.expectedLeaseId);
  const finishedAfterExpiry = Date.parse(command.finishedAt) >= Date.parse(latest.lease.expiresAt);
  if (finishedAfterExpiry !== (command.result.classification === 'lease_expired')) {
    return transitionError(
      'invalid_transition',
      'Lease-expiry failures must match the recorded lease chronology.'
    );
  }

  return replaceLatestAttempt(run, {
    ...latest,
    state: 'failed',
    finishedAt: command.finishedAt,
    result: command.result,
  });
}

export function cancelAflTradeCalculationAttempt(
  unparsedRun: AflTradeCalculationRun,
  command: CancelAflTradeCalculationAttemptCommand
): AflTradeCalculationRun {
  const run = parseRun(unparsedRun);
  const latest = latestAttempt(run);
  assertExpectedAttempt(latest, command.expectedAttemptId);
  if (latest.state !== 'queued' && latest.state !== 'running') {
    return transitionError('invalid_transition', 'Only queued or running work may be cancelled.');
  }
  if (latest.state === 'running') {
    if (!command.expectedLeaseId) {
      return transitionError('lease_mismatch', 'Running work requires its lease to cancel.');
    }
    assertExpectedLease(latest, command.expectedLeaseId);
  }

  return replaceLatestAttempt(run, {
    attemptId: latest.attemptId,
    attemptNumber: latest.attemptNumber,
    queuedAt: latest.queuedAt,
    initiatedBy: latest.initiatedBy,
    state: 'cancelled',
    execution:
      latest.state === 'running'
        ? {
            startedAt: latest.startedAt,
            heartbeatAt: latest.heartbeatAt,
            lease: latest.lease,
          }
        : null,
    finishedAt: command.finishedAt,
    cancelledBy: command.cancelledBy,
    reason: command.reason,
  });
}

export function retryAflTradeCalculationRun(
  unparsedRun: AflTradeCalculationRun,
  params: { queuedAt: string; initiatedBy: string }
): AflTradeCalculationRun {
  const run = parseRun(unparsedRun);
  const latest = latestAttempt(run);
  if (latest.state !== 'failed') {
    return transitionError('invalid_transition', 'Only a failed attempt may be retried.');
  }
  if (!latest.result.retryable) {
    return transitionError('attempt_not_retryable', 'This failure is not marked retryable.');
  }

  const attemptNumber = latest.attemptNumber + 1;
  const attempt: AflTradeCalculationAttempt = {
    attemptId: createAflTradeContentAddress('calculation-attempt', {
      runId: run.runId,
      attemptNumber,
    }),
    attemptNumber,
    queuedAt: params.queuedAt,
    initiatedBy: params.initiatedBy,
    state: 'queued',
  };

  return aflTradeCalculationRunSchema.parse({
    ...run,
    state: 'queued',
    attempts: [...run.attempts, attempt],
    candidatePublicationId: null,
    candidateProjectionId: null,
    updatedAt: params.queuedAt,
  });
}

export function assessAflTradeCalculationServingDisposition(
  unparsedRun: AflTradeCalculationRun
): AflTradeCalculationServingDisposition {
  const run = parseRun(unparsedRun);
  if (run.state === 'succeeded') {
    return {
      action: 'candidate_requires_governance',
      reason: 'calculation_succeeded',
      lastGood: run.lastGoodAtStart,
      candidatePublicationId: run.candidatePublicationId!,
      candidateProjectionId: run.candidateProjectionId!,
    };
  }

  return {
    action: 'retain_last_good',
    reason: 'run_not_successful',
    lastGood: run.lastGoodAtStart,
    candidatePublicationId: null,
    candidateProjectionId: null,
  };
}
