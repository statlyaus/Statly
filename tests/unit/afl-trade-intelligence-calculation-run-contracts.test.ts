import { describe, expect, it } from 'vitest';

import {
  aflTradeCalculationRunSchema,
  createAflTradeCalculationAttemptId,
  createAflTradeCalculationRunId,
  type AflTradeCalculationRun,
  type AflTradeCalculationRunInputs,
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

function lastGood() {
  return {
    scopeKey: 'public-afl-trades-current',
    publicationId: `publication:${digest('f')}`,
    projectionId: `projection:${digest('1')}`,
    registryRevision: 7,
    activatedAt: '2026-08-04T00:00:00.000Z',
    capturedAt: '2026-08-05T00:00:00.000Z',
  };
}

function queuedRun(): AflTradeCalculationRun {
  const runInputs = inputs();
  const runId = createAflTradeCalculationRunId(runInputs);
  return {
    runId,
    inputs: runInputs,
    state: 'queued',
    attempts: [
      {
        attemptId: createAflTradeCalculationAttemptId(runId, 1),
        attemptNumber: 1,
        state: 'queued',
        queuedAt: '2026-08-05T03:05:00.000Z',
        initiatedBy: 'fixture-scheduler',
      },
    ],
    lastGoodAtStart: lastGood(),
    candidatePublicationId: null,
    candidateProjectionId: null,
    createdAt: '2026-08-05T03:05:00.000Z',
    updatedAt: '2026-08-05T03:05:00.000Z',
  };
}

function failedAttempt(runId: string, attemptNumber = 1) {
  return {
    attemptId: createAflTradeCalculationAttemptId(runId, attemptNumber),
    attemptNumber,
    state: 'failed' as const,
    queuedAt: '2026-08-05T03:05:00.000Z',
    initiatedBy: 'fixture-scheduler',
    startedAt: '2026-08-05T03:06:00.000Z',
    heartbeatAt: '2026-08-05T03:07:00.000Z',
    lease: {
      leaseId: 'fixture-lease-1',
      workerIdentity: 'fixture-worker-1',
      acquiredAt: '2026-08-05T03:06:00.000Z',
      expiresAt: '2026-08-05T03:16:00.000Z',
    },
    finishedAt: '2026-08-05T03:08:00.000Z',
    result: {
      classification: 'projection_failure' as const,
      retryable: true,
      reasonCode: 'fixture-projection-failure',
      message: 'The fabricated projection build failed.',
      diagnosticsArtifact: artifact('2', '2026-08-05T03:08:00.000Z'),
    },
  };
}

function succeededRun(): AflTradeCalculationRun {
  const run = queuedRun();
  const publicationId = `publication:${digest('3')}`;
  const projectionId = `projection:${digest('4')}`;
  return {
    ...run,
    state: 'succeeded',
    attempts: [
      {
        attemptId: createAflTradeCalculationAttemptId(run.runId, 1),
        attemptNumber: 1,
        state: 'succeeded',
        queuedAt: run.createdAt,
        initiatedBy: 'fixture-scheduler',
        startedAt: '2026-08-05T03:06:00.000Z',
        heartbeatAt: '2026-08-05T03:07:00.000Z',
        lease: {
          leaseId: 'fixture-lease-1',
          workerIdentity: 'fixture-worker-1',
          acquiredAt: '2026-08-05T03:06:00.000Z',
          expiresAt: '2026-08-05T03:16:00.000Z',
        },
        finishedAt: '2026-08-05T03:08:00.000Z',
        result: {
          publicationId,
          projectionId,
          publicationManifestArtifact: artifact('5', '2026-08-05T03:08:00.000Z'),
          projectionManifestArtifact: artifact('6', '2026-08-05T03:08:00.000Z'),
          diagnosticsArtifact: artifact('7', '2026-08-05T03:08:00.000Z'),
        },
      },
    ],
    candidatePublicationId: publicationId,
    candidateProjectionId: projectionId,
    updatedAt: '2026-08-05T03:08:00.000Z',
  };
}

describe('AFL trade-intelligence calculation-run contracts', () => {
  it('accepts a content-addressed queued run with an immutable last-good snapshot', () => {
    const parsed = aflTradeCalculationRunSchema.parse(queuedRun());

    expect(parsed.runId).toBe(createAflTradeCalculationRunId(parsed.inputs));
    expect(parsed.lastGoodAtStart).toEqual(lastGood());
    expect(parsed.candidatePublicationId).toBeNull();
  });

  it('changes logical run identity when any pinned calculation input changes', () => {
    const original = inputs();
    const changed = { ...original, calculationAsOf: '2026-08-06T03:00:00.000Z' };

    expect(createAflTradeCalculationRunId(changed)).not.toBe(
      createAflTradeCalculationRunId(original)
    );
    expect(
      aflTradeCalculationRunSchema.safeParse({ ...queuedRun(), inputs: changed }).success
    ).toBe(false);
  });

  it('rejects duplicate pins, temporal leakage, and fantasy ownership fields', () => {
    const run = queuedRun();
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        inputs: { ...run.inputs, datasetIds: [run.inputs.datasetIds[0], run.inputs.datasetIds[0]] },
      }).success
    ).toBe(false);
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        inputs: { ...run.inputs, knowledgeCutoffAt: '2026-08-06T00:00:00.000Z' },
      }).success
    ).toBe(false);
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
  });

  it('requires contiguous append-only attempts and chronological retries', () => {
    const run = queuedRun();
    const first = failedAttempt(run.runId);
    const second = {
      ...run.attempts[0],
      attemptId: createAflTradeCalculationAttemptId(run.runId, 2),
      attemptNumber: 2,
      queuedAt: '2026-08-05T03:09:00.000Z',
    };
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        state: 'queued',
        attempts: [first, second],
        updatedAt: second.queuedAt,
      }).success
    ).toBe(true);
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        attempts: [{ ...run.attempts[0], attemptNumber: 2 }],
      }).success
    ).toBe(false);
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        state: 'queued',
        attempts: [first, { ...second, queuedAt: '2026-08-05T03:07:30.000Z' }],
        updatedAt: '2026-08-05T03:07:30.000Z',
      }).success
    ).toBe(false);
  });

  it('requires successful candidates to match the exact terminal result', () => {
    const run = succeededRun();
    expect(aflTradeCalculationRunSchema.safeParse(run).success).toBe(true);
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        candidateProjectionId: `projection:${digest('8')}`,
      }).success
    ).toBe(false);
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...queuedRun(),
        candidatePublicationId: run.candidatePublicationId,
      }).success
    ).toBe(false);
  });

  it('rejects invalid last-good, lease, heartbeat, and run activity chronology', () => {
    const run = queuedRun();
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        lastGoodAtStart: { ...lastGood(), capturedAt: '2026-08-06T00:00:00.000Z' },
      }).success
    ).toBe(false);
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...run,
        lastGoodAtStart: { ...lastGood(), scopeKey: 'different-public-scope' },
      }).success
    ).toBe(false);

    const succeeded = succeededRun();
    const attempt = succeeded.attempts[0];
    if (attempt.state !== 'succeeded') throw new Error('Expected succeeded fixture.');
    expect(
      aflTradeCalculationRunSchema.safeParse({
        ...succeeded,
        attempts: [
          {
            ...attempt,
            heartbeatAt: '2026-08-05T03:17:00.000Z',
            finishedAt: '2026-08-05T03:18:00.000Z',
          },
        ],
        updatedAt: '2026-08-05T03:18:00.000Z',
      }).success
    ).toBe(false);
  });
});
