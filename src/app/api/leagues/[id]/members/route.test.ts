import { NextRequest, NextResponse } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserIdFromRequestMock = vi.fn();
const verifyLeagueMembershipMock = vi.fn();
const getLeagueMembersMock = vi.fn();
const authorizeLocalOnlyRequestMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getUserIdFromRequest: getUserIdFromRequestMock,
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: verifyLeagueMembershipMock,
}));

vi.mock('@/lib/operationalAuth', () => ({
  authorizeLocalOnlyRequest: authorizeLocalOnlyRequestMock,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    getLeagueMembers: getLeagueMembersMock,
    removeLeagueMember: vi.fn(),
    reorderLeagueDraftSlots: vi.fn(),
    transferLeagueOwnership: vi.fn(),
    updateLeagueMember: vi.fn(),
  },
}));

vi.mock('@/server/draft/services/LeagueDraftProvisioningService', () => ({
  leagueDraftProvisioningService: {
    syncFromLeagueSettings: vi.fn(),
  },
}));

vi.mock('@/lib/requestTracing', () => ({
  withRequestTracing: () => ({
    complete: vi.fn(),
    error: vi.fn(),
  }),
}));

function getRequest(leagueId = 'league-1') {
  return new NextRequest(`http://localhost/api/leagues/${leagueId}/members`);
}

describe('GET /api/leagues/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserIdFromRequestMock.mockResolvedValue('user-1');
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: true, source: 'embedded' });
    getLeagueMembersMock.mockResolvedValue([
      {
        id: 'member-1',
        leagueId: 'league-1',
        userId: 'user-1',
        role: 'owner',
        teamName: 'Owner Team',
        joinedAt: '2026-05-18T00:00:00.000Z',
        isActive: true,
      },
    ]);
    authorizeLocalOnlyRequestMock.mockReturnValue({
      ok: false,
      response: NextResponse.json({ success: false, error: 'Not found' }, { status: 404 }),
    });
  });

  it('rejects unauthenticated member reads before loading members', async () => {
    getUserIdFromRequestMock.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(401);
    expect(verifyLeagueMembershipMock).not.toHaveBeenCalled();
    expect(getLeagueMembersMock).not.toHaveBeenCalled();
  });

  it('forbids authenticated users who are not league members', async () => {
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: false, source: 'none' });
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(403);
    expect(verifyLeagueMembershipMock).toHaveBeenCalledWith('league-1', 'user-1');
    expect(getLeagueMembersMock).not.toHaveBeenCalled();
  });

  it('returns members for an authenticated league member', async () => {
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getLeagueMembersMock).toHaveBeenCalledWith('league-1');
    expect(body).toEqual({
      success: true,
      data: [
        {
          id: 'member-1',
          leagueId: 'league-1',
          userId: 'user-1',
          role: 'owner',
          teamName: 'Owner Team',
          joinedAt: '2026-05-18T00:00:00.000Z',
          isActive: true,
        },
      ],
    });
  });

  it('keeps the test league fixture local-only after authentication', async () => {
    authorizeLocalOnlyRequestMock.mockReturnValue({ ok: true });
    const { GET } = await import('./route');

    const response = await GET(getRequest('test-league-id'), {
      params: Promise.resolve({ id: 'test-league-id' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(authorizeLocalOnlyRequestMock).toHaveBeenCalled();
    expect(verifyLeagueMembershipMock).not.toHaveBeenCalled();
    expect(getLeagueMembersMock).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leagueId: 'test-league-id',
          teamName: 'Robbo Rockers',
        }),
      ])
    );
  });
});
