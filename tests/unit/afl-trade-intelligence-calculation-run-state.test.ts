import { describe, expect, it } from 'vitest';

import {
  assessAflTradeCalculationServingDisposition,
  cancelAflTradeCalculationAttempt,
  failAflTradeCalculationAttempt,
  heartbeatAflTradeCalculationAttempt,
  queueAflTradeCalculationRun,
  retryAflTradeCalculationRun,
  startAflTradeCalculationAttempt,
  succeedAflTradeCalculationAttempt,
} from '@/server/aflTradeIntelligence/operations/calculationRunState';
import type {
  AflTradeCalculationRun,
  AflTradeCalculationRunInputs,
} from '@/server/aflTradeIntelligence/operations/calculationRunContracts';

const digest = (character: string) => character.repeat(64);

function artifact(character: string, createdAt = '2026-08-05T01:00:00.000Z') {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt,
  };
}

const lastGood = {
  scopeKey: 'public-afl-trades-current',
  publicationId: `publication:${digest('f')}`,
  projectionId: `projection:${digest('1')}`,
  registryRevision: 7,
  activatedAt: '2026-08-04T00:00:00.000Z',
  capturedAt: '2026-08-05T00:00:00.000Z',
};

function inputs(): AflTradeCalculationRunInputs {
  return {
    schemaVersion: 'afl-trade-calculation-inputs/v1',
    environment: 'non_production',
    scopeKey: 'public-afl-trades-current',
    calculationAsOf: '2026-08-05T03:00:00.000Z',
    knowledgeCutoffAt: '2026-08-05T02:00:00.000Z',
    valuationBundleId: `valuation-bundle:${digest('a')}`,
    datasetIds: [`dataset:${digest('b')}`],
    evidenceManifestIds: [`evidence-manifest:${digest('c')}`],
    sourceRegisterIds: ['fixture-public-source'],
    requestedViews: ['at_trade', 'realized', 'remaining', 'current'],
    codeCommitSha: 'd'.repeat(40),
    configurationArtifact: artifact('e'),
  };
}

function queuedRun(): AflTradeCalculationRun {
  return queueAflTradeCalculationRun({
    inputs: inputs(),
    lastGoodAtStart: lastGood,
    queuedAt: '2026-08-05T03:05:00.000Z',
    initiatedBy: 'fixture-scheduler',
  });
}

function runningRun(): AflTradeCalculationRun {
  const queued = queuedRun();
  return startAflTradeCalculationAttempt(queued, {
    expectedAttemptId: queued.attempts[0].attemptId,
    workerIdentity: 'fixture-worker-1',
    leaseId: 'fixture-lease-1',
    startedAt: '2026-08-05T03:06:00.000Z',
    leaseExpiresAt: '2026-08-05T03:16:00.000Z',
  });
}

function successResult() {
  return {
    publicationId: `publication:${digest('2')}`,
    projectionId: `projection:${digest('3')}`,
    publicationManifestArtifact: artifact('4', '2026-08-05T03:08:00.000Z'),
    projectionManifestArtifact: artifact('5', '2026-08-05T03:08:00.000Z'),
    diagnosticsArtifact: artifact('6', '2026-08-05T03:08:00.000Z'),
  };
}

function failureResult(retryable = true) {
  return {
    classification: 'projection_failure' as const,
    retryable,
    reasonCode: 'fixture-projection-failure',
    message: 'The fabricated projection build failed.',
    diagnosticsArtifact: artifact('7', '2026-08-05T03:08:00.000Z'),
  };
}

function expectTransitionError(callback: () => unknown, code: string) {
  try {
    callback();
    throw new Error(`Expected transition error ${code}.`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('AFL trade-intelligence calculation-run transitions', () => {
  it('moves through lease ownership to a governed candidate without activating it', () => {
    const running = runningRun();
    const current = running.attempts.at(-1)!;
    const heartbeat = heartbeatAflTradeCalculationAttempt(running, {
      expectedAttemptId: current.attemptId,
      expectedLeaseId: 'fixture-lease-1',
      heartbeatAt: '2026-08-05T03:07:00.000Z',
      renewedLeaseExpiresAt: '2026-08-05T03:20:00.000Z',
    });
    const succeeded = succeedAflTradeCalculationAttempt(heartbeat, {
      expectedAttemptId: current.attemptId,
      expectedLeaseId: 'fixture-lease-1',
      finishedAt: '2026-08-05T03:08:00.000Z',
      result: successResult(),
    });

    expect(succeeded.state).toBe('succeeded');
    expect(succeeded.lastGoodAtStart).toEqual(lastGood);
    expect(assessAflTradeCalculationServingDisposition(succeeded)).toEqual({
      action: 'candidate_requires_governance',
      reason: 'calculation_succeeded',
      lastGood,
      candidatePublicationId: successResult().publicationId,
      candidateProjectionId: successResult().projectionId,
    });
  });

  it('retains last-good on failure and appends a content-addressed retry', () => {
    const running = runningRun();
    const current = running.attempts.at(-1)!;
    const failed = failAflTradeCalculationAttempt(running, {
      expectedAttemptId: current.attemptId,
      expectedLeaseId: 'fixture-lease-1',
      finishedAt: '2026-08-05T03:08:00.000Z',
      result: failureResult(),
    });

    expect(assessAflTradeCalculationServingDisposition(failed)).toEqual({
      action: 'retain_last_good',
      reason: 'run_not_successful',
      lastGood,
      candidatePublicationId: null,
      candidateProjectionId: null,
    });

    const retried = retryAflTradeCalculationRun(failed, {
      queuedAt: '2026-08-05T03:09:00.000Z',
      initiatedBy: 'fixture-retry-policy',
    });
    expect(retried.attempts).toHaveLength(2);
    expect(retried.attempts[1].attemptId).not.toBe(retried.attempts[0].attemptId);
    expect(retried.lastGoodAtStart).toEqual(lastGood);
    expectTransitionError(
      () =>
        startAflTradeCalculationAttempt(retried, {
          expectedAttemptId: retried.attempts[0].attemptId,
          workerIdentity: 'stale-worker',
          leaseId: 'stale-lease',
          startedAt: '2026-08-05T03:10:00.000Z',
          leaseExpiresAt: '2026-08-05T03:20:00.000Z',
        }),
      'stale_attempt'
    );
  });

  it('rejects expired worker activity and records expiry with matching chronology', () => {
    const running = runningRun();
    const current = running.attempts.at(-1)!;
    expectTransitionError(
      () =>
        heartbeatAflTradeCalculationAttempt(running, {
          expectedAttemptId: current.attemptId,
          expectedLeaseId: 'fixture-lease-1',
          heartbeatAt: '2026-08-05T03:06:00.000Z',
          renewedLeaseExpiresAt: '2026-08-05T03:20:00.000Z',
        }),
      'invalid_transition'
    );
    expectTransitionError(
      () =>
        heartbeatAflTradeCalculationAttempt(running, {
          expectedAttemptId: current.attemptId,
          expectedLeaseId: 'fixture-lease-1',
          heartbeatAt: '2026-08-05T03:16:00.000Z',
          renewedLeaseExpiresAt: '2026-08-05T03:26:00.000Z',
        }),
      'lease_expired'
    );
    expectTransitionError(
      () =>
        succeedAflTradeCalculationAttempt(running, {
          expectedAttemptId: current.attemptId,
          expectedLeaseId: 'fixture-lease-1',
          finishedAt: '2026-08-05T03:17:00.000Z',
          result: successResult(),
        }),
      'lease_expired'
    );
    expectTransitionError(
      () =>
        succeedAflTradeCalculationAttempt(running, {
          expectedAttemptId: current.attemptId,
          expectedLeaseId: 'fixture-lease-1',
          finishedAt: '2026-08-05T03:16:00.000Z',
          result: successResult(),
        }),
      'lease_expired'
    );

    const failed = failAflTradeCalculationAttempt(running, {
      expectedAttemptId: current.attemptId,
      expectedLeaseId: 'fixture-lease-1',
      finishedAt: '2026-08-05T03:16:00.000Z',
      result: {
        ...failureResult(),
        classification: 'lease_expired',
        reasonCode: 'fixture-lease-expired',
      },
    });
    expect(failed.state).toBe('failed');
  });

  it('rejects retries for terminal non-retryable failures', () => {
    const running = runningRun();
    const current = running.attempts.at(-1)!;
    const failed = failAflTradeCalculationAttempt(running, {
      expectedAttemptId: current.attemptId,
      expectedLeaseId: 'fixture-lease-1',
      finishedAt: '2026-08-05T03:08:00.000Z',
      result: failureResult(false),
    });

    expectTransitionError(
      () =>
        retryAflTradeCalculationRun(failed, {
          queuedAt: '2026-08-05T03:09:00.000Z',
          initiatedBy: 'fixture-retry-policy',
        }),
      'attempt_not_retryable'
    );
  });

  it('preserves execution evidence and last-good when running work is cancelled', () => {
    const running = runningRun();
    const current = running.attempts.at(-1)!;
    const cancelled = cancelAflTradeCalculationAttempt(running, {
      expectedAttemptId: current.attemptId,
      expectedLeaseId: 'fixture-lease-1',
      cancelledBy: 'fixture-operator',
      reason: 'Operator stopped a superseded run.',
      finishedAt: '2026-08-05T03:08:00.000Z',
    });
    const cancelledAttempt = cancelled.attempts.at(-1)!;

    expect(cancelledAttempt.state).toBe('cancelled');
    if (cancelledAttempt.state !== 'cancelled') throw new Error('Expected cancellation.');
    expect(cancelledAttempt.execution?.lease.leaseId).toBe('fixture-lease-1');
    expect(cancelled.lastGoodAtStart).toEqual(lastGood);
    expect(assessAflTradeCalculationServingDisposition(cancelled).action).toBe('retain_last_good');
  });

  it('cancels queued work without fabricating execution evidence', () => {
    const queued = queuedRun();
    const cancelled = cancelAflTradeCalculationAttempt(queued, {
      expectedAttemptId: queued.attempts[0].attemptId,
      cancelledBy: 'fixture-operator',
      reason: 'Operator removed a duplicate queued run.',
      finishedAt: '2026-08-05T03:06:00.000Z',
    });
    const attempt = cancelled.attempts[0];

    expect(attempt.state).toBe('cancelled');
    if (attempt.state !== 'cancelled') throw new Error('Expected cancellation.');
    expect(attempt.execution).toBeNull();
  });
});
