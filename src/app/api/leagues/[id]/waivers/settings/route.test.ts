import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthenticatedUserIdMock, getWaiverSettingsMock, verifyLeagueMembershipMock } =
  vi.hoisted(() => ({
    getAuthenticatedUserIdMock: vi.fn(),
    getWaiverSettingsMock: vi.fn(),
    verifyLeagueMembershipMock: vi.fn(),
  }));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: verifyLeagueMembershipMock,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    getWaiverSettings: getWaiverSettingsMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

function getRequest() {
  return new NextRequest('http://localhost/api/leagues/league-1/waivers/settings');
}

describe('GET /api/leagues/[id]/waivers/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: true });
    getWaiverSettingsMock.mockResolvedValue({
      waiverSettings: {
        processingDay: 'Tuesday',
        waiverMode: 'ROLLING',
      },
    });
  });

  it('rejects unauthenticated requests before loading settings', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(verifyLeagueMembershipMock).not.toHaveBeenCalled();
    expect(getWaiverSettingsMock).not.toHaveBeenCalled();
  });

  it('rejects non-members before loading settings', async () => {
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: false });
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(verifyLeagueMembershipMock).toHaveBeenCalledWith('league-1', 'user-1');
    expect(getWaiverSettingsMock).not.toHaveBeenCalled();
  });

  it('returns waiver settings for league members', async () => {
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getWaiverSettingsMock).toHaveBeenCalledWith('league-1');
    expect(body).toEqual({
      waiverSettings: {
        processingDay: 'Tuesday',
        waiverMode: 'ROLLING',
      },
    });
  });
});
