import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listActiveLeagueMembers: vi.fn(),
  leagueFindUnique: vi.fn(),
  waiverPriorityFindMany: vi.fn(),
  getLeagueDraftOperationalReadiness: vi.fn(),
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
    collection: vi.fn(),
  },
}));
vi.mock('@/lib/leagueMembership', () => ({
  getLeagueMembership: vi.fn(),
  isLeagueManagerRole: vi.fn(),
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

import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail';

describe('league detail Prisma member projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waiverPriorityFindMany.mockResolvedValue([]);
    mocks.getLeagueDraftOperationalReadiness.mockResolvedValue({ isReady: true });
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

    const result = await loadAuthorizedLeagueDetail('test-league-id', null);

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

    const result = await loadAuthorizedLeagueDetail('test-league-id', null);

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
