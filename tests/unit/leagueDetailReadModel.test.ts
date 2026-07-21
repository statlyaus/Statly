import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
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
  listActiveLeagueMembers: vi.fn(),
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
});
