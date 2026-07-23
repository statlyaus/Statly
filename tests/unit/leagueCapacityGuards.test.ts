import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getUserIdFromRequest: vi.fn(),
}));

const firestoreMocks = vi.hoisted(() => ({
  batch: vi.fn(),
  collection: vi.fn(),
  runTransaction: vi.fn(),
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
}));

const membershipMocks = vi.hoisted(() => ({
  getLeagueMemberDocId: vi.fn(),
  getLeagueMembership: vi.fn(),
  isLeagueManagerRole: vi.fn(),
  listActiveLeagueMembers: vi.fn(),
  queueLeagueMembershipSet: vi.fn(),
}));

const membershipAccessMocks = vi.hoisted(() => ({
  getLeagueMembershipAccess: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  league: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  leagueSettings: {
    update: vi.fn(),
  },
}));

const draftSetupMocks = vi.hoisted(() => ({
  ensureLeagueDraftSetupConverged: vi.fn(),
}));

const prismaBridgeMocks = vi.hoisted(() => ({
  syncPrismaLeagueMember: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
  getUserIdFromRequest: authMocks.getUserIdFromRequest,
}));

vi.mock('../../src/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
  getUserIdFromRequest: authMocks.getUserIdFromRequest,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    batch: firestoreMocks.batch,
    collection: firestoreMocks.collection,
    runTransaction: firestoreMocks.runTransaction,
  },
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    batch: firestoreMocks.batch,
    collection: firestoreMocks.collection,
    runTransaction: firestoreMocks.runTransaction,
  },
}));

vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMemberDocId: membershipMocks.getLeagueMemberDocId,
  getLeagueMembership: membershipMocks.getLeagueMembership,
  isLeagueManagerRole: membershipMocks.isLeagueManagerRole,
  listActiveLeagueMembers: membershipMocks.listActiveLeagueMembers,
  queueLeagueMembershipSet: membershipMocks.queueLeagueMembershipSet,
}));

vi.mock('../../src/lib/leagueMembership', () => ({
  getLeagueMemberDocId: membershipMocks.getLeagueMemberDocId,
  getLeagueMembership: membershipMocks.getLeagueMembership,
  isLeagueManagerRole: membershipMocks.isLeagueManagerRole,
  listActiveLeagueMembers: membershipMocks.listActiveLeagueMembers,
  queueLeagueMembershipSet: membershipMocks.queueLeagueMembershipSet,
}));

vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: membershipAccessMocks.getLeagueMembershipAccess,
}));

vi.mock('../../src/server/leagues/membership', () => ({
  getLeagueMembershipAccess: membershipAccessMocks.getLeagueMembershipAccess,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('@/server/draft/services/DraftSetupConvergenceService', () => ({
  ensureLeagueDraftSetupConverged: draftSetupMocks.ensureLeagueDraftSetupConverged,
}));

vi.mock('../../src/server/draft/services/DraftSetupConvergenceService', () => ({
  ensureLeagueDraftSetupConverged: draftSetupMocks.ensureLeagueDraftSetupConverged,
}));

vi.mock('@/lib/prismaLeagueBridge', () => ({
  syncPrismaLeagueMember: prismaBridgeMocks.syncPrismaLeagueMember,
}));

vi.mock('../../src/lib/prismaLeagueBridge', () => ({
  syncPrismaLeagueMember: prismaBridgeMocks.syncPrismaLeagueMember,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/requestTracing', () => ({
  withRequestTracing: () => ({
    complete: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/lib/requestTracing', () => ({
  withRequestTracing: () => ({
    complete: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('league capacity guards', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    authMocks.getAuthenticatedUserId.mockResolvedValue('owner-user');
    authMocks.getUserIdFromRequest.mockResolvedValue('joining-user');
    membershipMocks.getLeagueMembership.mockResolvedValue({
      isMember: true,
      source: 'prisma',
      data: { role: 'OWNER' },
    });
    membershipAccessMocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'owner-user',
      isMember: true,
      canManage: true,
    });
    membershipMocks.isLeagueManagerRole.mockReturnValue(true);
    membershipMocks.getLeagueMemberDocId.mockImplementation(
      (leagueId: string, userId: string) => `${leagueId}_${userId}`
    );
    membershipMocks.queueLeagueMembershipSet.mockReturnValue('league-1_joining-user');
    firestoreMocks.transactionGet.mockImplementation((ref: { get?: () => unknown }) => ref.get?.());
    firestoreMocks.runTransaction.mockImplementation((callback) =>
      callback({
        get: firestoreMocks.transactionGet,
        set: firestoreMocks.transactionSet,
      })
    );
    prismaBridgeMocks.syncPrismaLeagueMember.mockResolvedValue({ synced: true });
  });

  it('rejects reducing Prisma league maxTeams below the active member count', async () => {
    prismaMocks.league.findUnique.mockResolvedValueOnce({
      id: 'league-1',
      name: 'Overfilled League',
      inviteCode: 'FULL1234',
      categoriesJson: null,
      settings: buildSettings({ id: 'settings-1', maxTeams: 20 }),
      _count: { members: 21 },
    });

    const { PUT } = await import('../../src/app/api/leagues/[id]/settings/route');
    const response = await PUT(
      jsonRequest('/api/leagues/league-1/settings', { league: { maxTeams: 12 } }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Max teams cannot be less than the current team count');
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  });

  it('rejects reducing Firestore league maxTeams below the active member count', async () => {
    const update = vi.fn();
    const leagueDocRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          name: 'Overfilled Firestore League',
          code: 'FULLFIRE',
          maxTeams: 20,
        }),
      }),
      update,
    };
    const leaguesCollection = { doc: vi.fn(() => leagueDocRef) };

    prismaMocks.league.findUnique.mockResolvedValueOnce(null);
    firestoreMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagues') return leaguesCollection;
      throw new Error(`Unexpected collection access: ${collectionName}`);
    });
    membershipMocks.listActiveLeagueMembers.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({
        id: `member-${index + 1}`,
        leagueId: 'league-1',
        userId: `user-${index + 1}`,
        role: index === 0 ? 'owner' : 'member',
        teamName: `Team ${index + 1}`,
        isActive: true,
        source: 'embedded',
      }))
    );

    const { PUT } = await import('../../src/app/api/leagues/[id]/settings/route');
    const response = await PUT(
      jsonRequest('/api/leagues/league-1/settings', { league: { maxTeams: 12 } }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Max teams cannot be less than the current team count');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects joining a Firestore league that is already at capacity', async () => {
    const leagueData = {
      name: 'Full League',
      code: 'FULL1234',
      type: 'private',
      status: 'preseason',
      maxTeams: 12,
      draftDate: '2026-06-01T10:00:00.000Z',
    };
    const leagueQueryGet = vi.fn().mockResolvedValue({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'league-1',
          data: () => leagueData,
        },
      ],
    });
    const leagueDocRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        id: 'league-1',
        data: () => leagueData,
      }),
    };
    const leaguesCollection = {
      doc: vi.fn(() => leagueDocRef),
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ get: leagueQueryGet })),
      })),
    };

    firestoreMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagues') return leaguesCollection;
      throw new Error(`Unexpected collection access: ${collectionName}`);
    });
    membershipMocks.listActiveLeagueMembers.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        id: `member-${index + 1}`,
        leagueId: 'league-1',
        userId: `user-${index + 1}`,
        role: index === 0 ? 'owner' : 'member',
        teamName: `Team ${index + 1}`,
        isActive: true,
        source: 'embedded',
      }))
    );

    const { POST } = await import('../../src/app/api/leagues/join/route');
    const response = await POST(
      jsonRequest('/api/leagues/join', { code: 'full-1234', teamName: 'Overflow Team' })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('League is full');
    expect(firestoreMocks.runTransaction).toHaveBeenCalled();
    expect(firestoreMocks.transactionSet).not.toHaveBeenCalled();
    expect(firestoreMocks.batch).not.toHaveBeenCalled();
    expect(membershipMocks.queueLeagueMembershipSet).not.toHaveBeenCalled();
  });
});

function buildSettings(overrides: { id: string; maxTeams: number }) {
  return {
    id: overrides.id,
    maxTeams: overrides.maxTeams,
    rosterSize: 18,
    benchSize: 4,
    pickSeconds: 120,
    allowAutoPick: true,
    positionLimitsJson: null,
    autoPickRulesJson: null,
    draftType: 'SNAKE',
    pickOrder: 'RANDOM',
    waiverRule: 'WEEKLY',
    startAt: new Date('2026-06-07T09:00:00.000Z'),
    timeZone: 'Australia/Melbourne',
    locked: false,
  };
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
