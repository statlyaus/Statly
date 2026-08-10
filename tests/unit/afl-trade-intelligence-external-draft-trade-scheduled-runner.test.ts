import { describe, expect, it, vi } from 'vitest';

import { runScheduledAflTradeExternalCapture } from '@/server/aflTradeIntelligence/source/externalDraftTradeScheduledRunner';

const digest = (character: string) => character.repeat(64);
const claim = {
  claimId: `external-capture-claim:${digest('1')}`,
  dispatchKey: `external-capture-dispatch:${digest('2')}`,
  scheduleId: `external-capture-schedule:${digest('3')}`,
  dueAt: '2026-08-09T12:00:00.000Z',
  attemptNumber: 1,
  claimedAt: '2026-08-09T12:00:01.000Z',
  leaseExpiresAt: '2026-08-09T12:15:01.000Z',
  workerId: 'runner-test',
  leaseTokenSha256: digest('4'),
};
const input = {
  scheduleId: claim.scheduleId,
  dueAt: claim.dueAt,
  observedAt: claim.claimedAt,
  workerId: claim.workerId,
  leaseTokenSha256: claim.leaseTokenSha256,
};
const command = {
  request: {
    environment: 'test_fixture' as const,
    provider: 'draftguru' as const,
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    draftPathway: null,
    dataset: 'fixture',
    datasetVersion: 'v1',
    accessMechanism: 'automated_web',
    capabilityId: 'draftguru-trade-detail',
    sourceUrl: 'https://www.draftguru.com.au/trades/2025-fixture',
    capturedAt: claim.claimedAt,
    effectiveAt: '2025-10-15T00:00:00.000Z',
    parserVersion: 'v1',
    fieldManifestSha256: digest('5'),
    maximumBytes: 1_024,
  },
  gateRequest: {} as never,
};

function dependencies(action: 'claim' | 'defer_lease' = 'claim') {
  const complete = vi.fn(async () => undefined);
  return {
    complete,
    value: {
      clock: { now: () => '2026-08-09T12:00:02.000Z' },
      repository: {
        claim: vi.fn(async () => ({
          action,
          retryAt: action === 'claim' ? null : claim.leaseExpiresAt,
          proposedClaim: action === 'claim' ? claim : null,
          command: action === 'claim' ? command : null,
        })),
        complete,
      },
      ingest: vi.fn(),
    },
  };
}

describe('scheduled external draft/trade capture runner', () => {
  it('does not call ingestion when the durable occurrence is deferred', async () => {
    const fixture = dependencies('defer_lease');
    await expect(runScheduledAflTradeExternalCapture(input, fixture.value)).resolves.toEqual({
      status: 'not_run',
      action: 'defer_lease',
      retryAt: claim.leaseExpiresAt,
    });
    expect(fixture.value.ingest).not.toHaveBeenCalled();
  });

  it('binds a staged batch to successful scheduler completion', async () => {
    const fixture = dependencies();
    fixture.value.ingest.mockResolvedValue({
      status: 'completed',
      result: {
        status: 'staged',
        captureId: `source-capture:${digest('6')}`,
        artifactId: `artifact:${digest('7')}`,
        batchId: `external-evidence-batch:${digest('8')}`,
        evidenceCount: 3,
        issueCount: 0,
        idempotentReplay: false,
      },
    });
    await expect(runScheduledAflTradeExternalCapture(input, fixture.value)).resolves.toEqual({
      status: 'completed',
      captureStatus: 'staged',
      resultId: `external-evidence-batch:${digest('8')}`,
    });
    expect(fixture.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        claim,
        outcome: { status: 'completed', resultId: `external-evidence-batch:${digest('8')}` },
      })
    );
  });

  it('binds a 304 to its persisted observation identity', async () => {
    const fixture = dependencies();
    fixture.value.ingest.mockResolvedValue({
      status: 'completed',
      result: { status: 'not_modified', attemptId: `capture-attempt:${digest('9')}` },
    });
    const result = await runScheduledAflTradeExternalCapture(input, fixture.value);
    expect(result).toMatchObject({
      status: 'completed',
      captureStatus: 'not_modified',
      resultId: `capture-attempt:${digest('9')}`,
    });
  });

  it('records bounded retry state for admission deferral and ingestion failure', async () => {
    const deferred = dependencies();
    deferred.value.ingest.mockResolvedValue({
      status: 'deferred',
      retryAt: '2026-08-09T12:01:00.000Z',
    });
    await expect(runScheduledAflTradeExternalCapture(input, deferred.value)).resolves.toEqual({
      status: 'retry_scheduled',
      failureCode: 'PROVIDER_ADMISSION_DEFERRED',
    });

    const failed = dependencies();
    failed.value.ingest.mockRejectedValue(Object.assign(new Error('network'), { code: 'NETWORK' }));
    await expect(runScheduledAflTradeExternalCapture(input, failed.value)).resolves.toEqual({
      status: 'retry_scheduled',
      failureCode: 'NETWORK',
    });
    expect(failed.complete).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: { status: 'failed', failureCode: 'NETWORK' } })
    );
  });
});
