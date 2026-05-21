import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelWaiverClaimMock,
  getAuthenticatedUserIdMock,
  revalidateTagMock,
  syncLeagueWaiverRealtimeProjectionMock,
} = vi.hoisted(() => ({
  cancelWaiverClaimMock: vi.fn(),
  getAuthenticatedUserIdMock: vi.fn(),
  revalidateTagMock: vi.fn(),
  syncLeagueWaiverRealtimeProjectionMock: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/metrics', () => ({
  withMetrics: (handler: unknown) => handler,
}));

vi.mock('@/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    cancelWaiverClaim: cancelWaiverClaimMock,
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

function postRequest(body: unknown = { claimId: 'claim-1' }) {
  return new NextRequest('http://localhost/api/leagues/league-1/waivers/cancel', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/leagues/[id]/waivers/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    cancelWaiverClaimMock.mockResolvedValue(undefined);
    syncLeagueWaiverRealtimeProjectionMock.mockResolvedValue(undefined);
    revalidateTagMock.mockReturnValue(undefined);
  });

  it('rejects unauthenticated requests before cancelling a waiver claim', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(cancelWaiverClaimMock).not.toHaveBeenCalled();
  });

  it('maps service permission denial to forbidden', async () => {
    cancelWaiverClaimMock.mockRejectedValue(new Error('forbidden:Only claim owners can cancel'));
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Only claim owners can cancel' });
  });

  it('maps missing waiver claims to not found', async () => {
    cancelWaiverClaimMock.mockRejectedValue(new Error('not_found:Waiver claim not found'));
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Waiver claim not found' });
  });

  it('cancels a waiver claim for an authenticated caller', async () => {
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(cancelWaiverClaimMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      claimId: 'claim-1',
      callerUserId: 'user-1',
    });
    expect(syncLeagueWaiverRealtimeProjectionMock).toHaveBeenCalledWith({ leagueId: 'league-1' });
    expect(body).toEqual({ ok: true });
  });

  it('does not return success when realtime projection sync fails', async () => {
    syncLeagueWaiverRealtimeProjectionMock.mockRejectedValue(new Error('firestore unavailable'));
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(syncLeagueWaiverRealtimeProjectionMock).toHaveBeenCalledWith({ leagueId: 'league-1' });
    expect(body).toEqual({ error: 'Internal Server Error' });
  });
});
