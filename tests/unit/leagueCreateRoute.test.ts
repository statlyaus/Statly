import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getUserIdFromRequest: vi.fn(),
}));

const firestoreMocks = vi.hoisted(() => ({
  batch: vi.fn(),
  collection: vi.fn(),
}));

const membershipMocks = vi.hoisted(() => ({
  queueLeagueMembershipSet: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getUserIdFromRequest: authMocks.getUserIdFromRequest,
}));

vi.mock('../../src/lib/serverAuth', () => ({
  getUserIdFromRequest: authMocks.getUserIdFromRequest,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    batch: firestoreMocks.batch,
    collection: firestoreMocks.collection,
  },
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    batch: firestoreMocks.batch,
    collection: firestoreMocks.collection,
  },
}));

vi.mock('@/lib/leagueMembership', () => ({
  queueLeagueMembershipSet: membershipMocks.queueLeagueMembershipSet,
}));

vi.mock('../../src/lib/leagueMembership', () => ({
  queueLeagueMembershipSet: membershipMocks.queueLeagueMembershipSet,
}));

describe('league creation route timezone handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    authMocks.getUserIdFromRequest.mockResolvedValue('owner-user');
    membershipMocks.queueLeagueMembershipSet.mockReturnValue('league-1_owner-user');
  });

  it('persists a valid IANA time zone for created leagues', async () => {
    const { batch } = mockLeagueCreateFirestore();

    const { POST } = await import('../../src/app/api/leagues/route');
    const response = await POST(
      jsonRequest('/api/leagues', {
        name: 'Timezone Keepers',
        maxTeams: 12,
        categories: ['goals', 'marks', 'tackles'],
        timeZone: 'Australia/Melbourne',
      })
    );

    expect(response.status).toBe(201);
    expect(batch.set).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'league-1' }),
      expect.objectContaining({ timeZone: 'Australia/Melbourne' })
    );
  });

  it('defaults invalid create-route time zones to UTC before persistence', async () => {
    const { batch } = mockLeagueCreateFirestore();

    const { POST } = await import('../../src/app/api/leagues/route');
    const response = await POST(
      jsonRequest('/api/leagues', {
        name: 'Fallback Keepers',
        maxTeams: 12,
        categories: ['goals', 'marks', 'tackles'],
        timeZone: 'Mars/Olympus_Mons',
      })
    );

    expect(response.status).toBe(201);
    expect(batch.set).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'league-1' }),
      expect.objectContaining({ timeZone: 'UTC' })
    );
  });
});

function mockLeagueCreateFirestore() {
  const batch = {
    commit: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
  };
  const get = vi.fn().mockResolvedValue({ empty: true });
  const limit = vi.fn(() => ({ get }));
  const where = vi.fn(() => ({ limit }));
  const doc = vi.fn(() => ({ id: 'league-1' }));

  firestoreMocks.batch.mockReturnValue(batch);
  firestoreMocks.collection.mockImplementation((collectionName: string) => {
    if (collectionName === 'leagues') {
      return { doc, where };
    }

    throw new Error(`Unexpected collection access: ${collectionName}`);
  });

  return { batch, doc, get, limit, where };
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
