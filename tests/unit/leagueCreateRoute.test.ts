import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LeagueCreationError } from '@/server/leagues/createLeagueService';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const authMocks = vi.hoisted(() => ({
  getUserIdFromRequest: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  createLeague: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getUserIdFromRequest: authMocks.getUserIdFromRequest,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

vi.mock('@/server/leagues/createLeagueService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/leagues/createLeagueService')>()),
  createLeague: serviceMocks.createLeague,
}));

describe('league creation route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    authMocks.getUserIdFromRequest.mockResolvedValue('owner-user');
    serviceMocks.createLeague.mockResolvedValue({
      league: {
        id: 'league-1',
        name: 'Timezone Keepers',
        timeZone: 'Australia/Melbourne',
      },
    });
  });

  it('authenticates and delegates the request to the canonical service', async () => {
    const body = createBody();
    const { POST } = await import('@/app/api/leagues/route');
    const response = await POST(jsonRequest('/api/leagues', body));

    expect(response.status).toBe(201);
    expect(serviceMocks.createLeague).toHaveBeenCalledWith({
      userId: 'owner-user',
      input: body,
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: 'league-1', timeZone: 'Australia/Melbourne' },
    });
  });

  it('rejects unauthenticated creation before invoking the domain service', async () => {
    authMocks.getUserIdFromRequest.mockResolvedValue(null);
    const { POST } = await import('@/app/api/leagues/route');
    const response = await POST(jsonRequest('/api/leagues', createBody()));

    expect(response.status).toBe(401);
    expect(serviceMocks.createLeague).not.toHaveBeenCalled();
  });

  it.each([
    [new LeagueCreationError('League name is invalid', 400, 'VALIDATION'), 400, 'VALIDATION'],
    [
      new LeagueCreationError('League creation is temporarily unavailable', 503, 'PROJECTION'),
      503,
      'PROJECTION',
    ],
  ])('maps domain failures to stable API errors', async (error, status, code) => {
    serviceMocks.createLeague.mockRejectedValue(error);
    const { POST } = await import('@/app/api/leagues/route');
    const response = await POST(jsonRequest('/api/leagues', createBody()));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ success: false, code });
  });

  it('returns a client error for malformed JSON', async () => {
    const { POST } = await import('@/app/api/leagues/route');
    const response = await POST(
      new Request('https://statly.test/api/leagues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }) as NextRequest
    );

    expect(response.status).toBe(400);
    expect(serviceMocks.createLeague).not.toHaveBeenCalled();
  });
});

function createBody() {
  return {
    name: 'Timezone Keepers',
    type: 'private' as const,
    maxTeams: 12,
    categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
    timeZone: 'Australia/Melbourne',
  };
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
