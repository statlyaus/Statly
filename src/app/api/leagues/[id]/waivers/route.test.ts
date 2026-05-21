import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAuthenticatedUserIdMock, listWaiversMock, verifyLeagueMembershipMock } = vi.hoisted(
  () => ({
    getAuthenticatedUserIdMock: vi.fn(),
    listWaiversMock: vi.fn(),
    verifyLeagueMembershipMock: vi.fn(),
  })
);

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: verifyLeagueMembershipMock,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    listWaivers: listWaiversMock,
  },
}));

function getRequest() {
  return new NextRequest('http://localhost/api/leagues/league-1/waivers');
}

describe('GET /api/leagues/[id]/waivers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: true });
    listWaiversMock.mockResolvedValue({
      claims: [{ id: 'claim-1' }],
      priorities: [{ teamId: 'team-1', priority: 1 }],
    });
  });

  it('rejects unauthenticated requests before listing waivers', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(verifyLeagueMembershipMock).not.toHaveBeenCalled();
    expect(listWaiversMock).not.toHaveBeenCalled();
  });

  it('rejects non-members before listing waivers', async () => {
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: false });
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(verifyLeagueMembershipMock).toHaveBeenCalledWith('league-1', 'user-1');
    expect(listWaiversMock).not.toHaveBeenCalled();
  });

  it('returns waiver claims and priorities for league members', async () => {
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listWaiversMock).toHaveBeenCalledWith('league-1');
    expect(body).toEqual({
      claims: [{ id: 'claim-1' }],
      priorities: [{ teamId: 'team-1', priority: 1 }],
    });
  });
});
