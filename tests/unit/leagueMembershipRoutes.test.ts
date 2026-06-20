import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  getLeagueMemberDocId: vi.fn(),
  listActiveLeagueMembers: vi.fn(),
  queueLeagueMembershipPatch: vi.fn(),
  queueLeagueMembershipSet: vi.fn(),
  verifyLeagueMembership: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  syncPrismaLeagueMember: vi.fn(),
  syncPrismaLeagueOwner: vi.fn(),
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
  getLeagueMemberDocId: membershipMocks.getLeagueMemberDocId,
  listActiveLeagueMembers: membershipMocks.listActiveLeagueMembers,
  queueLeagueMembershipPatch: membershipMocks.queueLeagueMembershipPatch,
  queueLeagueMembershipSet: membershipMocks.queueLeagueMembershipSet,
  verifyLeagueMembership: membershipMocks.verifyLeagueMembership,
}));

vi.mock('../../src/lib/leagueMembership', () => ({
  getLeagueMemberDocId: membershipMocks.getLeagueMemberDocId,
  listActiveLeagueMembers: membershipMocks.listActiveLeagueMembers,
  queueLeagueMembershipPatch: membershipMocks.queueLeagueMembershipPatch,
  queueLeagueMembershipSet: membershipMocks.queueLeagueMembershipSet,
  verifyLeagueMembership: membershipMocks.verifyLeagueMembership,
}));

vi.mock('@/lib/prismaLeagueBridge', () => ({
  syncPrismaLeagueMember: prismaMocks.syncPrismaLeagueMember,
  syncPrismaLeagueOwner: prismaMocks.syncPrismaLeagueOwner,
}));

vi.mock('../../src/lib/prismaLeagueBridge', () => ({
  syncPrismaLeagueMember: prismaMocks.syncPrismaLeagueMember,
  syncPrismaLeagueOwner: prismaMocks.syncPrismaLeagueOwner,
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

vi.mock('@/lib/logger', () => ({
  logger: {
    apiError: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: {
    apiError: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('league membership route Firestore architecture', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    authMocks.getUserIdFromRequest.mockResolvedValue('request-user');
    membershipMocks.getLeagueMemberDocId.mockImplementation(
      (leagueId: string, userId: string) => `${leagueId}_${userId}`
    );
    membershipMocks.queueLeagueMembershipSet.mockReturnValue('league-1_request-user');
    membershipMocks.queueLeagueMembershipPatch.mockImplementation(() => undefined);
    membershipMocks.verifyLeagueMembership.mockResolvedValue({
      isMember: true,
      source: 'embedded',
      memberDocId: 'league-1_request-user',
    });
    prismaMocks.syncPrismaLeagueMember.mockResolvedValue({ synced: true });
    prismaMocks.syncPrismaLeagueOwner.mockResolvedValue({ synced: true });
  });

  it('keeps join and member mutation business logic off the top-level leagueMembers mirror', () => {
    const routeSources = [
      'src/app/api/leagues/join/route.ts',
      'src/app/api/leagues/[id]/members/route.ts',
    ].map((filePath) => readFileSync(join(process.cwd(), filePath), 'utf8'));

    for (const source of routeSources) {
      expect(source).not.toMatch(/collection\(['"]leagueMembers['"]\)/);
    }
  });

  it('keeps development member fixtures quarantined from production reads', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/members/route.ts'),
      'utf8'
    );

    expect(source).toContain('process.env.NODE_ENV !== "production"');
    expect(source).toContain('development-league-id');
    expect(source).not.toContain('test-league-id');
  });

  it('joins a league from canonical active members without reading the top-level mirror', async () => {
    const batch = { commit: vi.fn().mockResolvedValue(undefined), set: vi.fn() };
    const leagueQueryGet = vi.fn().mockResolvedValue({
      empty: false,
      size: 1,
      docs: [
        {
          id: 'league-1',
          data: () => ({
            name: 'AFL Keepers',
            code: 'KEEPER',
            type: 'private',
            status: 'preseason',
            maxTeams: 4,
            draftDate: '2026-06-01T10:00:00.000Z',
          }),
        },
      ],
    });
    const leaguesCollection = {
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ get: leagueQueryGet })),
      })),
    };

    authMocks.getUserIdFromRequest.mockResolvedValue('joining-user');
    firestoreMocks.batch.mockReturnValue(batch);
    firestoreMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagues') return leaguesCollection;
      throw new Error(`Unexpected top-level collection read: ${collectionName}`);
    });
    membershipMocks.queueLeagueMembershipSet.mockReturnValue('league-1_joining-user');
    membershipMocks.listActiveLeagueMembers.mockResolvedValue([
      activeMember({ id: 'league-1_owner', userId: 'owner-user', teamName: 'Owner Team' }),
      activeMember({ id: 'league-1_existing', userId: 'existing-user', teamName: 'Existing Team' }),
    ]);

    const { POST: joinLeague } = await import('../../src/app/api/leagues/join/route');
    const response = await joinLeague(
      jsonRequest('/api/leagues/join', { code: 'kee-per', teamName: 'New Team' })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(leaguesCollection.where).toHaveBeenCalledWith('code', '==', 'KEEPER');
    expect(body.data.member).toMatchObject({
      id: 'league-1_joining-user',
      leagueId: 'league-1',
      userId: 'joining-user',
      teamName: 'New Team',
    });
    expect(membershipMocks.listActiveLeagueMembers).toHaveBeenCalledWith('league-1');
    expect(prismaMocks.syncPrismaLeagueMember).toHaveBeenCalledWith(
      expect.objectContaining({ draftSlot: 3, memberId: 'league-1_joining-user' })
    );
  });

  it('does not expose league samples when a join code is missing', async () => {
    const leagueQueryGet = vi.fn().mockResolvedValue({
      empty: true,
      size: 0,
      docs: [],
    });
    const directLimit = vi.fn(() => ({
      get: vi.fn().mockResolvedValue({
        docs: [{ id: 'private-league', data: () => ({ code: 'PRIVATE_SAMPLE', name: 'Private' }) }],
      }),
    }));
    const leaguesCollection = {
      where: vi.fn(() => ({
        limit: vi.fn(() => ({ get: leagueQueryGet })),
      })),
      limit: directLimit,
    };

    authMocks.getUserIdFromRequest.mockResolvedValue('joining-user');
    firestoreMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagues') return leaguesCollection;
      throw new Error(`Unexpected top-level collection read: ${collectionName}`);
    });

    const { POST: joinLeague } = await import('../../src/app/api/leagues/join/route');
    const response = await joinLeague(
      jsonRequest('/api/leagues/join', { code: 'missing', teamName: 'New Team' })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.debug).toBeUndefined();
    expect(directLimit).not.toHaveBeenCalled();
  });

  it('updates a member from canonical active members without reading the top-level mirror', async () => {
    const batch = { commit: vi.fn().mockResolvedValue(undefined), set: vi.fn(), update: vi.fn() };
    const leagueDocRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        id: 'league-1',
        data: () => ({
          id: 'league-1',
          name: 'AFL Keepers',
          ownerId: 'owner-user',
          status: 'preseason',
          maxTeams: 4,
        }),
      }),
    };
    const leaguesCollection = {
      doc: vi.fn(() => leagueDocRef),
    };

    authMocks.getUserIdFromRequest.mockResolvedValue('owner-user');
    firestoreMocks.batch.mockReturnValue(batch);
    firestoreMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagues') return leaguesCollection;
      throw new Error(`Unexpected top-level collection read: ${collectionName}`);
    });
    membershipMocks.listActiveLeagueMembers.mockResolvedValue([
      activeMember({ id: 'target-user', userId: 'target-user', teamName: 'Old Team' }),
      activeMember({ id: 'other-user', userId: 'other-user', teamName: 'Other Team' }),
    ]);

    const { POST: mutateLeagueMember } = await import(
      '../../src/app/api/leagues/[id]/members/route'
    );
    const response = await mutateLeagueMember(
      jsonRequest('/api/leagues/league-1/members', {
        action: 'updateMember',
        targetUserId: 'target-user',
        updates: { teamName: 'Renamed Team' },
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 'target-user',
      leagueId: 'league-1',
      userId: 'target-user',
      teamName: 'Renamed Team',
    });
    expect(membershipMocks.queueLeagueMembershipPatch).toHaveBeenCalledWith(
      batch,
      'league-1',
      'target-user',
      { teamName: 'Renamed Team' },
      { topLevelMemberId: 'league-1_target-user' }
    );
    expect(prismaMocks.syncPrismaLeagueMember).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        memberId: 'league-1_target-user',
        teamName: 'Renamed Team',
      })
    );
  });

  it('rejects member list reads before Firestore league reads when the requester is not a member', async () => {
    authMocks.getUserIdFromRequest.mockResolvedValue('outside-user');
    membershipMocks.verifyLeagueMembership.mockResolvedValue({ isMember: false, source: 'none' });
    firestoreMocks.collection.mockImplementation(() => {
      throw new Error('Unexpected Firestore league read before membership authorization');
    });

    const { GET: getLeagueMembers } = await import('../../src/app/api/leagues/[id]/members/route');
    const response = await getLeagueMembers(
      new Request('https://statly.test/api/leagues/league-1/members') as NextRequest,
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(membershipMocks.verifyLeagueMembership).toHaveBeenCalledWith('league-1', 'outside-user');
    expect(membershipMocks.listActiveLeagueMembers).not.toHaveBeenCalled();
    expect(firestoreMocks.collection).not.toHaveBeenCalled();
  });
});

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function activeMember(overrides: { id: string; userId: string; teamName: string; role?: string }) {
  return {
    id: overrides.id,
    leagueId: 'league-1',
    userId: overrides.userId,
    role: overrides.role ?? 'member',
    teamName: overrides.teamName,
    joinedAt: '2026-05-31T00:00:00.000Z',
    isActive: true,
    source: 'embedded',
  };
}
