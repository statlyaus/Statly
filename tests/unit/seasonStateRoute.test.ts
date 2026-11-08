import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.hoisted(() => vi.fn());
const getAuthorizedLeagueSeasonStateMock = vi.hoisted(() => vi.fn());
const canManageLeagueMock = vi.hoisted(() => vi.fn());
const changeLeagueSeasonYearMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));
vi.mock('@/server/leagues/seasonState', () => ({
  getAuthorizedLeagueSeasonState: getAuthorizedLeagueSeasonStateMock,
}));
vi.mock('@/server/leagues/membership', () => ({
  canManageLeague: canManageLeagueMock,
}));
vi.mock('@/server/leagues/changeSeasonYear', () => ({
  changeLeagueSeasonYear: changeLeagueSeasonYearMock,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { GET, PUT } from '@/app/api/leagues/[id]/season-state/route';

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

function putRequest(body: unknown) {
  return new NextRequest('http://localhost/api/leagues/league-1/season-state', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('PUT /api/leagues/[id]/season-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('owner');
    canManageLeagueMock.mockResolvedValue(true);
    changeLeagueSeasonYearMock.mockResolvedValue({ ok: true, year: 2027 });
  });

  it('requires authentication', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);

    const response = await PUT(putRequest({ year: 2027 }), context);

    expect(response.status).toBe(401);
    expect(changeLeagueSeasonYearMock).not.toHaveBeenCalled();
  });

  it('lets only a commissioner change the season', async () => {
    canManageLeagueMock.mockResolvedValue(false);

    const response = await PUT(putRequest({ year: 2027 }), context);

    expect(response.status).toBe(403);
    expect(changeLeagueSeasonYearMock).not.toHaveBeenCalled();
  });

  it.each([['2027'], [2027.5], [1999], [2100], [null]])(
    'rejects a season year of %s',
    async (year) => {
      const response = await PUT(putRequest({ year }), context);

      expect(response.status).toBe(400);
      expect(changeLeagueSeasonYearMock).not.toHaveBeenCalled();
    }
  );

  it('changes the season and returns it', async () => {
    const response = await PUT(putRequest({ year: 2027 }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { year: 2027 } });
    expect(changeLeagueSeasonYearMock).toHaveBeenCalledWith({ leagueId: 'league-1', year: 2027 });
  });

  it('passes on the setup-only refusal', async () => {
    changeLeagueSeasonYearMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'The season can only change while the competition is in setup.',
    });

    const response = await PUT(putRequest({ year: 2027 }), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'The season can only change while the competition is in setup.',
    });
  });
});
