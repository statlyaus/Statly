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

function scored(
  round: number,
  status: 'SCHEDULED' | 'LIVE' | 'FINAL',
  matches: Array<{ matchId: string; startsAt: Date; status: 'scheduled' | 'live' | 'final' }>
) {
  return {
    round,
    status,
    recalculated: 2,
    scores: [],
    unresolvedMatchupIds: [] as string[],
    roundStatus: {
      earliestStartAt: matches[0]?.startsAt ?? null,
      latestEndAt: null,
      anyLive: matches.some((match) => match.status === 'live'),
      allFinal: matches.length > 0 && matches.every((match) => match.status === 'final'),
      hasUnavailableStatus: false,
      matches: matches.map((match) => ({ ...match, statusUnavailable: false })),
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
        reason: 'unavailable-stats',
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

  it('reports a round whose AFL matches never go final past the grace period', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 3)]);
    const recalculate = vi.fn(async () =>
      scored(3, 'LIVE', [
        { matchId: 'm1', startsAt: ROUND_START, status: 'final' },
        { matchId: 'm2', startsAt: lastMatchStart, status: 'live' },
        { matchId: 'm3', startsAt: lastMatchStart, status: 'scheduled' },
      ])
    );
    const now = new Date(lastMatchStart.getTime() + (STALLED_ROUND_GRACE_HOURS + 1) * HOUR);

    const run = await scoreStartedLeagueRounds(now, recalculate as never);

    expect(run.stalledRounds).toEqual([
      {
        leagueId: 'league-a',
        season: 2026,
        round: 3,
        status: 'LIVE',
        stalledSince: new Date(
          lastMatchStart.getTime() + STALLED_ROUND_GRACE_HOURS * HOUR
        ).toISOString(),
        reason: 'afl-matches-not-final',
        missingPlayerIds: [],
        aflMatchIdsNotFinal: ['m2', 'm3'],
      },
    ]);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Scheduled round scoring is stalled for a league round',
      expect.objectContaining({
        reason: 'afl-matches-not-final',
        aflMatchIdsNotFinal: ['m2', 'm3'],
      })
    );
  });

  it('reports a round held open by an unresolved matchup past the grace period', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 3)]);
    const recalculate = vi.fn(async () => ({
      ...scored(3, 'SCHEDULED', [
        { matchId: 'm1', startsAt: ROUND_START, status: 'final' },
        { matchId: 'm2', startsAt: lastMatchStart, status: 'final' },
      ]),
      unresolvedMatchupIds: ['matchup-7'],
    }));
    const now = new Date(lastMatchStart.getTime() + (STALLED_ROUND_GRACE_HOURS + 1) * HOUR);

    const run = await scoreStartedLeagueRounds(now, recalculate as never);

    expect(run.stalledRounds).toEqual([
      expect.objectContaining({
        leagueId: 'league-a',
        round: 3,
        status: 'SCHEDULED',
        reason: 'unresolved-matchups',
        missingPlayerIds: [],
        unresolvedMatchupIds: ['matchup-7'],
      }),
    ]);
    expect(run.failedLeagueIds).toEqual([]);
  });

  it('does not report an unfinished round inside the grace period', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 3)]);
    const recalculate = vi.fn(async () => ({
      ...scored(3, 'LIVE', [{ matchId: 'm2', startsAt: lastMatchStart, status: 'live' }]),
      unresolvedMatchupIds: ['matchup-7'],
    }));
    const now = new Date(lastMatchStart.getTime() + (STALLED_ROUND_GRACE_HOURS - 1) * HOUR);

    const run = await scoreStartedLeagueRounds(now, recalculate as never);

    expect(run.stalledRounds).toEqual([]);
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
