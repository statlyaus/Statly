import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const refreshLiveStatsIfNeededMock = vi.fn();
const ensureLeagueSeasonMaterializedMock = vi.fn();
const getMaterializedSeasonFreshnessMock = vi.fn();
const getComputedLeagueSeasonStateMock = vi.fn();
const getComputedLeagueRoundMock = vi.fn();
const loadMaterializedMatchupsForRoundMock = vi.fn();
const loadMaterializedSeasonSnapshotsMock = vi.fn();
const selectComputedLeagueRoundMatchupsMock = vi.fn();
const getCachedSlateMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/liveStatsRefresh', () => ({
  refreshLiveStatsIfNeeded: refreshLiveStatsIfNeededMock,
}));

vi.mock('@/lib/leagueSeason', () => ({
  ensureLeagueSeasonMaterialized: ensureLeagueSeasonMaterializedMock,
  getMaterializedSeasonFreshness: getMaterializedSeasonFreshnessMock,
  getComputedLeagueSeasonState: getComputedLeagueSeasonStateMock,
  getComputedLeagueRound: getComputedLeagueRoundMock,
  loadMaterializedMatchupsForRound: loadMaterializedMatchupsForRoundMock,
  loadMaterializedSeasonSnapshots: loadMaterializedSeasonSnapshotsMock,
  selectComputedLeagueRoundMatchups: selectComputedLeagueRoundMatchupsMock,
}));

vi.mock('@/lib/leagueMatchupCache', () => ({
  buildOtherMatchupSummaries: vi.fn(() => []),
  buildSlateCacheKey: vi.fn(() => 'slate-key'),
  getCachedSlate: getCachedSlateMock,
  orientCachedMatchup: vi.fn(),
}));

const prismaMock = {
  leagueMember: { findFirst: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

describe('GET /api/leagues/[id]/matchup/stream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    refreshLiveStatsIfNeededMock.mockResolvedValue({
      refreshed: true,
      reason: 'refreshed',
      season: 2026,
      rounds: [5],
      liveMatchCount: 1,
    });
    ensureLeagueSeasonMaterializedMock.mockResolvedValue({
      bootstrapped: false,
      reason: null,
    });
    getMaterializedSeasonFreshnessMock.mockResolvedValue({
      stale: false,
      reason: null,
    });
    prismaMock.leagueMember.findFirst.mockResolvedValue({ id: 'member-1' });

    const state = {
      scheduleWeeks: [
        {
          week: 5,
          aflRound: 5,
          roundLabel: 'Round 5',
          status: 'in_progress',
          matchupIds: ['matchup-1'],
          current: true,
        },
      ],
    };

    loadMaterializedSeasonSnapshotsMock.mockResolvedValue({
      scheduleWeeks: state.scheduleWeeks,
      memberSnapshots: [],
    });
    loadMaterializedMatchupsForRoundMock.mockResolvedValue([
      {
        id: 'matchup-1',
        participants: ['user-1', 'user-2'],
        homeUserId: 'user-1',
        awayUserId: 'user-2',
        current: true,
        aflRound: 5,
        roundLabel: 'Round 5',
      },
    ]);
    getComputedLeagueSeasonStateMock.mockResolvedValue(state);
    getComputedLeagueRoundMock.mockImplementation(
      ({ state: inputState }: { state: typeof state }) =>
        inputState.scheduleWeeks.find((week) => week.current)?.aflRound ?? null
    );
    selectComputedLeagueRoundMatchupsMock.mockReturnValue([
      {
        id: 'matchup-1',
        participants: ['user-1', 'user-2'],
        homeUserId: 'user-1',
        awayUserId: 'user-2',
        current: true,
        aflRound: 5,
        roundLabel: 'Round 5',
      },
    ]);
    getCachedSlateMock.mockResolvedValue(null);
  });

  it('resolves materialized matchup snapshots first and keeps maintenance off the startup hot path', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest(
        'http://localhost/api/leagues/league-1/matchup/stream?categories=goals,tackles'
      ),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(loadMaterializedSeasonSnapshotsMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(loadMaterializedMatchupsForRoundMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
      round: 5,
    });
    expect(refreshLiveStatsIfNeededMock).toHaveBeenCalledWith({
      minIntervalMs: 30_000,
      trigger: 'league-matchup-stream',
      season: 2026,
    });
    expect(getMaterializedSeasonFreshnessMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
    expect(ensureLeagueSeasonMaterializedMock).not.toHaveBeenCalled();
    expect(getComputedLeagueSeasonStateMock).not.toHaveBeenCalled();
  });

  it('throttles maintenance across concurrent stream connections for the same league', async () => {
    getMaterializedSeasonFreshnessMock.mockResolvedValue({
      stale: true,
      reason: 'current_week_mismatch',
    });

    const { GET } = await import('./route');

    const [firstResponse, secondResponse] = await Promise.all([
      GET(
        new NextRequest(
          'http://localhost/api/leagues/league-1/matchup/stream?categories=goals,tackles'
        ),
        { params: Promise.resolve({ id: 'league-1' }) }
      ),
      GET(
        new NextRequest(
          'http://localhost/api/leagues/league-1/matchup/stream?categories=goals,tackles'
        ),
        { params: Promise.resolve({ id: 'league-1' }) }
      ),
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(refreshLiveStatsIfNeededMock).toHaveBeenCalledTimes(1);
    expect(getMaterializedSeasonFreshnessMock).toHaveBeenCalledTimes(1);
    expect(ensureLeagueSeasonMaterializedMock).toHaveBeenCalledTimes(1);
    expect(ensureLeagueSeasonMaterializedMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      season: 2026,
    });
  });
});
