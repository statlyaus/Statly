import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  collectionGroup: vi.fn(),
  doc: vi.fn(),
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: adminMocks.collection,
    collectionGroup: adminMocks.collectionGroup,
    doc: adminMocks.doc,
  },
}));

import {
  getLeagueMembership,
  isActiveMembershipData,
  isLeagueManagerRole,
  listActiveLeagueMembers,
  listActiveUserLeagueMemberships,
  queueLeagueMembershipSet,
  toCanonicalLeagueMembershipData,
  verifyLeagueMembership,
} from '../../src/lib/leagueMembership';

describe('leagueMembership architecture helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats removed or inactive membership data as unauthorized', () => {
    expect(isActiveMembershipData({ isActive: false })).toBe(false);
    expect(isActiveMembershipData({ status: 'REMOVED' })).toBe(false);
    expect(isActiveMembershipData({ status: 'inactive' })).toBe(false);
    expect(isActiveMembershipData({ isActive: true, status: 'ACTIVE' })).toBe(true);
  });

  it('normalizes league manager roles case-insensitively', () => {
    expect(isLeagueManagerRole('OWNER')).toBe(true);
    expect(isLeagueManagerRole('commissioner')).toBe(true);
    expect(isLeagueManagerRole('Admin')).toBe(true);
    expect(isLeagueManagerRole('member')).toBe(false);
    expect(isLeagueManagerRole(undefined)).toBe(false);
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
  });

  it('queues writes to both top-level and embedded membership documents', () => {
    const topLevelRef = { path: 'leagueMembers/member-1' };
    const embeddedRef = { path: 'leagues/league-1/members/user-1' };
    const collectionDoc = vi.fn(() => topLevelRef);
    const batch = { set: vi.fn() };

    adminMocks.collection.mockReturnValue({ doc: collectionDoc });
    adminMocks.doc.mockReturnValue(embeddedRef);

    queueLeagueMembershipSet(
      batch as unknown as FirebaseFirestore.WriteBatch,
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

  it('does not fall back to legacy membership when the embedded member is inactive', async () => {
    adminMocks.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        id: 'user-1',
        data: () => ({ isActive: false }),
      }),
    });

    const result = await verifyLeagueMembership('league-1', 'user-1');

    expect(result).toEqual({ isMember: false, source: 'embedded', memberDocId: 'user-1' });
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it('does not return stale legacy role data when embedded membership is inactive', async () => {
    adminMocks.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        id: 'user-1',
        data: () => ({ isActive: false, role: 'owner' }),
      }),
    });

    const result = await getLeagueMembership('league-1', 'user-1');

    expect(result).toEqual({
      isMember: false,
      source: 'embedded',
      memberDocId: 'user-1',
    });
    expect(adminMocks.collection).not.toHaveBeenCalled();
  });

  it('uses only active legacy memberships when no embedded member exists', async () => {
    const get = vi.fn().mockResolvedValue({
      empty: false,
      docs: [
        { id: 'inactive-member', data: () => ({ isActive: false }) },
        { id: 'active-member', data: () => ({ isActive: true }) },
      ],
    });
    const query = {
      where: vi.fn(() => query),
      limit: vi.fn(() => ({ get })),
    };

    adminMocks.doc.mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: false,
        data: () => undefined,
      }),
    });
    adminMocks.collection.mockReturnValue(query);

    const result = await verifyLeagueMembership('league-1', 'user-1');

    expect(query.where).toHaveBeenCalledWith('leagueId', '==', 'league-1');
    expect(query.where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(query.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({ isMember: true, source: 'legacy', memberDocId: 'active-member' });
  });

  it('lists active embedded members without reading the top-level mirror', async () => {
    const embeddedGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'removed-user',
          data: () => ({
            leagueId: 'league-1',
            userId: 'removed-user',
            teamName: 'Removed Team',
            role: 'member',
            isActive: false,
            joinedAt: '2026-05-31T02:00:00.000Z',
          }),
        },
        {
          id: 'user-2',
          data: () => ({
            leagueId: 'league-1',
            userId: 'user-2',
            teamName: 'Second Team',
            role: 'member',
            isActive: true,
            joinedAt: '2026-05-31T02:00:00.000Z',
          }),
        },
        {
          id: 'user-1',
          data: () => ({
            leagueId: 'league-1',
            userId: 'user-1',
            teamName: 'First Team',
            role: 'owner',
            isActive: true,
            joinedAt: '2026-05-31T01:00:00.000Z',
          }),
        },
      ],
    });
    const embeddedMembers = {
      orderBy: vi.fn(() => ({ get: embeddedGet })),
    };
    const leagueDoc = {
      collection: vi.fn(() => embeddedMembers),
    };
    const leaguesCollection = {
      doc: vi.fn(() => leagueDoc),
    };

    adminMocks.collection.mockReturnValue(leaguesCollection);

    const result = await listActiveLeagueMembers('league-1');

    expect(adminMocks.collection).toHaveBeenCalledTimes(1);
    expect(adminMocks.collection).toHaveBeenCalledWith('leagues');
    expect(leaguesCollection.doc).toHaveBeenCalledWith('league-1');
    expect(leagueDoc.collection).toHaveBeenCalledWith('members');
    expect(embeddedMembers.orderBy).toHaveBeenCalledWith('joinedAt', 'asc');
    expect(result.map((member) => member.userId)).toEqual(['user-1', 'user-2']);
    expect(result[0]).toMatchObject({
      id: 'user-1',
      source: 'embedded',
      role: 'owner',
      isActive: true,
    });
  });

  it('falls back to active legacy members only when embedded members are absent', async () => {
    const embeddedGet = vi.fn().mockResolvedValue({
      empty: true,
      docs: [],
    });
    const embeddedMembers = {
      orderBy: vi.fn(() => ({ get: embeddedGet })),
    };
    const leagueDoc = {
      collection: vi.fn(() => embeddedMembers),
    };
    const leaguesCollection = {
      doc: vi.fn(() => leagueDoc),
    };
    const legacyGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'inactive-legacy',
          data: () => ({ leagueId: 'league-1', userId: 'old-user', isActive: false }),
        },
        {
          id: 'active-legacy',
          data: () => ({
            leagueId: 'league-1',
            userId: 'legacy-user',
            role: 'member',
            teamName: 'Legacy Team',
            isActive: true,
            joinedAt: '2026-05-31T01:00:00.000Z',
          }),
        },
      ],
    });
    const legacyQuery = {
      where: vi.fn(() => legacyQuery),
      orderBy: vi.fn(() => ({ get: legacyGet })),
    };

    adminMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagues') return leaguesCollection;
      if (collectionName === 'leagueMembers') return legacyQuery;
      throw new Error(`Unexpected collection ${collectionName}`);
    });

    const result = await listActiveLeagueMembers('league-1');

    expect(adminMocks.collection).toHaveBeenCalledWith('leagueMembers');
    expect(legacyQuery.where).toHaveBeenCalledWith('leagueId', '==', 'league-1');
    expect(legacyQuery.orderBy).toHaveBeenCalledWith('joinedAt', 'asc');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'active-legacy',
      userId: 'legacy-user',
      source: 'legacy',
      isActive: true,
    });
  });

  it('lists active embedded user memberships without reading the top-level mirror', async () => {
    const embeddedGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'user-1',
          ref: { parent: { parent: { id: 'league-removed' } } },
          data: () => ({
            userId: 'user-1',
            teamName: 'Removed Team',
            role: 'member',
            isActive: false,
            joinedAt: '2026-05-31T03:00:00.000Z',
          }),
        },
        {
          id: 'user-1',
          ref: { parent: { parent: { id: 'league-2' } } },
          data: () => ({
            leagueId: 'league-2',
            userId: 'user-1',
            teamName: 'Second Team',
            role: 'member',
            isActive: true,
            joinedAt: '2026-05-31T02:00:00.000Z',
          }),
        },
        {
          id: 'user-1',
          ref: { parent: { parent: { id: 'league-1' } } },
          data: () => ({
            userId: 'user-1',
            teamName: 'First Team',
            role: 'owner',
            isActive: true,
            joinedAt: '2026-05-31T01:00:00.000Z',
          }),
        },
      ],
    });
    const collectionGroupQuery = {
      where: vi.fn(() => ({ get: embeddedGet })),
    };

    adminMocks.collectionGroup.mockReturnValue(collectionGroupQuery);

    const result = await listActiveUserLeagueMemberships('user-1');

    expect(adminMocks.collectionGroup).toHaveBeenCalledWith('members');
    expect(collectionGroupQuery.where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(adminMocks.collection).not.toHaveBeenCalledWith('leagueMembers');
    expect(result.map((member) => member.leagueId)).toEqual(['league-1', 'league-2']);
    expect(result[0]).toMatchObject({
      id: 'user-1',
      source: 'embedded',
      role: 'owner',
      isActive: true,
    });
  });

  it('falls back to active top-level user memberships only when embedded user memberships are absent', async () => {
    const embeddedGet = vi.fn().mockResolvedValue({
      empty: true,
      docs: [],
    });
    const collectionGroupQuery = {
      where: vi.fn(() => ({ get: embeddedGet })),
    };
    const legacyGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'inactive-legacy',
          data: () => ({
            leagueId: 'league-old',
            userId: 'user-1',
            role: 'member',
            teamName: 'Old Team',
            isActive: false,
            joinedAt: '2026-05-31T01:00:00.000Z',
          }),
        },
        {
          id: 'active-legacy',
          data: () => ({
            leagueId: 'league-active',
            userId: 'user-1',
            role: 'member',
            teamName: 'Active Team',
            isActive: true,
            joinedAt: '2026-05-31T02:00:00.000Z',
          }),
        },
      ],
    });
    const legacyQuery = {
      where: vi.fn(() => legacyQuery),
      get: legacyGet,
    };

    adminMocks.collectionGroup.mockReturnValue(collectionGroupQuery);
    adminMocks.collection.mockImplementation((collectionName: string) => {
      if (collectionName === 'leagueMembers') return legacyQuery;
      throw new Error(`Unexpected collection ${collectionName}`);
    });

    const result = await listActiveUserLeagueMemberships('user-1');

    expect(adminMocks.collectionGroup).toHaveBeenCalledWith('members');
    expect(collectionGroupQuery.where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(adminMocks.collection).toHaveBeenCalledWith('leagueMembers');
    expect(legacyQuery.where).toHaveBeenCalledWith('userId', '==', 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'active-legacy',
      leagueId: 'league-active',
      source: 'legacy',
      isActive: true,
    });
  });
});
