import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthenticatedUserId, userProfileService, logger } = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  userProfileService: {
    getUserProfile: vi.fn(),
    updateWatchlist: vi.fn(),
    joinLeague: vi.fn(),
    getUserLeagues: vi.fn(),
    updateLeagueSettings: vi.fn(),
  },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/services/userProfileService', () => ({ userProfileService }));

import { GET as GET_LEAGUES, POST as POST_LEAGUES } from '@/app/api/user/leagues/route';
import {
  GET as GET_SETTINGS,
  PUT as PUT_SETTINGS,
} from '@/app/api/user/leagues/[id]/settings/route';
import { GET as GET_WATCHLISTS, POST as POST_WATCHLISTS } from '@/app/api/user/watchlists/route';

const actorUserId = 'actor-user';
const victimUserId = 'victim-user';
const leagueId = 'league-1';
const context = { params: Promise.resolve({ id: leagueId }) };

const profile = {
  id: 'profile-1',
  userId: actorUserId,
  displayName: 'Actor',
  email: 'actor@example.com',
  timezone: 'Australia/Melbourne',
  globalSettings: {},
  leagueMemberships: [
    {
      leagueId,
      role: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
      leagueSettings: { theme: 'light' },
    },
  ],
  watchlists: [],
  preferences: {},
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

function settingsPut(body: unknown = { settings: { theme: 'dark' }, userId: victimUserId }) {
  return PUT_SETTINGS(
    request(`/api/user/leagues/${leagueId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    context
  );
}

describe('authenticated user-scoped route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects every handler before service access when authentication is missing', async () => {
    getAuthenticatedUserId.mockResolvedValue(null);

    const responses = await Promise.all([
      GET_WATCHLISTS(request('/api/user/watchlists')),
      POST_WATCHLISTS(
        request('/api/user/watchlists', {
          method: 'POST',
          body: JSON.stringify({ name: 'Draft board', playerIds: ['player-1'] }),
        })
      ),
      GET_LEAGUES(request('/api/user/leagues')),
      POST_LEAGUES(
        request('/api/user/leagues', {
          method: 'POST',
          body: JSON.stringify({ leagueId, memberName: 'Actor' }),
        })
      ),
      GET_SETTINGS(request(`/api/user/leagues/${leagueId}/settings`), context),
      settingsPut(),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(userProfileService.getUserProfile).not.toHaveBeenCalled();
    expect(userProfileService.updateWatchlist).not.toHaveBeenCalled();
    expect(userProfileService.getUserLeagues).not.toHaveBeenCalled();
    expect(userProfileService.joinLeague).not.toHaveBeenCalled();
    expect(userProfileService.updateLeagueSettings).not.toHaveBeenCalled();
  });

  it('ignores client-supplied user identifiers and resolves the authenticated actor', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    userProfileService.getUserProfile.mockResolvedValue(profile);
    userProfileService.getUserLeagues.mockResolvedValue([]);
    userProfileService.updateWatchlist.mockResolvedValue({ id: 'watchlist-1' });
    userProfileService.joinLeague.mockResolvedValue({ id: 'membership-1' });
    userProfileService.updateLeagueSettings.mockResolvedValue({ theme: 'dark' });

    const responses = await Promise.all([
      GET_WATCHLISTS(request(`/api/user/watchlists?userId=${victimUserId}`)),
      POST_WATCHLISTS(
        request('/api/user/watchlists', {
          method: 'POST',
          body: JSON.stringify({
            userId: victimUserId,
            name: 'Draft board',
            playerIds: ['player-1'],
          }),
        })
      ),
      GET_LEAGUES(request(`/api/user/leagues?userId=${victimUserId}`)),
      POST_LEAGUES(
        request('/api/user/leagues', {
          method: 'POST',
          body: JSON.stringify({ userId: victimUserId, leagueId, memberName: 'Actor' }),
        })
      ),
      GET_SETTINGS(
        request(`/api/user/leagues/${leagueId}/settings?userId=${victimUserId}`),
        context
      ),
      settingsPut(),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 201, 200, 201, 200, 200]);

    expect(userProfileService.getUserProfile).toHaveBeenCalledWith(actorUserId);
    expect(userProfileService.getUserLeagues).toHaveBeenCalledWith(actorUserId, {});
    expect(userProfileService.updateWatchlist).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actorUserId })
    );
    expect(userProfileService.joinLeague).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actorUserId })
    );
    expect(userProfileService.updateLeagueSettings).toHaveBeenCalledWith(actorUserId, leagueId, {
      theme: 'dark',
    });

    const forwardedArguments = JSON.stringify([
      ...userProfileService.getUserProfile.mock.calls,
      ...userProfileService.updateWatchlist.mock.calls,
      ...userProfileService.getUserLeagues.mock.calls,
      ...userProfileService.joinLeague.mock.calls,
      ...userProfileService.updateLeagueSettings.mock.calls,
    ]);

    expect(forwardedArguments).not.toContain(victimUserId);
  });

  it('refuses to write league settings for a league the actor does not belong to', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    userProfileService.getUserProfile.mockResolvedValue({ ...profile, leagueMemberships: [] });

    const response = await settingsPut();

    expect(response.status).toBe(404);
    expect(userProfileService.updateLeagueSettings).not.toHaveBeenCalled();
  });

  it('preserves the existing response contracts', async () => {
    getAuthenticatedUserId.mockResolvedValue(actorUserId);
    userProfileService.getUserProfile.mockResolvedValue(profile);
    userProfileService.getUserLeagues.mockResolvedValue([]);

    const leaguesResponse = await GET_LEAGUES(request('/api/user/leagues'));
    const settingsResponse = await GET_SETTINGS(
      request(`/api/user/leagues/${leagueId}/settings`),
      context
    );

    expect(await leaguesResponse.json()).toEqual({ leagues: [] });
    expect(await settingsResponse.json()).toMatchObject({
      settings: { theme: 'light' },
      membership: { role: 'MEMBER', status: 'ACTIVE' },
    });
  });
});
