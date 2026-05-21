import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserIdFromRequestMock = vi.fn();
const createLeagueMock = vi.fn();
const listLeaguesMock = vi.fn();

vi.mock('@/lib/serverAuth', () => ({
  getUserIdFromRequest: getUserIdFromRequestMock,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    createLeague: createLeagueMock,
    listLeagues: listLeaguesMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/leagues', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function malformedPostRequest() {
  return new NextRequest('http://localhost/api/leagues', {
    method: 'POST',
    body: '{',
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/leagues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserIdFromRequestMock.mockResolvedValue('user-1');
    createLeagueMock.mockResolvedValue({
      id: 'league-1',
      name: 'Launch League',
      ownerId: 'user-1',
    });
  });

  it('rejects unauthenticated creation before parsing malformed request bodies', async () => {
    getUserIdFromRequestMock.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(malformedPostRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(createLeagueMock).not.toHaveBeenCalled();
  });

  it('uses the authenticated user as owner instead of a client-supplied commissioner id', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      postRequest({
        name: 'Launch League',
        type: 'private',
        scoringFormat: 'nine-category',
        teamCount: 10,
        commissionerId: 'attacker-user',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createLeagueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        name: 'Launch League',
        type: 'private',
        maxTeams: 10,
        categories: [
          'goals',
          'tackles',
          'inside50s',
          'intercepts',
          'contestedMarks',
          'rebound50s',
          'contestedPossessions',
          'effectiveDisposals',
          'scoreInvolvements',
        ],
      })
    );
    expect(body).toEqual({
      success: true,
      data: {
        id: 'league-1',
        name: 'Launch League',
        ownerId: 'user-1',
      },
    });
  });
});
