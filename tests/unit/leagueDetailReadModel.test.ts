import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActiveLeagueMembers: vi.fn(),
  leagueFindUnique: vi.fn(),
  waiverPriorityFindMany: vi.fn(),
  getLeagueDraftOperationalReadiness: vi.fn(),
  getLeagueMembershipAccess: vi.fn(),
  firestoreCollection: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    waiverPriority: { findMany: mocks.waiverPriorityFindMany },
  },
}));
vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: mocks.firestoreCollection,
  },
}));
vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn(),
  listActiveLeagueMembers: mocks.listActiveLeagueMembers,
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('@/server/draft/services/DraftReadinessService', () => ({
  getLeagueDraftOperationalReadiness: mocks.getLeagueDraftOperationalReadiness,
}));
vi.mock('@/server/leagues/membership', async () => ({
  getLeagueMembershipAccess: mocks.getLeagueMembershipAccess,
  isActivePrismaMembership: (await import('@/server/leagues/activeMembership'))
    .isActivePrismaMembership,
}));

import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail';

describe('league detail authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: false, canManage: false });
  });

  it.each(['test-league-id', 'league-1'])(
    'rejects an unauthenticated read of %s without loading the league',
    async (leagueId) => {
      const result = await loadAuthorizedLeagueDetail(leagueId, null);

      expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
      expect(mocks.leagueFindUnique).not.toHaveBeenCalled();
    }
  );

  it.each(['test-league-id', 'league-1'])(
    'rejects a non-member read of %s without loading the league',
    async (leagueId) => {
      const result = await loadAuthorizedLeagueDetail(leagueId, 'outsider');

      expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
      expect(mocks.getLeagueMembershipAccess).toHaveBeenCalledWith(leagueId, 'outsider');
      expect(mocks.leagueFindUnique).not.toHaveBeenCalled();
    }
  );

  it('does not serve a built-in fixture for test-league-id when no league exists', async () => {
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: true, canManage: false });
    mocks.leagueFindUnique.mockResolvedValue(null);
    mocks.firestoreCollection.mockReturnValue({
      doc: () => ({ get: async () => ({ exists: false }) }),
    });

    const result = await loadAuthorizedLeagueDetail('test-league-id', 'member-user');

    expect(result).toEqual({ ok: false, status: 404, error: 'League not found' });
  });
});

describe('league detail Prisma member projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waiverPriorityFindMany.mockResolvedValue([]);
    mocks.getLeagueDraftOperationalReadiness.mockResolvedValue({ isReady: true });
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: true, canManage: true });
  });

  it.each([
    ['SCHEDULED', 'preseason'],
    ['LIVE', 'active'],
    ['PAUSED', 'active'],
    ['COMPLETED', 'completed'],
  ] as const)('maps a %s draft to a %s league', async (draftStatus, leagueStatus) => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'test-league-id',
      name: 'Test League',
      inviteCode: 'TEST123',
      ownerId: 'owner-user',
      categoriesJson: null,
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      settings: { maxTeams: 2 },
      drafts: [{ id: 'draft-1', status: draftStatus }],
      members: [
        {
          id: 'active-member',
          leagueId: 'test-league-id',
          userId: 'owner-user',
          teamName: 'Active Team',
          teamLogoUrl: null,
          teamLogoPositionX: null,
          teamLogoPositionY: null,
          teamLogoZoom: null,
          joinedAt: new Date('2026-07-01T00:00:00.000Z'),
          isActive: true,
          status: 'ACTIVE',
        },
      ],
    } as never);

    const result = await loadAuthorizedLeagueDetail('test-league-id', 'owner-user');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.league?.status).toBe(leagueStatus);
  });

  it('carries the league timezone so league times can be shown in it', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'test-league-id',
      name: 'Test League',
      inviteCode: 'TEST123',
      ownerId: 'owner-user',
      categoriesJson: null,
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      settings: { maxTeams: 2, timeZone: 'Australia/Perth' },
      drafts: [],
      members: [],
    } as never);

    const result = await loadAuthorizedLeagueDetail('test-league-id', 'owner-user');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.league?.timeZone).toBe('Australia/Perth');
  });

  it('excludes retained inactive members from teams and league capacity', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'test-league-id',
      name: 'Test League',
      inviteCode: 'TEST123',
      ownerId: 'owner-user',
      categoriesJson: null,
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      settings: { maxTeams: 2 },
      drafts: [],
      members: [
        {
          id: 'active-member',
          leagueId: 'test-league-id',
          userId: 'owner-user',
          teamName: 'Active Team',
          teamLogoUrl: null,
          teamLogoPositionX: null,
          teamLogoPositionY: null,
          teamLogoZoom: null,
          joinedAt: new Date('2026-07-01T00:00:00.000Z'),
          isActive: true,
          status: 'ACTIVE',
        },
        {
          id: 'removed-member',
          leagueId: 'test-league-id',
          userId: 'former-user',
          teamName: 'Former Team',
          teamLogoUrl: null,
          teamLogoPositionX: null,
          teamLogoPositionY: null,
          teamLogoZoom: null,
          joinedAt: new Date('2026-07-02T00:00:00.000Z'),
          isActive: false,
          status: 'REMOVED',
        },
      ],
    } as never);

    const result = await loadAuthorizedLeagueDetail('test-league-id', 'owner-user');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.members.map((member) => member.id)).toEqual(['active-member']);
    expect(result.league).toMatchObject({
      currentTeams: 1,
      maxTeams: 2,
    });
  });

  it('follows Prisma membership when the Firestore projection still lists a removed team', async () => {
    mocks.listActiveLeagueMembers.mockResolvedValue([
      {
        id: 'active-member',
        leagueId: 'test-league-id',
        userId: 'owner-user',
        role: 'owner',
        teamName: 'Active Team',
        isActive: true,
        source: 'embedded',
      },
      {
        id: 'removed-member',
        leagueId: 'test-league-id',
        userId: 'former-user',
        role: 'member',
        teamName: 'Former Team',
        isActive: true,
        source: 'embedded',
      },
    ]);
    mocks.leagueFindUnique.mockResolvedValue({
      id: 'test-league-id',
      name: 'Test League',
      inviteCode: 'TEST123',
      ownerId: 'owner-user',
      categoriesJson: null,
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
      settings: { maxTeams: 2 },
      drafts: [],
      members: [
        buildPrismaMember({
          id: 'active-member',
          userId: 'owner-user',
          isActive: true,
          status: 'ACTIVE',
        }),
        buildPrismaMember({
          id: 'removed-member',
          userId: 'former-user',
          isActive: false,
          status: 'REMOVED',
        }),
      ],
    } as never);

    const result = await loadAuthorizedLeagueDetail('test-league-id', 'owner-user');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.members.map((member) => member.userId)).toEqual(['owner-user']);
    expect(result.league).toMatchObject({ currentTeams: 1 });
    expect(mocks.listActiveLeagueMembers).not.toHaveBeenCalled();
  });
});

function buildPrismaMember(input: {
  id: string;
  userId: string;
  isActive: boolean;
  status: string;
}) {
  return {
    ...input,
    leagueId: 'test-league-id',
    teamName: `${input.id} team`,
    teamLogoUrl: null,
    teamLogoPositionX: null,
    teamLogoPositionY: null,
    teamLogoZoom: null,
    joinedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}
