import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuthenticatedUserIdMock,
  revalidateTagMock,
  submitWaiverClaimMock,
  syncLeagueWaiverRealtimeProjectionMock,
  verifyLeagueMembershipMock,
} = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn(),
  revalidateTagMock: vi.fn(),
  submitWaiverClaimMock: vi.fn(),
  syncLeagueWaiverRealtimeProjectionMock: vi.fn(),
  verifyLeagueMembershipMock: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: verifyLeagueMembershipMock,
}));

vi.mock('@/lib/metrics', () => ({
  withMetrics: (handler: unknown) => handler,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    submitWaiverClaim: submitWaiverClaimMock,
  },
}));

vi.mock('@/server/league/services/waiverRealtimeProjection', () => ({
  syncLeagueWaiverRealtimeProjection: syncLeagueWaiverRealtimeProjectionMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    apiError: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/leagues/league-1/waivers/submit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const validBody = {
  teamId: 'team-1',
  playerId: 'player-1',
  dropPlayerId: 'player-2',
  priority: 2,
  bidAmount: 10,
};

describe('POST /api/leagues/[id]/waivers/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: true });
    submitWaiverClaimMock.mockResolvedValue({ id: 'claim-1', teamId: 'member-1' });
    syncLeagueWaiverRealtimeProjectionMock.mockResolvedValue(undefined);
    revalidateTagMock.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated requests before submitting a waiver claim', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(postRequest(validBody), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(verifyLeagueMembershipMock).not.toHaveBeenCalled();
    expect(submitWaiverClaimMock).not.toHaveBeenCalled();
  });

  it('rejects non-members before submitting a waiver claim', async () => {
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: false });
    const { POST } = await import('./route');

    const response = await POST(postRequest(validBody), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Not a league member' });
    expect(verifyLeagueMembershipMock).toHaveBeenCalledWith('league-1', 'user-1');
    expect(submitWaiverClaimMock).not.toHaveBeenCalled();
  });

  it('rejects non-members before validating request bodies', async () => {
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: false });
    const { POST } = await import('./route');

    const response = await POST(postRequest({}), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Not a league member' });
    expect(verifyLeagueMembershipMock).toHaveBeenCalledWith('league-1', 'user-1');
    expect(submitWaiverClaimMock).not.toHaveBeenCalled();
  });

  it('submits a waiver claim for league members', async () => {
    const { POST } = await import('./route');

    const response = await POST(postRequest(validBody), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(submitWaiverClaimMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      userId: 'user-1',
      playerId: 'player-1',
      dropPlayerId: 'player-2',
      priority: 2,
      bidAmount: 10,
    });
    expect(syncLeagueWaiverRealtimeProjectionMock).toHaveBeenCalledWith({ leagueId: 'league-1' });
    expect(body).toEqual({ id: 'claim-1' });
  });

  it('does not return success when realtime projection sync fails', async () => {
    syncLeagueWaiverRealtimeProjectionMock.mockRejectedValue(new Error('firestore unavailable'));
    const { POST } = await import('./route');

    const response = await POST(postRequest(validBody), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(syncLeagueWaiverRealtimeProjectionMock).toHaveBeenCalledWith({ leagueId: 'league-1' });
    expect(body).toEqual({ error: 'Internal Server Error' });
  });

  it('does not require a client team id because the service resolves the member from auth', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      postRequest({
        playerId: 'player-1',
        dropPlayerId: 'player-2',
        priority: 2,
        bidAmount: 10,
      }),
      {
        params: Promise.resolve({ id: 'league-1' }),
      }
    );

    expect(response.status).toBe(201);
    expect(submitWaiverClaimMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      userId: 'user-1',
      playerId: 'player-1',
      dropPlayerId: 'player-2',
      priority: 2,
      bidAmount: 10,
    });
  });
});
