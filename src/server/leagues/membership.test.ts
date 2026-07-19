import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  getLeagueMembership: vi.fn(),
  isLeagueManagerRole: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    draft: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({ get: vi.fn() })),
    })),
  },
}));
vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: mocks.getLeagueMembership,
  isLeagueManagerRole: mocks.isLeagueManagerRole,
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
});
