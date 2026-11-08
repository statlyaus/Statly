import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WriteBatch } from 'firebase-admin/firestore';

const adminMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  collectionGroup: vi.fn(),
  doc: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueMemberFindMany: vi.fn(),
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: adminMocks.collection,
    collectionGroup: adminMocks.collectionGroup,
    doc: adminMocks.doc,
  },
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: prismaMocks.leagueFindUnique,
    },
    leagueMember: {
      findMany: prismaMocks.leagueMemberFindMany,
    },
  },
}));

import {
  getLeagueMembership,
  isActiveMembershipData,
  listActiveFirestoreLeagueMembers,
  listActiveLeagueMembers,
  listActiveUserLeagueMemberships,
  queueLeagueMembershipSet,
  toCanonicalLeagueMembershipData,
  toCanonicalLeagueMembershipPatch,
  verifyLeagueMembership,
} from '../../src/lib/leagueMembership';

describe('leagueMembership architecture helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.leagueFindUnique.mockResolvedValue(null);
    prismaMocks.leagueMemberFindMany.mockResolvedValue([]);
  });

  it('treats removed or inactive membership data as unauthorized', () => {
    expect(isActiveMembershipData({ isActive: false })).toBe(false);
    expect(isActiveMembershipData({ status: 'REMOVED' })).toBe(false);
    expect(isActiveMembershipData({ status: 'inactive' })).toBe(false);
    expect(isActiveMembershipData({ isActive: true, status: 'ACTIVE' })).toBe(true);
  });

  it('does not treat a removed member as belonging to the league', async () => {
    prismaMocks.leagueFindUnique.mockResolvedValue({
      ownerId: 'owner-user',
      members: [
        {
          id: 'member-2',
          userId: 'removed-user',
          role: 'MANAGER',
          teamName: 'Gone FC',
          joinedAt: new Date('2026-06-01T00:00:00.000Z'),
          isActive: false,
          status: 'removed',
        },
      ],
    });

    await expect(getLeagueMembership('league-1', 'removed-user')).resolves.toEqual({
      isMember: false,
      source: 'none',
    });
    expect(adminMocks.doc).not.toHaveBeenCalled();
  });

  it('reads active Prisma league membership without touching Firestore', async () => {
    prismaMocks.leagueFindUnique.mockResolvedValue({
      ownerId: 'owner-user',
      members: [
        {
          id: 'member-1',
          userId: 'owner-user',
          role: 'OWNER',
          teamName: 'Owner Team',
          teamLogoUrl: 'https://cdn.example.com/owner.png',
          teamLogoPositionX: 35,
          teamLogoPositionY: 70,
          teamLogoZoom: 1.6,
          joinedAt: new Date('2026-06-01T00:00:00.000Z'),
          isActive: true,
          status: 'ACTIVE',
        },
      ],
    });

    const result = await getLeagueMembership('league-1', 'owner-user');

    expect(result).toEqual({
      isMember: true,
      source: 'prisma',
      memberDocId: 'member-1',
      data: {
        leagueId: 'league-1',
        userId: 'owner-user',
        role: 'OWNER',
        teamName: 'Owner Team',
        teamLogoUrl: 'https://cdn.example.com/owner.png',
        teamLogoPositionX: 35,
        teamLogoPositionY: 70,
        teamLogoZoom: 1.6,
        joinedAt: new Date('2026-06-01T00:00:00.000Z'),
        isActive: true,
        status: 'ACTIVE',
      },
    });
    expect(adminMocks.doc).not.toHaveBeenCalled();
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it('normalizes canonical member documents with embedded defaults', () => {
    const data = toCanonicalLeagueMembershipData({
      leagueId: 'league-1',
      userId: 'user-1',
      role: 'owner',
      teamName: 'Owner Team',
      joinedAt: '2026-05-31T00:00:00.000Z',
    });

    expect(data).toMatchObject({
      leagueId: 'league-1',
      userId: 'user-1',
      role: 'owner',
      teamName: 'Owner Team',
      isActive: true,
      status: 'ACTIVE',
      draftPreferences: {
        watchlist: [],
        autoDraftEnabled: true,
        draftStrategy: 'BALANCED',
        priorityPositions: ['MID', 'FWD', 'DEF', 'RUC'],
        maxDraftTime: 90,
      },
    });
    expect(data).not.toHaveProperty('teamLogoUrl');
    expect(data).not.toHaveProperty('teamLogoPositionX');
    expect(data).not.toHaveProperty('teamLogoPositionY');
    expect(data).not.toHaveProperty('teamLogoZoom');
    expect(Object.values(data)).not.toContain(undefined);
  });

  it('preserves explicit nulls and zero values in canonical member documents', () => {
    const data = toCanonicalLeagueMembershipData({
      leagueId: 'league-1',
      userId: 'user-1',
      teamLogoUrl: null,
      teamLogoPositionX: 0,
      teamLogoPositionY: null,
      teamLogoZoom: 0,
    });

    expect(data).toMatchObject({
      teamLogoUrl: null,
      teamLogoPositionX: 0,
      teamLogoPositionY: null,
      teamLogoZoom: 0,
    });
  });

  it('persists team symbols in canonical membership documents', () => {
    const data = toCanonicalLeagueMembershipData({
      leagueId: 'league-1',
      userId: 'user-1',
      role: 'member',
      teamName: 'Symbol Team',
      teamLogoUrl: 'https://cdn.example.com/symbol-team.png',
      teamLogoPositionX: 25,
      teamLogoPositionY: 80,
      teamLogoZoom: 2,
      joinedAt: '2026-07-03T00:00:00.000Z',
    });

    expect(data).toMatchObject({
      leagueId: 'league-1',
      userId: 'user-1',
      role: 'member',
      teamName: 'Symbol Team',
      teamLogoUrl: 'https://cdn.example.com/symbol-team.png',
      teamLogoPositionX: 25,
      teamLogoPositionY: 80,
      teamLogoZoom: 2,
      isActive: true,
      status: 'ACTIVE',
    });
  });

  it('patches team symbols without changing unrelated membership fields', () => {
    const patch = toCanonicalLeagueMembershipPatch({
      teamLogoUrl: 'data:image/png;base64,abc123',
      teamLogoPositionX: 10,
      teamLogoPositionY: 90,
      teamLogoZoom: 1.75,
    });

    expect(patch).toEqual({
      teamLogoUrl: 'data:image/png;base64,abc123',
      teamLogoPositionX: 10,
      teamLogoPositionY: 90,
      teamLogoZoom: 1.75,
    });
  });

  it('preserves null team symbols in membership patches so symbols can be cleared', () => {
    const patch = toCanonicalLeagueMembershipPatch({
      teamLogoUrl: null,
      teamLogoPositionX: null,
      teamLogoPositionY: null,
      teamLogoZoom: null,
    });

    expect(patch).toEqual({
      teamLogoUrl: null,
      teamLogoPositionX: null,
      teamLogoPositionY: null,
      teamLogoZoom: null,
    });
  });

  it('queues writes to both top-level and embedded membership documents', () => {
    const topLevelRef = { path: 'leagueMembers/member-1' };
    const embeddedRef = { path: 'leagues/league-1/members/user-1' };
    const collectionDoc = vi.fn(() => topLevelRef);
    const batch = { set: vi.fn() };

    adminMocks.collection.mockReturnValue({ doc: collectionDoc });
    adminMocks.doc.mockReturnValue(embeddedRef);

    queueLeagueMembershipSet(
      batch as unknown as WriteBatch,
      {
        leagueId: 'league-1',
        userId: 'user-1',
        role: 'member',
        teamName: 'My Team',
      },
      { topLevelMemberId: 'member-1' }
    );

    expect(adminMocks.collection).toHaveBeenCalledWith('leagueMembers');
    expect(collectionDoc).toHaveBeenCalledWith('member-1');
    expect(adminMocks.doc).toHaveBeenCalledWith('leagues/league-1/members/user-1');
    expect(batch.set).toHaveBeenCalledTimes(2);
    expect(batch.set).toHaveBeenNthCalledWith(
      1,
      topLevelRef,
      expect.objectContaining({ leagueId: 'league-1', userId: 'user-1' }),
      { merge: true }
    );
    expect(batch.set).toHaveBeenNthCalledWith(
      2,
      embeddedRef,
      expect.objectContaining({ leagueId: 'league-1', userId: 'user-1' }),
      { merge: true }
    );
  });

  it('does not treat a Firestore-only member as a member when the league has no Prisma row', async () => {
    const firestoreMember = {
      exists: true,
      id: 'user-1',
      data: () => ({ leagueId: 'league-1', userId: 'user-1', role: 'owner', isActive: true }),
    };
    adminMocks.doc.mockReturnValue({ get: vi.fn().mockResolvedValue(firestoreMember) });
    adminMocks.collection.mockImplementation(() => {
      throw new Error('Firestore must not decide membership');
    });

    await expect(verifyLeagueMembership('league-1', 'user-1')).resolves.toEqual({
      isMember: false,
      source: 'none',
    });
    await expect(getLeagueMembership('league-1', 'user-1')).resolves.toEqual({
      isMember: false,
      source: 'none',
    });
    expect(adminMocks.doc).not.toHaveBeenCalled();
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it('does not treat a Firestore-only member as a member of a Prisma league', async () => {
    prismaMocks.leagueFindUnique.mockResolvedValue({ ownerId: 'owner-user', members: [] });

    await expect(verifyLeagueMembership('league-1', 'firestore-user')).resolves.toEqual({
      isMember: false,
      source: 'none',
    });
    expect(adminMocks.doc).not.toHaveBeenCalled();
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it('lists no members for a league with no Prisma row, without reading Firestore', async () => {
    adminMocks.collection.mockImplementation(() => {
      throw new Error('Firestore must not decide the member list');
    });

    await expect(listActiveLeagueMembers('league-1')).resolves.toEqual([]);
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it("lists a user's active league memberships from Prisma only", async () => {
    const joinedAt = new Date('2026-06-01T00:00:00.000Z');
    const row = {
      teamLogoUrl: null,
      teamLogoPositionX: null,
      teamLogoPositionY: null,
      teamLogoZoom: null,
      joinedAt,
      leftAt: null,
      isActive: true,
      status: 'ACTIVE',
      isCoCommissioner: false,
    };
    prismaMocks.leagueMemberFindMany.mockResolvedValue([
      {
        ...row,
        id: 'm-1',
        leagueId: 'league-1',
        userId: 'user-1',
        role: 'OWNER',
        teamName: 'Owned FC',
        league: { ownerId: 'user-1' },
      },
      {
        ...row,
        id: 'm-2',
        leagueId: 'league-2',
        userId: 'user-1',
        role: 'MANAGER',
        teamName: 'Gone FC',
        isActive: false,
        status: 'REMOVED',
        leftAt: joinedAt,
        league: { ownerId: 'someone-else' },
      },
      {
        ...row,
        id: 'm-3',
        leagueId: 'league-3',
        userId: 'user-1',
        role: 'MANAGER',
        teamName: 'Co FC',
        isCoCommissioner: true,
        league: { ownerId: 'someone-else' },
      },
    ]);
    adminMocks.collectionGroup.mockImplementation(() => {
      throw new Error('Firestore must not decide memberships');
    });

    const result = await listActiveUserLeagueMemberships('user-1');

    expect(prismaMocks.leagueMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
    expect(result).toEqual([
      {
        id: 'm-1',
        leagueId: 'league-1',
        userId: 'user-1',
        role: 'owner',
        teamName: 'Owned FC',
        joinedAt,
        isActive: true,
        source: 'prisma',
      },
      {
        id: 'm-3',
        leagueId: 'league-3',
        userId: 'user-1',
        role: 'admin',
        teamName: 'Co FC',
        joinedAt,
        isActive: true,
        source: 'prisma',
      },
    ]);
    expect(adminMocks.collectionGroup).not.toHaveBeenCalled();
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it('lists members of a Prisma league from Prisma, skipping removed rows', async () => {
    const joinedAt = new Date('2026-06-01T00:00:00.000Z');
    prismaMocks.leagueFindUnique.mockResolvedValue({
      ownerId: 'owner-user',
      members: [
        {
          id: 'm-owner',
          userId: 'owner-user',
          role: 'OWNER',
          teamName: 'Owner FC',
          teamLogoUrl: null,
          teamLogoPositionX: null,
          teamLogoPositionY: null,
          teamLogoZoom: null,
          joinedAt,
          leftAt: null,
          isActive: true,
          status: 'ACTIVE',
          isCoCommissioner: false,
        },
        {
          id: 'm-co',
          userId: 'co-user',
          role: 'MANAGER',
          teamName: 'Co FC',
          teamLogoUrl: 'https://cdn.example.com/co.png',
          teamLogoPositionX: null,
          teamLogoPositionY: null,
          teamLogoZoom: null,
          joinedAt,
          leftAt: null,
          isActive: true,
          status: 'ACTIVE',
          isCoCommissioner: true,
        },
        {
          id: 'm-gone',
          userId: 'gone-user',
          role: 'MANAGER',
          teamName: 'Gone FC',
          teamLogoUrl: null,
          teamLogoPositionX: null,
          teamLogoPositionY: null,
          teamLogoZoom: null,
          joinedAt,
          leftAt: joinedAt,
          isActive: false,
          status: 'removed',
          isCoCommissioner: false,
        },
      ],
    });

    const members = await listActiveLeagueMembers('league-1');

    expect(members).toEqual([
      {
        id: 'm-owner',
        leagueId: 'league-1',
        userId: 'owner-user',
        role: 'owner',
        teamName: 'Owner FC',
        joinedAt,
        isActive: true,
        source: 'prisma',
      },
      {
        id: 'm-co',
        leagueId: 'league-1',
        userId: 'co-user',
        role: 'admin',
        teamName: 'Co FC',
        teamLogoUrl: 'https://cdn.example.com/co.png',
        joinedAt,
        isActive: true,
        source: 'prisma',
      },
    ]);
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it('reads Firestore directly when a caller needs the compatibility projection', async () => {
    prismaMocks.leagueFindUnique.mockResolvedValue({ ownerId: 'owner-user', members: [] });
    adminMocks.collection.mockImplementation(() => {
      throw new Error('firestore-read');
    });

    await expect(listActiveFirestoreLeagueMembers('league-1')).rejects.toThrow('firestore-read');
    expect(prismaMocks.leagueFindUnique).not.toHaveBeenCalled();
  });
});
