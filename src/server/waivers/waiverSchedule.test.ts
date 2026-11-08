import { describe, expect, it, vi } from 'vitest';

const findManyMock = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { teamAction: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { isWaiverRunHour, processDueLeagueWaivers } from './waiverSchedule';

describe('daily waiver run hour', () => {
  it.each([
    // Melbourne daylight saving (UTC+11): 6 am on 15 January is 19:00 UTC on the 14th.
    ['2026-01-14T18:59:59Z', false],
    ['2026-01-14T19:00:00Z', true],
    ['2026-01-14T19:59:59Z', true],
    ['2026-01-14T20:00:00Z', false],
    // Melbourne standard time (UTC+10): 6 am on 15 July is 20:00 UTC on the 14th.
    ['2026-07-14T19:00:00Z', false],
    ['2026-07-14T20:00:00Z', true],
    ['2026-07-14T21:00:00Z', false],
  ])('at %s is %s', (instant, expected) => {
    expect(isWaiverRunHour(new Date(instant))).toBe(expected);
  });
});

describe('daily waiver run across leagues', () => {
  it('keeps processing other leagues and reports the leagues that failed', async () => {
    findManyMock.mockResolvedValue([{ leagueId: 'league-a' }, { leagueId: 'league-b' }]);
    const service = {
      processLeague: vi.fn(async ({ leagueId }: { leagueId: string }) => {
        if (leagueId === 'league-a') throw new Error('database unavailable');
        return { processed: 2, results: [] };
      }),
    };

    const run = await processDueLeagueWaivers(new Date('2026-07-14T20:00:00Z'), service);

    expect(run).toEqual({
      ran: true,
      leagues: [{ leagueId: 'league-b', processed: 2, results: [] }],
      failedLeagueIds: ['league-a'],
    });
  });
});
