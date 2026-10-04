import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getLeagueMembership: vi.fn(),
  loadLeagueStandingsHistory: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/lib/leagueMembership', () => ({ getLeagueMembership: mocks.getLeagueMembership }));
vi.mock('@/server/leagues/standingsHistoryLoader', () => ({
  loadLeagueStandingsHistory: mocks.loadLeagueStandingsHistory,
}));

import { GET } from './route';

const params = { params: Promise.resolve({ id: 'league-1' }) };
const request = () => new NextRequest('http://localhost/api/leagues/league-1/standings');

describe('GET /api/leagues/[id]/standings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.getLeagueMembership.mockResolvedValue({ isMember: true, memberDocId: 'member-1' });
  });

  it('requires a signed-in league member', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(401);

    mocks.getAuthenticatedUserId.mockResolvedValue('user-2');
    mocks.getLeagueMembership.mockResolvedValue({ isMember: false });
    expect((await GET(request(), params)).status).toBe(403);
    expect(mocks.loadLeagueStandingsHistory).not.toHaveBeenCalled();
  });

  it('returns 404 for a league without settings', async () => {
    mocks.loadLeagueStandingsHistory.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(404);
  });

  it('returns the history with the viewer member id', async () => {
    mocks.loadLeagueStandingsHistory.mockResolvedValue({
      teams: [],
      rounds: [],
      completedRounds: [],
      liveRound: null,
      finalsTeams: 4,
      regularSeasonRounds: 11,
    });

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: expect.objectContaining({ finalsTeams: 4, viewerMemberId: 'member-1' }),
    });
    expect(mocks.loadLeagueStandingsHistory).toHaveBeenCalledWith('league-1');
  });
});
