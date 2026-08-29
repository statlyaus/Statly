import { describe, expect, it } from 'vitest';

import {
  createAflTradePrivateValuationDispatchEvidenceKey,
  createAflTradePrivateValuationDispatchRequestId,
  latestDueAflTradePrivateValuationOccurrence,
  planAflTradePrivateValuationStartupCatchUp,
} from '@/server/aflTradeIntelligence/valuation/privateValuationScheduling';

describe('private valuation scheduling', () => {
  it.each([
    ['2026-01-05T08:00:00.000Z', '2026-01-05T08:00:00.000Z'],
    ['2026-07-06T09:00:00.000Z', '2026-07-06T09:00:00.000Z'],
    ['2026-07-06T08:59:59.999Z', '2026-06-29T09:00:00.000Z'],
  ])('keeps Monday 19:00 on the Melbourne wall clock at %s', (now, expected) => {
    expect(latestDueAflTradePrivateValuationOccurrence(now)).toBe(expected);
  });

  it('coalesces missed weeks to the latest due occurrence and exactly replays it', () => {
    const occurrence = '2026-07-06T09:00:00.000Z';
    expect(
      planAflTradePrivateValuationStartupCatchUp({
        now: '2026-07-22T03:00:00.000Z',
        lastScheduledFor: '2026-06-01T09:00:00.000Z',
      })
    ).toBe('2026-07-20T09:00:00.000Z');
    expect(
      planAflTradePrivateValuationStartupCatchUp({
        now: occurrence,
        lastScheduledFor: occurrence,
      })
    ).toBeNull();
  });

  it('gives overlapping triggers a stable content-addressed request identity', () => {
    const request = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      scheduledFor: '2026-07-06T09:00:00.000Z',
      authorityKey: 'scheduled',
    };
    expect(createAflTradePrivateValuationDispatchRequestId(request)).toBe(
      createAflTradePrivateValuationDispatchRequestId(request)
    );
    expect(createAflTradePrivateValuationDispatchRequestId(request)).toMatch(
      /^private-valuation-dispatch:[a-f0-9]{64}$/
    );
  });

  it('uses the exact persisted dispatch identity as the evidence operation key', () => {
    const firstIdentity = {
      scopeKey: 'afl-men:2026-trades',
      trigger: 'weekly' as const,
      scheduledFor: '2026-07-06T09:00:00.000Z',
      authorityKey: 'scheduled',
    };
    const nextWeekIdentity = {
      ...firstIdentity,
      scheduledFor: '2026-07-13T09:00:00.000Z',
    };
    const anotherScopeIdentity = {
      ...firstIdentity,
      scopeKey: 'afl-men:2026-contenders',
    };
    const request = (identity: typeof firstIdentity) => {
      const requestId = createAflTradePrivateValuationDispatchRequestId(identity);
      return { requestId, ...identity };
    };

    const first = request(firstIdentity);
    const nextWeek = request(nextWeekIdentity);
    const anotherScope = request(anotherScopeIdentity);

    expect(createAflTradePrivateValuationDispatchEvidenceKey(first)).toBe(first.requestId);
    expect(createAflTradePrivateValuationDispatchEvidenceKey(nextWeek)).not.toBe(first.requestId);
    expect(createAflTradePrivateValuationDispatchEvidenceKey(anotherScope)).not.toBe(
      first.requestId
    );
  });
});
