import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    league: { findUnique: vi.fn(), update: vi.fn() },
    leagueSeason: { findFirst: vi.fn(), upsert: vi.fn() },
    socialBoardCategory: { upsert: vi.fn() },
  };
  return {
    getLeagueMembershipAccess: vi.fn(),
    socialMuteFindFirst: vi.fn(),
    leagueMemberFindFirst: vi.fn(),
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock('server-only', () => ({}));

vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: mocks.getLeagueMembershipAccess,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    socialMute: { findFirst: mocks.socialMuteFindFirst },
    leagueMember: { findFirst: mocks.leagueMemberFindFirst },
  },
}));

import { requireLeagueSocialAccess, requireSocialPublishingAccess } from './socialAccess';

describe('league social access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.league.findUnique.mockResolvedValue({
      id: 'league-1',
      activeSeasonId: 'season-1',
      settings: { startAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    mocks.tx.leagueSeason.findFirst.mockResolvedValue({ id: 'season-1' });
    mocks.socialMuteFindFirst.mockResolvedValue(null);
    mocks.leagueMemberFindFirst.mockResolvedValue({
      socialStandardsAcceptedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('denies non-members before social data is read', async () => {
    mocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'outsider',
      isMember: false,
      canManage: false,
    });

    await expect(requireLeagueSocialAccess('league-1', 'outsider')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.socialMuteFindFirst).not.toHaveBeenCalled();
  });

  it('returns the active season and commissioner permission for a current member', async () => {
    mocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'owner',
      memberId: 'member-1',
      isMember: true,
      canManage: true,
    });

    await expect(requireLeagueSocialAccess('league-1', 'owner')).resolves.toEqual({
      leagueId: 'league-1',
      seasonId: 'season-1',
      userId: 'owner',
      memberId: 'member-1',
      canManage: true,
      mutedUntil: null,
      standardsAccepted: true,
      canPublish: true,
    });
  });

  it('allows muted members to read while rejecting publication', async () => {
    const expiresAt = new Date('2026-07-20T00:00:00.000Z');
    mocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'member',
      memberId: 'member-2',
      isMember: true,
      canManage: false,
    });
    mocks.socialMuteFindFirst.mockResolvedValue({ expiresAt });

    const access = await requireLeagueSocialAccess('league-1', 'member');
    expect(access.canPublish).toBe(false);
    expect(() => requireSocialPublishingAccess(access)).toThrow(/cannot publish/i);
  });

  it('seeds default categories for a migrated league with an existing active season', async () => {
    mocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'member',
      memberId: 'member-2',
      isMember: true,
      canManage: false,
    });

    await requireLeagueSocialAccess('league-1', 'member');

    expect(mocks.tx.socialBoardCategory.upsert).toHaveBeenCalledTimes(4);
    expect(mocks.tx.socialBoardCategory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { seasonId_slug: { seasonId: 'season-1', slug: 'announcements' } },
      })
    );
  });

  it('requires community standards acceptance before publication', async () => {
    mocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'member',
      memberId: 'member-2',
      isMember: true,
      canManage: false,
    });
    mocks.leagueMemberFindFirst.mockResolvedValue({ socialStandardsAcceptedAt: null });

    const access = await requireLeagueSocialAccess('league-1', 'member');

    expect(access.standardsAccepted).toBe(false);
    expect(access.canPublish).toBe(false);
    expect(() => requireSocialPublishingAccess(access)).toThrow(/community standards/i);
  });
});
