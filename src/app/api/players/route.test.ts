import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaPlayerCountMock = vi.fn();
const prismaPlayerFindManyMock = vi.fn();
const prismaPlayerSeasonSummaryCountMock = vi.fn();
const prismaPlayerSeasonSummaryFindManyMock = vi.fn();
const waiverClaimFindManyMock = vi.fn();
const verifyLeagueMembershipMock = vi.fn();
const getLeagueOwnershipDetailsMock = vi.fn();
const getAuthenticatedUserIdMock = vi.fn();
const resolveLatestProjectedSeasonMock = vi.fn();
const ensurePlayerSeasonSummariesMaterializedMock = vi.fn().mockResolvedValue(undefined);
const parseStatsJsonMock = vi.fn((raw: string | null | undefined) => (raw ? JSON.parse(raw) : {}));

vi.mock('@/lib/apiMiddleware', () => ({
  middlewareConfigs: {
    public: (handler: ({ req }: { req: NextRequest }) => Promise<Response>) => (req: NextRequest) =>
      handler({ req }),
  },
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: (...args: unknown[]) => verifyLeagueMembershipMock(...args),
}));

vi.mock('@/lib/leagueOwnership', () => ({
  getLeagueOwnershipDetails: (...args: unknown[]) => getLeagueOwnershipDetailsMock(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      count: prismaPlayerCountMock,
      findMany: prismaPlayerFindManyMock,
    },
    playerSeasonSummary: {
      count: prismaPlayerSeasonSummaryCountMock,
      findMany: prismaPlayerSeasonSummaryFindManyMock,
    },
    waiverClaim: {
      findMany: waiverClaimFindManyMock,
    },
  },
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => getAuthenticatedUserIdMock(...args),
}));

vi.mock('@/server/readModels/playerReadModels', () => ({
  ensurePlayerSeasonSummariesMaterialized: (...args: unknown[]) =>
    ensurePlayerSeasonSummariesMaterializedMock(...args),
  parseStatsJson: (...args: Parameters<typeof parseStatsJsonMock>) => parseStatsJsonMock(...args),
  resolveLatestProjectedSeason: (...args: unknown[]) => resolveLatestProjectedSeasonMock(...args),
}));

describe('GET /api/players', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    prismaPlayerSeasonSummaryCountMock.mockResolvedValue(2);
    prismaPlayerSeasonSummaryFindManyMock.mockResolvedValue([
      {
        playerId: 'p1',
        playerName: 'Player One',
        club: 'Sydney',
        position: 'MID',
        gamesPlayed: 10,
        averageScore: 88,
        totalValue: 880,
        statsJson: JSON.stringify({ kicks: 22, handballs: 10 }),
        totalsJson: JSON.stringify({ kicks: 220, handballs: 100 }),
      },
      {
        playerId: 'p2',
        playerName: 'Player Two',
        club: 'GWS',
        position: 'DEF',
        gamesPlayed: 9,
        averageScore: 75,
        totalValue: 675,
        statsJson: JSON.stringify({ kicks: 18, handballs: 8 }),
        totalsJson: JSON.stringify({ kicks: 162, handballs: 72 }),
      },
    ]);
    waiverClaimFindManyMock.mockResolvedValue([]);
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: true });
    getLeagueOwnershipDetailsMock.mockResolvedValue({
      totalTeams: 10,
      counts: new Map([
        ['p1', 4],
        ['p2', 0],
      ]),
      owners: new Map([
        ['p1', ['Team Alpha']],
        ['p2', []],
      ]),
    });
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    resolveLatestProjectedSeasonMock.mockResolvedValue(2025);
  });

  it('returns paginated public players from Prisma summaries', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest(
        'http://localhost/api/players?search=Player&team=Sydney&position=MID&page=1&limit=20&season=2026'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ensurePlayerSeasonSummariesMaterializedMock).toHaveBeenCalledWith(expect.anything(), 2026);
    expect(body.total).toBe(2);
    expect(body.players[0]).toMatchObject({
      id: 'p1',
      name: 'Player One',
      team: 'Sydney',
      position: 'MID',
      kicks: 22,
      handballs: 10,
      gamesPlayed: 10,
      averageScore: 88,
      totalValue: 880,
    });
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=60');
  });

  it('defaults to the latest projected season when season is omitted', async () => {
    const { GET } = await import('./route');
    await GET(new NextRequest('http://localhost/api/players?page=1&limit=20'));

    expect(resolveLatestProjectedSeasonMock).toHaveBeenCalled();
    expect(ensurePlayerSeasonSummariesMaterializedMock).toHaveBeenCalledWith(expect.anything(), 2025);
    expect(prismaPlayerSeasonSummaryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ season: 2025 }),
      })
    );
  });

  it('enriches league-scoped results with ownership metadata', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/players?leagueId=league-1&page=1&limit=20&season=2026')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(verifyLeagueMembershipMock).toHaveBeenCalledWith('league-1', 'user-1');
    expect(body.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'p1',
          ownership: 40,
          ownershipStatus: 'Owned',
          ownerTeam: 'Team Alpha',
        }),
        expect.objectContaining({
          id: 'p2',
          ownership: 0,
          ownershipStatus: 'Available',
        }),
      ])
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
