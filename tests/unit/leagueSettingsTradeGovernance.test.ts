import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
}));

const accessMocks = vi.hoisted(() => ({
  getLeagueMembershipAccess: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  league: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  leagueSettings: {
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));

vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: accessMocks.getLeagueMembershipAccess,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: firestoreMocks.collection,
  },
}));

vi.mock('@/lib/leagueMembership', () => ({
  listActiveLeagueMembers: vi.fn(),
}));

vi.mock('@/server/draft/services/DraftSetupConvergenceService', () => ({
  ensureLeagueDraftSetupConverged: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('league settings trade governance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    accessMocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'user-1',
      isMember: true,
      canManage: true,
    });
    prismaMocks.league.findUnique.mockResolvedValue(null);
  });

  it.each([
    ['an ordinary manager', { isMember: true, canManage: false }],
    ['an inactive member', { isMember: false, canManage: false }],
  ])('rejects settings writes from %s before loading league data', async (_, access) => {
    accessMocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'user-1',
      ...access,
    });

    const { PUT } = await import('../../src/app/api/leagues/[id]/settings/route');
    const response = await PUT(jsonRequest({ trade: { tradeLimit: 5 } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(prismaMocks.league.findUnique).not.toHaveBeenCalled();
  });

  it('preserves existing Firestore trade governance during an unrelated partial update', async () => {
    const existingTradeSettings = {
      tradeLimit: 7,
      tradeReview: 'veto',
      tradeDeadline: '2026-09-01T00:00:00.000Z',
      offerExpiryHours: 96,
      reviewHours: 48,
      vetoThreshold: 4,
    };
    const leagueData = {
      name: 'Legacy League',
      code: 'LEGACY',
      maxTeams: 12,
      tradeSettings: existingTradeSettings,
    };
    const leagueRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => leagueData,
      }),
      update: firestoreMocks.update,
    };
    firestoreMocks.collection.mockReturnValue({ doc: vi.fn(() => leagueRef) });

    const { PUT } = await import('../../src/app/api/leagues/[id]/settings/route');
    const response = await PUT(jsonRequest({ league: { name: 'Renamed Legacy League' } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(200);
    expect(firestoreMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Renamed Legacy League',
        tradeSettings: existingTradeSettings,
      })
    );
  });

  it('merges supplied Firestore trade fields without resetting the remaining governance', async () => {
    const leagueData = {
      name: 'Legacy League',
      code: 'LEGACY',
      maxTeams: 12,
      tradeSettings: {
        tradeLimit: 7,
        tradeReview: 'admin',
        offerExpiryHours: 96,
        reviewHours: 48,
        vetoThreshold: 4,
      },
    };
    const leagueRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => leagueData,
      }),
      update: firestoreMocks.update,
    };
    firestoreMocks.collection.mockReturnValue({ doc: vi.fn(() => leagueRef) });

    const { PUT } = await import('../../src/app/api/leagues/[id]/settings/route');
    const response = await PUT(jsonRequest({ trade: { offerExpiryHours: 24 } }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(200);
    expect(firestoreMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeSettings: {
          tradeLimit: 7,
          tradeReview: 'admin',
          offerExpiryHours: 24,
          reviewHours: 48,
          vetoThreshold: 4,
        },
      })
    );
  });

  it.each([
    [{ tradeLimit: -1 }, 'Trade limit must be between 0 and 100'],
    [{ offerExpiryHours: 0 }, 'Trade offer expiry must be between 1 and 336 hours'],
    [{ reviewHours: 337 }, 'Trade review window must be between 1 and 336 hours'],
    [{ vetoThreshold: 'invalid' }, 'Trade veto threshold must be between 1 and 20'],
    [{ tradeReview: 'manager' }, 'Trade review must be none, admin, or veto'],
    [{ tradeDeadline: 'not-a-date' }, 'Invalid trade deadline'],
  ])('rejects invalid supplied legacy trade settings %#', async (trade, expectedError) => {
    const { PUT } = await import('../../src/app/api/leagues/[id]/settings/route');
    const response = await PUT(jsonRequest({ trade }), {
      params: Promise.resolve({ id: 'league-1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expectedError });
    expect(prismaMocks.league.findUnique).not.toHaveBeenCalled();
    expect(firestoreMocks.update).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown): NextRequest {
  return new Request('https://statly.test/api/leagues/league-1/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
