import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLeagueDetailMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getUserIdFromRequest: vi.fn(),
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    getLeagueDetail: getLeagueDetailMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GET /api/leagues/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLeagueDetailMock.mockResolvedValue({
      league: {
        id: 'league-1',
        name: 'Example League',
        code: 'ABC123',
        type: 'private',
        ownerId: 'user-1',
        maxTeams: 12,
        currentTeams: 12,
        categories: ['goals', 'tackles'],
        tradeSettings: {
          tradeLimit: 10,
          tradeReview: 'none',
        },
        waiverWire: {
          waiverOrder: [],
          waiverPeriodHours: 24,
          waiverResetPolicy: 'weekly',
        },
        createdAt: '2026-03-01T09:00:00.000Z',
        status: 'active',
      },
      members: [
        {
          id: 'member-1',
          leagueId: 'league-1',
          userId: 'user-1',
          role: 'owner',
          teamName: 'My Team',
          joinedAt: '2026-03-01T09:00:00.000Z',
          isActive: true,
        },
        {
          id: 'member-2',
          leagueId: 'league-1',
          userId: 'user-2',
          role: 'commissioner',
          teamName: 'Co-Comish',
          joinedAt: '2026-03-02T09:00:00.000Z',
          isActive: true,
        },
      ],
    });
  });

  it('returns the shared league detail contract including commissioner roles', async () => {
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/leagues/league-1'), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getLeagueDetailMock).toHaveBeenCalledWith('league-1');
    expect(body).toEqual({
      success: true,
      data: {
        league: {
          id: 'league-1',
          name: 'Example League',
          code: 'ABC123',
          type: 'private',
          ownerId: 'user-1',
          maxTeams: 12,
          currentTeams: 12,
          categories: ['goals', 'tackles'],
          tradeSettings: {
            tradeLimit: 10,
            tradeReview: 'none',
          },
          waiverWire: {
            waiverOrder: [],
            waiverPeriodHours: 24,
            waiverResetPolicy: 'weekly',
          },
          createdAt: '2026-03-01T09:00:00.000Z',
          status: 'active',
        },
        members: [
          {
            id: 'member-1',
            leagueId: 'league-1',
            userId: 'user-1',
            role: 'owner',
            teamName: 'My Team',
            joinedAt: '2026-03-01T09:00:00.000Z',
            isActive: true,
          },
          {
            id: 'member-2',
            leagueId: 'league-1',
            userId: 'user-2',
            role: 'commissioner',
            teamName: 'Co-Comish',
            joinedAt: '2026-03-02T09:00:00.000Z',
            isActive: true,
          },
        ],
        scoringCategories: ['goals', 'tackles'],
      },
    });
  });
});
