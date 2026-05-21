import { NextRequest, NextResponse } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const joinLeagueMock = vi.fn();

vi.mock('@/lib/apiMiddleware', () => ({
  createResponse: (data: unknown, status = 200) => NextResponse.json(data, { status }),
  middlewareConfigs: {
    private:
      (
        handler: (context: {
          req: NextRequest;
          user?: { id: string; email?: string; roles?: string[] };
        }) => Promise<NextResponse>
      ) =>
      (req: NextRequest) =>
        handler({ req, user: { id: 'user-1' } }),
  },
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    joinLeague: joinLeagueMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/leagues/join', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/leagues/join', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinLeagueMock.mockResolvedValue({
      message: 'Successfully joined Real League',
      league: {
        id: 'league-1',
        name: 'Real League',
        code: 'ABC123',
      },
      member: {
        id: 'member-1',
        leagueId: 'league-1',
        userId: 'user-1',
        role: 'member',
        teamName: 'Real Team',
        joinedAt: '2026-05-18T00:00:00.000Z',
        isActive: true,
      },
    });
  });

  it('does not satisfy the hard-coded launch invite before the league service', async () => {
    const { POST } = await import('./route');

    const response = await POST(postRequest({ code: '123ABC', teamName: 'Real Team' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(joinLeagueMock).toHaveBeenCalledWith({
      userId: 'user-1',
      code: '123ABC',
      teamName: 'Real Team',
    });
    expect(body.league.id).toBe('league-1');
    expect(body.league.id).not.toBe('test-league-id');
  });

  it('preserves the service success response shape for normal joins', async () => {
    const { POST } = await import('./route');

    const response = await POST(postRequest({ code: 'abc123' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(joinLeagueMock).toHaveBeenCalledWith({
      userId: 'user-1',
      code: 'ABC123',
      teamName: undefined,
    });
    expect(body).toEqual({
      message: 'Successfully joined Real League',
      league: {
        id: 'league-1',
        name: 'Real League',
        code: 'ABC123',
      },
      member: {
        id: 'member-1',
        leagueId: 'league-1',
        userId: 'user-1',
        role: 'member',
        teamName: 'Real Team',
        joinedAt: '2026-05-18T00:00:00.000Z',
        isActive: true,
      },
    });
  });
});
