import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getLeagueMembershipAccess: vi.fn(),
  leagueFindUnique: vi.fn(),
  leagueMemberFindFirst: vi.fn(),
  leagueRosterPlayerFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  teamActionFindMany: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: mocks.getLeagueMembershipAccess,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    leagueMember: { findFirst: mocks.leagueMemberFindFirst },
    leagueRosterPlayer: { findMany: mocks.leagueRosterPlayerFindMany },
    player: { findMany: mocks.playerFindMany },
    teamAction: { findMany: mocks.teamActionFindMany },
  },
}));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerId: vi.fn(async (playerId: string) => playerId),
  resolveCanonicalPlayerIds: vi.fn(
    async (playerIds: string[]) => new Map(playerIds.map((id) => [id, id]))
  ),
}));
vi.mock('@/server/draft/readModels/draftPlayerReadModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/draft/readModels/draftPlayerReadModel')>()),
  loadDraftPlayerStatsLookup: vi.fn(async () => null),
}));
vi.mock('@/server/waivers/WaiverProcessingService', () => ({
  PrismaWaiverClaimStore: class {
    loadMemberClaims = vi.fn(async () => []);
    loadWaiverSettings = vi.fn(async () => ({ system: 'PRIORITY' }));
    loadRemainingFaab = vi.fn(async () => undefined);
  },
}));
vi.mock('@/server/waivers/waiverActivity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/waivers/waiverActivity')>()),
  loadWaiverOutcomes: vi.fn(async () => []),
}));

import { GET } from './route';

const HOLD_ENDS = new Date(Date.now() + 12 * 60 * 60 * 1000);

describe('GET /api/leagues/[id]/waivers available players', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: true });
    mocks.leagueFindUnique.mockResolvedValue({ categoriesJson: null, settings: null });
    mocks.leagueMemberFindFirst.mockResolvedValue({ id: 'member-1', teamName: 'Team One' });
    mocks.leagueRosterPlayerFindMany.mockImplementation(
      ({ where }: { where: { memberId?: string } }) =>
        Promise.resolve(where.memberId ? [] : [{ playerId: 'rostered-player' }])
    );
    mocks.playerFindMany.mockResolvedValue([
      { id: 'dropped-player', name: 'Dropped Player', club: 'SYD', position: 'MID' },
      { id: 'free-player', name: 'Free Player', club: 'CARL', position: 'FWD' },
      { id: 'rostered-player', name: 'Rostered Player', club: 'GEEL', position: 'DEF' },
    ]);
    // A drop still inside its waiver period: he is waiver-only, so the Waivers tab is where he is won.
    mocks.teamActionFindMany.mockResolvedValue([
      {
        actionType: 'DROP_PLAYER',
        details: { playerId: 'dropped-player' },
        processingAt: HOLD_ENDS,
      },
    ]);
  });

  it('lists a player under a pending drop hold, and still leaves out rostered players', async () => {
    const response = await GET(new NextRequest('http://localhost/api/leagues/league-1/waivers'), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    const listedIds = body.availablePlayers.map((player: { id: string }) => player.id);
    expect(listedIds).toEqual(['dropped-player', 'free-player']);
    expect(mocks.leagueRosterPlayerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1' } })
    );
  });
});
