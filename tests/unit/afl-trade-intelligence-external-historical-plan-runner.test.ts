import { describe, expect, it, vi } from 'vitest';

import { runAflTradeExternalHistoricalCapturePlanPage } from '@/server/aflTradeIntelligence/source/externalHistoricalCapturePlanRunner';

const sha = (character: string) => character.repeat(64);

function target(ordinal: number) {
  const scheduleId = `external-capture-schedule:${sha(String(ordinal))}`;
  return {
    targetId: `external-capture-target:${sha(String(ordinal + 3))}`,
    content: {
      ordinal,
      discoveryEvidenceId: null,
      schedule: {
        scheduleId,
        definition: {
          cadence: { anchorAt: '2026-08-10T00:01:00.000Z' },
        },
      },
    },
  } as never;
}

describe('external historical capture plan runner', () => {
  it('advances only across terminal target outcomes and returns the next durable cursor', async () => {
    const targets = [target(1), target(2)];
    const runCapture = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'completed',
        captureStatus: 'staged',
        resultId: `external-evidence-batch:${sha('a')}`,
      })
      .mockResolvedValueOnce({ status: 'not_run', action: 'deduplicate', retryAt: null });

    const result = await runAflTradeExternalHistoricalCapturePlanPage(
      {
        planId: `external-historical-capture-plan:${sha('f')}`,
        afterOrdinal: 0,
        maximumTargets: 2,
        workerId: 'history-worker',
      },
      {
        loadPlanPage: vi.fn().mockResolvedValue({
          planId: `external-historical-capture-plan:${sha('f')}`,
          targetCount: 3,
          afterOrdinal: 0,
          targets,
          nextAfterOrdinal: 2,
        }),
        runCapture,
        clock: { now: () => '2026-08-10T00:02:00.000Z' },
        createLeaseTokenSha256: (ordinal) => sha(String(ordinal + 5)),
      }
    );

    expect(result).toMatchObject({
      status: 'page_completed',
      completedThroughOrdinal: 2,
      nextAfterOrdinal: 2,
      targetCount: 3,
    });
    expect(result.results).toHaveLength(2);
    expect(runCapture).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dueAt: '2026-08-10T00:01:00.000Z',
        workerId: 'history-worker',
      })
    );
  });

  it('stops without advancing past a retryable or deferred target', async () => {
    const targets = [target(5), target(6)];
    const runCapture = vi.fn().mockResolvedValue({
      status: 'retry_scheduled',
      failureCode: 'PROVIDER_ADMISSION_DEFERRED',
    });

    const result = await runAflTradeExternalHistoricalCapturePlanPage(
      {
        planId: `external-historical-capture-plan:${sha('f')}`,
        afterOrdinal: 4,
        maximumTargets: 2,
        workerId: 'history-worker',
      },
      {
        loadPlanPage: vi.fn().mockResolvedValue({
          planId: `external-historical-capture-plan:${sha('f')}`,
          targetCount: 6,
          afterOrdinal: 4,
          targets,
          nextAfterOrdinal: null,
        }),
        runCapture,
        clock: { now: () => '2026-08-10T00:02:00.000Z' },
        createLeaseTokenSha256: () => sha('8'),
      }
    );

    expect(result).toMatchObject({
      status: 'blocked',
      completedThroughOrdinal: 4,
      nextAfterOrdinal: 4,
      blockedTargetOrdinal: 5,
    });
    expect(runCapture).toHaveBeenCalledOnce();
  });

  it('reports a fully consumed plan without invoking capture', async () => {
    const runCapture = vi.fn();
    const result = await runAflTradeExternalHistoricalCapturePlanPage(
      {
        planId: `external-historical-capture-plan:${sha('f')}`,
        afterOrdinal: 3,
        maximumTargets: 10,
        workerId: 'history-worker',
      },
      {
        loadPlanPage: vi.fn().mockResolvedValue({
          planId: `external-historical-capture-plan:${sha('f')}`,
          targetCount: 3,
          afterOrdinal: 3,
          targets: [],
          nextAfterOrdinal: null,
        }),
        runCapture,
        clock: { now: () => '2026-08-10T00:02:00.000Z' },
        createLeaseTokenSha256: () => sha('8'),
      }
    );

    expect(result).toMatchObject({
      status: 'plan_completed',
      completedThroughOrdinal: 3,
      nextAfterOrdinal: null,
    });
    expect(runCapture).not.toHaveBeenCalled();
  });
});
