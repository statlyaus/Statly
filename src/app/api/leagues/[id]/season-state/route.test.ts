import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void Promise.resolve().then(callback);
    },
  };
});

const getAuthenticatedUserIdMock = vi.fn();
const ensureLeagueSeasonMaterializedMock = vi.fn();
const getMaterializedSeasonFreshnessMock = vi.fn();
const loadMaterializedSeasonSnapshotsMock = vi.fn();
const refreshLiveStatsIfNeededMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/leagueSeason', () => ({
  ensureLeagueSeasonMaterialized: ensureLeagueSeasonMaterializedMock,
  getMaterializedSeasonFreshness: getMaterializedSeasonFreshnessMock,
  loadMaterializedSeasonSnapshots: loadMaterializedSeasonSnapshotsMock,
}));

vi.mock('@/lib/liveStatsRefresh', () => ({
  refreshLiveStatsIfNeeded: refreshLiveStatsIfNeededMock,
}));

const prismaMock = {
  leagueMember: {
    findFirst: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GET /api/leagues/[id]/season-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    refreshLiveStatsIfNeededMock.mockResolvedValue({
      refreshed: false,
      reason: 'no_live_matches',
      season: 2026,
      rounds: [],
      liveMatchCount: 0,
    });
    ensureLeagueSeasonMaterializedMock.mockResolvedValue(undefined);
    getMaterializedSeasonFreshnessMock.mockResolvedValue({ stale: false, reason: null });
    prismaMock.leagueMember.findFirst.mockResolvedValue({ id: 'member-1' });
    loadMaterializedSeasonSnapshotsMock.mockResolvedValue({
      scheduleWeeks: [
        {
          week: 1,
          aflRound: 0,
          roundLabel: 'Opening Round',
          status: 'final',
          matchupIds: ['m-1', 'm-2'],
          current: false,
        },
        {
          week: 2,
          aflRound: 1,
          roundLabel: 'Round 1',
          status: 'in_progress',
          matchupIds: ['m-3', 'm-4'],
          current: true,
        },
      ],
      memberSnapshots: [
        {
          userId: 'user-3',
          teamName: 'Charlie',
          ladderRank: 1,
          record: { w: 1, l: 0, t: 0 },
          points: 2,
          categoriesWon: 6,
          categoriesLost: 3,
          categoriesTied: 1,
          scheduleWeek: 2,
          currentOpponentUserId: 'user-1',
          currentOpponentTeamName: 'Alpha',
        },
        {
          userId: 'user-1',
          teamName: 'Alpha',
          ladderRank: 2,
          record: { w: 0, l: 0, t: 1 },
          points: 1,
          categoriesWon: 5,
          categoriesLost: 4,
          categoriesTied: 1,
          scheduleWeek: 2,
          currentOpponentUserId: 'user-3',
          currentOpponentTeamName: 'Charlie',
        },
      ],
    });
  });

  it('returns ladder and schedule for the authenticated league member', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/leagues/league-1/season-state?season=2026'),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(loadMaterializedSeasonSnapshotsMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(ensureLeagueSeasonMaterializedMock).not.toHaveBeenCalled();
    expect(refreshLiveStatsIfNeededMock).toHaveBeenCalledWith({
      minIntervalMs: 30_000,
      trigger: 'league-season-state',
      season: 2026,
    });
    expect(getMaterializedSeasonFreshnessMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(body.data.currentWeek).toBe(2);
    expect(body.data.schedule).toEqual([
      {
        id: 'league-1:2026:1',
        season: 2026,
        week: 1,
        aflRound: 0,
        roundLabel: 'Opening Round',
        status: 'final',
        matchupCount: 2,
        current: false,
      },
      {
        id: 'league-1:2026:2',
        season: 2026,
        week: 2,
        aflRound: 1,
        roundLabel: 'Round 1',
        status: 'in_progress',
        matchupCount: 2,
        current: true,
      },
    ]);
    expect(body.data.ladder[0]).toEqual({
      userId: 'user-3',
      teamName: 'Charlie',
      ladderRank: 1,
      record: { w: 1, l: 0, t: 0 },
      points: 2,
      categoriesWon: 6,
      categoriesLost: 3,
      categoriesTied: 1,
      scheduleWeek: 2,
      currentOpponentUserId: 'user-1',
      currentOpponentTeamName: 'Alpha',
      isCurrentUser: false,
    });
    expect(body.data.ladder[1]).toEqual({
      userId: 'user-1',
      teamName: 'Alpha',
      ladderRank: 2,
      record: { w: 0, l: 0, t: 1 },
      points: 1,
      categoriesWon: 5,
      categoriesLost: 4,
      categoriesTied: 1,
      scheduleWeek: 2,
      currentOpponentUserId: 'user-3',
      currentOpponentTeamName: 'Charlie',
      isCurrentUser: true,
    });
  });
});
