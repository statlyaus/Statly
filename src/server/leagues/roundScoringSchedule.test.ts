import { afterEach, describe, expect, it, vi } from 'vitest';

const findManyMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => loggerErrorMock(...args) },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { leagueCompetitionRound: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));

vi.mock('@/server/etl/etlRoundData', () => ({ getRoundMatches: vi.fn(async () => []) }));

vi.mock('@/server/leagues/matchupReadModel', () => ({
  recalculateLeagueRoundMatchups: vi.fn(),
}));

const { scoreStartedLeagueRounds, STALLED_ROUND_GRACE_HOURS } =
  await import('./roundScoringSchedule');

const HOUR = 60 * 60 * 1000;
const ROUND_START = new Date('2026-04-02T08:30:00Z');

function startedRound(leagueId: string, round: number, startsAt = ROUND_START) {
  return {
    leagueId,
    round,
    startsAt,
    season: { year: 2026 },
    fixtureVersion: 1,
    league: { settings: { competitionRulesVersion: 1 } },
  };
}

function unavailable(round: number, matchStarts: Date[], missingPlayerIds = ['player-9']) {
  return {
    round,
    status: 'SCHEDULED' as const,
    recalculated: 0,
    scores: [],
    missingPlayerIds,
    roundStatus: {
      earliestStartAt: matchStarts[0] ?? null,
      latestEndAt: null,
      anyLive: false,
      allFinal: false,
      hasUnavailableStatus: true,
      matches: matchStarts.map((startsAt, index) => ({
        matchId: `m${index}`,
        startsAt,
        status: 'final',
        statusUnavailable: false,
      })),
    },
  };
}

const lastMatchStart = new Date(ROUND_START.getTime() + 72 * HOUR);

describe('scoreStartedLeagueRounds stalled rounds', () => {
  afterEach(() => {
    findManyMock.mockReset();
    loggerErrorMock.mockReset();
  });

  it('reports a round still unavailable past the grace period after its last match', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 3)]);
    const recalculate = vi.fn(async () =>
      unavailable(3, [ROUND_START, lastMatchStart], ['player-1', 'player-2'])
    );
    const now = new Date(lastMatchStart.getTime() + (STALLED_ROUND_GRACE_HOURS + 1) * HOUR);

    const run = await scoreStartedLeagueRounds(now, recalculate as never);

    expect(run.stalledRounds).toEqual([
      {
        leagueId: 'league-a',
        season: 2026,
        round: 3,
        status: 'SCHEDULED',
        stalledSince: new Date(
          lastMatchStart.getTime() + STALLED_ROUND_GRACE_HOURS * HOUR
        ).toISOString(),
        missingPlayerIds: ['player-1', 'player-2'],
      },
    ]);
    expect(run.failedLeagueIds).toEqual([]);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Scheduled round scoring is stalled for a league round',
      expect.objectContaining({
        leagueId: 'league-a',
        round: 3,
        missingPlayerIds: ['player-1', 'player-2'],
      })
    );
  });

  it('does not report a round still inside the grace period after its last match', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 3)]);
    const recalculate = vi.fn(async () => unavailable(3, [ROUND_START, lastMatchStart]));
    // Long after the round started, but the last match was only a few hours ago.
    const now = new Date(lastMatchStart.getTime() + (STALLED_ROUND_GRACE_HOURS - 1) * HOUR);

    const run = await scoreStartedLeagueRounds(now, recalculate as never);

    expect(run.stalledRounds).toEqual([]);
    expect(run.leagues[0].rounds).toEqual([{ round: 3, status: 'SCHEDULED', recalculated: 0 }]);
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('falls back to the round start when no match times are known', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 3)]);
    const recalculate = vi.fn(async () => unavailable(3, []));
    const now = new Date(ROUND_START.getTime() + (STALLED_ROUND_GRACE_HOURS + 1) * HOUR);

    const run = await scoreStartedLeagueRounds(now, recalculate as never);

    expect(run.stalledRounds).toMatchObject([{ leagueId: 'league-a', round: 3 }]);
  });

  it('reports nothing stalled for a normally scored round', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 3)]);
    const recalculate = vi.fn(async () => ({
      round: 3,
      status: 'FINAL' as const,
      recalculated: 2,
      scores: [],
      roundStatus: { ...unavailable(3, [ROUND_START]).roundStatus, hasUnavailableStatus: false },
    }));
    const now = new Date(ROUND_START.getTime() + 30 * 24 * HOUR);

    const run = await scoreStartedLeagueRounds(now, recalculate as never);

    expect(run.stalledRounds).toEqual([]);
    expect(run.leagues[0].rounds).toEqual([{ round: 3, status: 'FINAL', recalculated: 2 }]);
  });
});
