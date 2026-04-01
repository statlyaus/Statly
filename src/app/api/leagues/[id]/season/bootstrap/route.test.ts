import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const bootstrapLeagueSeasonMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/authBypass', () => ({
  isAuthBypassEnabled: () => true,
}));

vi.mock('@/lib/leagueSeason', () => ({
  bootstrapLeagueSeason: bootstrapLeagueSeasonMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueMember: {
      findFirst: findFirstMock,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('POST /api/leagues/[id]/season/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    bootstrapLeagueSeasonMock.mockResolvedValue({
      leagueId: 'league-1',
      season: 2026,
      matchupCount: 12,
      weekCount: 6,
      currentWeek: 2,
      standingsCount: 4,
    });
  });

  it('bootstraps the requested season', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/leagues/league-1/season/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ season: 2026 }),
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(bootstrapLeagueSeasonMock).toHaveBeenCalledWith({ leagueId: 'league-1', season: 2026 });
    expect(body.data).toMatchObject({
      leagueId: 'league-1',
      season: 2026,
      currentWeek: 2,
    });
  });
});
