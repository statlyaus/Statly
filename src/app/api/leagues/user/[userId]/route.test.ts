import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const listUserLeaguesMock = vi.fn();

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    listUserLeagues: listUserLeaguesMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GET /api/leagues/user/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUserLeaguesMock.mockResolvedValue([
      {
        id: 'league-1',
        name: 'Example League',
        teamName: 'My Team',
        status: 'active',
        draftCompleted: true,
        memberCount: 12,
        maxTeams: 12,
        ownerId: 'user-1',
        type: 'private',
        code: 'ABC123',
        categories: ['goals', 'tackles'],
        draftDate: '2026-04-01T09:00:00.000Z',
        createdAt: '2026-03-01T09:00:00.000Z',
        updatedAt: '2026-04-01T09:00:00.000Z',
      },
    ]);
  });

  it('returns the shared user league summary contract', async () => {
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/leagues/user/user-1'), {
      params: Promise.resolve({ userId: 'user-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listUserLeaguesMock).toHaveBeenCalledWith('user-1');
    expect(body).toEqual({
      success: true,
      leagues: [
        {
          id: 'league-1',
          name: 'Example League',
          teamName: 'My Team',
          status: 'active',
          draftCompleted: true,
          memberCount: 12,
          maxTeams: 12,
          ownerId: 'user-1',
          type: 'private',
          code: 'ABC123',
          categories: ['goals', 'tackles'],
          draftDate: '2026-04-01T09:00:00.000Z',
          createdAt: '2026-03-01T09:00:00.000Z',
          updatedAt: '2026-04-01T09:00:00.000Z',
        },
      ],
    });
  });
});
