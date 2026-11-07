import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  firestoreCollection: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    draft: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: { collection: mocks.firestoreCollection },
}));

import { getLeagueMembershipAccess } from './membership';

describe('Prisma league membership access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not grant commissioner powers to an ordinary MANAGER-role member', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      ownerId: 'owner',
      members: [
        {
          id: 'member-1',
          role: 'MANAGER',
          isActive: true,
          status: 'ACTIVE',
          isCoCommissioner: false,
        },
      ],
    });

    await expect(getLeagueMembershipAccess('league-1', 'member-user')).resolves.toMatchObject({
      isMember: true,
      canManage: false,
    });
  });

  it('grants commissioner powers to the owner or an explicit co-commissioner', async () => {
    mocks.leagueFindUnique
      .mockResolvedValueOnce({
        ownerId: 'owner',
        members: [
          {
            id: 'owner-member',
            role: 'OWNER',
            isActive: true,
            status: 'ACTIVE',
            isCoCommissioner: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        ownerId: 'owner',
        members: [
          {
            id: 'co-member',
            role: 'MANAGER',
            isActive: true,
            status: 'ACTIVE',
            isCoCommissioner: true,
          },
        ],
      });

    await expect(getLeagueMembershipAccess('league-1', 'owner')).resolves.toMatchObject({
      canManage: true,
    });
    await expect(getLeagueMembershipAccess('league-1', 'co-user')).resolves.toMatchObject({
      canManage: true,
    });
  });

  it('does not treat a Firestore-only owner or member as a member when the league has no Prisma row', async () => {
    mocks.leagueFindUnique.mockResolvedValue(null);
    mocks.firestoreCollection.mockImplementation(() => {
      throw new Error('Firestore must not decide membership');
    });

    await expect(getLeagueMembershipAccess('firestore-league', 'user-1')).resolves.toEqual({
      leagueId: 'firestore-league',
      userId: 'user-1',
      isMember: false,
      canManage: false,
    });
    expect(mocks.firestoreCollection).not.toHaveBeenCalled();
  });
});
