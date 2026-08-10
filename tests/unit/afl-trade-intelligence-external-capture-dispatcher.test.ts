import { describe, expect, it, vi } from 'vitest';

import { dispatchDueAflTradeExternalCaptures } from '@/server/aflTradeIntelligence/source/externalDraftTradeCaptureDispatcher';

const digest = (character: string) => character.repeat(64);

describe('external draft/trade capture dispatcher', () => {
  it('runs one bounded oldest-first tick and isolates a failed claim', async () => {
    const first = {
      scheduleId: `external-capture-schedule:${digest('1')}`,
      dueAt: '2026-08-10T00:00:00.000Z',
    };
    const second = {
      scheduleId: `external-capture-schedule:${digest('2')}`,
      dueAt: '2026-08-10T00:05:00.000Z',
    };
    const listDue = vi.fn(async () => [first, second]);
    const runOccurrence = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('lost race'), { code: 'LEASE_LOST' }))
      .mockResolvedValueOnce({
        status: 'completed',
        captureStatus: 'staged',
        resultId: `external-evidence-batch:${digest('3')}`,
      });
    const tokens = [digest('a'), digest('b')];

    await expect(
      dispatchDueAflTradeExternalCaptures(
        {
          environment: 'production',
          observedAt: '2026-08-10T00:10:00.000Z',
          workerId: 'production-capture-worker-1',
          maximumOccurrences: 2,
        },
        {
          repository: { listDue },
          createLeaseTokenSha256: () => tokens.shift()!,
          runOccurrence,
        }
      )
    ).resolves.toEqual({
      observedAt: '2026-08-10T00:10:00.000Z',
      selectedCount: 2,
      saturated: true,
      results: [
        { ...first, status: 'dispatch_failed', failureCode: 'LEASE_LOST' },
        {
          ...second,
          status: 'completed',
          result: {
            status: 'completed',
            captureStatus: 'staged',
            resultId: `external-evidence-batch:${digest('3')}`,
          },
        },
      ],
    });
    expect(listDue).toHaveBeenCalledWith({
      environment: 'production',
      observedAt: '2026-08-10T00:10:00.000Z',
      limit: 2,
    });
    expect(runOccurrence.mock.calls).toEqual([
      [
        {
          ...first,
          observedAt: '2026-08-10T00:10:00.000Z',
          workerId: 'production-capture-worker-1',
          leaseTokenSha256: digest('a'),
        },
      ],
      [
        {
          ...second,
          observedAt: '2026-08-10T00:10:00.000Z',
          workerId: 'production-capture-worker-1',
          leaseTokenSha256: digest('b'),
        },
      ],
    ]);
  });
});
