import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAuthenticatedUserIdMock,
  processWaiverClaimsMock,
  revalidateTagMock,
  syncLeagueWaiverRealtimeProjectionMock,
} = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn(),
  processWaiverClaimsMock: vi.fn(),
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
    processWaiverClaims: processWaiverClaimsMock,
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

function postRequest() {
  return new NextRequest('http://localhost/api/leagues/league-1/waivers/process', {
    method: 'POST',
  });
}

describe('POST /api/leagues/[id]/waivers/process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    processWaiverClaimsMock.mockResolvedValue({ processed: 2, failed: 0 });
    syncLeagueWaiverRealtimeProjectionMock.mockResolvedValue(undefined);
    revalidateTagMock.mockReturnValue(undefined);
  });

  it('rejects unauthenticated requests before processing waiver claims', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(processWaiverClaimsMock).not.toHaveBeenCalled();
  });

  it('maps service permission denial to forbidden', async () => {
    processWaiverClaimsMock.mockRejectedValue(
      new Error('forbidden:Only commissioners can process')
    );
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Only commissioners can process' });
  });

  it('maps missing leagues to not found', async () => {
    processWaiverClaimsMock.mockRejectedValue(new Error('not_found:League not found'));
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'League not found' });
  });

  it('processes waiver claims for an authenticated caller', async () => {
    const { POST } = await import('./route');

    const response = await POST(postRequest(), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(processWaiverClaimsMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      callerUserId: 'user-1',
    });
    expect(syncLeagueWaiverRealtimeProjectionMock).toHaveBeenCalledWith({ leagueId: 'league-1' });
    expect(body).toEqual({ processed: 2, failed: 0 });
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
