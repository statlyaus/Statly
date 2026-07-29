import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.hoisted(() => vi.fn());
const getAuthorizedLeagueSeasonStateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));
vi.mock('@/server/leagues/seasonState', () => ({
  getAuthorizedLeagueSeasonState: getAuthorizedLeagueSeasonStateMock,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { GET } from '@/app/api/leagues/[id]/season-state/route';

function request() {
  return new NextRequest('http://localhost/api/leagues/league-1/season-state');
}

const context = { params: Promise.resolve({ id: 'league-1' }) };

describe('GET /api/leagues/[id]/season-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);

    const response = await GET(request(), context);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' });
    expect(getAuthorizedLeagueSeasonStateMock).not.toHaveBeenCalled();
  });

  it('delegates member-scoped reads and returns an empty setup schedule', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    getAuthorizedLeagueSeasonStateMock.mockResolvedValue({
      ok: true,
      data: {
        leagueId: 'league-1',
        season: null,
        competitionStatus: 'SETUP',
        fixtureVersion: 0,
        schedule: [],
      },
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        leagueId: 'league-1',
        season: null,
        competitionStatus: 'SETUP',
        fixtureVersion: 0,
        schedule: [],
      },
    });
    expect(getAuthorizedLeagueSeasonStateMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      userId: 'user-1',
    });
  });

  it.each([
    [403, 'Forbidden'],
    [404, 'League not found'],
  ])('preserves service error status %s', async (status, error) => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    getAuthorizedLeagueSeasonStateMock.mockResolvedValue({ ok: false, status, error });

    const response = await GET(request(), context);

    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({ success: false, error });
  });

  it('returns a private error response when the season-state service fails unexpectedly', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    getAuthorizedLeagueSeasonStateMock.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(request(), context);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Failed to load league season state',
    });
  });
});
