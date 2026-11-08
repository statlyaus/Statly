import { describe, expect, it, vi } from 'vitest';

const findManyMock = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { teamAction: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { isWaiverRunHour, processDueLeagueWaivers, todaysWaiverRunAt } from './waiverSchedule';

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

// Melbourne standard time (UTC+10): 6 am on 15 July is 20:00 UTC on the 14th.
const SIX_AM = new Date('2026-07-14T20:00:00Z');
const NINE_AM = new Date('2026-07-14T23:00:00Z');

describe('catching up a missed daily waiver run', () => {
  it('runs at 9 am the claims that were due at a missed 6 am run, and no later ones', async () => {
    findManyMock.mockReset().mockResolvedValue([{ leagueId: 'league-a' }]);
    const service = { processLeague: vi.fn(async () => ({ processed: 1, results: [] })) };

    const run = await processDueLeagueWaivers(NINE_AM, service);

    expect(run).toEqual({
      ran: true,
      leagues: [{ leagueId: 'league-a', processed: 1, results: [] }],
      failedLeagueIds: [],
    });
    // Only claims due by today's 6 am run: a claim due at 7 am waits for tomorrow's run.
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ processingAt: null }, { processingAt: { lte: SIX_AM } }],
        }),
      })
    );
    expect(service.processLeague).toHaveBeenCalledWith({ leagueId: 'league-a', dueBy: SIX_AM });
  });

  it('does nothing at 9 am when the 6 am run completed and left no claim due by 6 am', async () => {
    findManyMock.mockReset().mockResolvedValue([]);
    const service = { processLeague: vi.fn() };

    const run = await processDueLeagueWaivers(NINE_AM, service);

    expect(run).toEqual({ ran: false, leagues: [], failedLeagueIds: [] });
    expect(service.processLeague).not.toHaveBeenCalled();
  });

  it('runs the next day at 6 am as before, with every claim due by then', async () => {
    const nextSixAm = new Date('2026-07-15T20:00:00Z');
    findManyMock.mockReset().mockResolvedValue([{ leagueId: 'league-a' }]);
    const service = { processLeague: vi.fn(async () => ({ processed: 1, results: [] })) };

    const run = await processDueLeagueWaivers(nextSixAm, service);

    expect(run.ran).toBe(true);
    expect(service.processLeague).toHaveBeenCalledWith({ leagueId: 'league-a', dueBy: nextSixAm });
  });

  it('never runs before 6 am: a missed run is caught up only on its own Melbourne day', async () => {
    findManyMock.mockReset();
    const service = { processLeague: vi.fn() };

    // 5 am Melbourne on 15 July, the hour before that day's run.
    const run = await processDueLeagueWaivers(new Date('2026-07-14T19:00:00Z'), service);

    expect(run).toEqual({ ran: false, leagues: [], failedLeagueIds: [] });
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("today's waiver run instant", () => {
  it.each([
    // Daylight saving (UTC+11): 6 am on 15 January is 19:00 UTC on the 14th.
    ['2026-01-14T18:59:59Z', null],
    ['2026-01-14T19:30:00Z', '2026-01-14T19:00:00.000Z'],
    ['2026-01-15T12:59:59Z', '2026-01-14T19:00:00.000Z'],
    // Midnight Melbourne starts a new day whose run has not come yet.
    ['2026-01-15T13:00:00Z', null],
    // Standard time (UTC+10).
    ['2026-07-14T23:00:00Z', '2026-07-14T20:00:00.000Z'],
    // 5 April 2026, the day daylight saving ends: 6 am AEST is 20:00 UTC on the 4th.
    ['2026-04-05T01:00:00Z', '2026-04-04T20:00:00.000Z'],
  ])('at %s is %s', (instant, expected) => {
    expect(todaysWaiverRunAt(new Date(instant))?.toISOString() ?? null).toBe(expected);
  });
});
