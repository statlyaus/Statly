import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const draftFindUniqueMock = vi.fn();
const pickFindManyMock = vi.fn();
const playerFindManyMock = vi.fn();
const playerCountMock = vi.fn();
const resolveLatestProjectedSeasonMock = vi.fn();
const ensurePlayerSeasonSummariesMaterializedMock = vi.fn();
const getPlayerSeasonSummaryMapMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draft: {
      findUnique: draftFindUniqueMock,
    },
    pick: {
      findMany: pickFindManyMock,
    },
    player: {
      findMany: playerFindManyMock,
      count: playerCountMock,
    },
  },
}));

vi.mock('@/server/readModels/playerReadModels', () => ({
  resolveLatestProjectedSeason: resolveLatestProjectedSeasonMock,
  ensurePlayerSeasonSummariesMaterialized: ensurePlayerSeasonSummariesMaterializedMock,
  getPlayerSeasonSummaryMap: getPlayerSeasonSummaryMapMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function request() {
  return new NextRequest(
    'http://localhost/api/drafts/draft-1/available-players?page=1&pageSize=20'
  );
}

const routeContext = { params: Promise.resolve({ id: 'draft-1' }) };

describe('GET /api/drafts/[id]/available-players', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftFindUniqueMock.mockResolvedValue({
      league: {
        categoriesJson: JSON.stringify(['goals', 'kicks']),
      },
    });
    pickFindManyMock.mockResolvedValue([
      {
        playerId: 'aaron-cadman',
        player: {
          id: 'aaron-cadman',
          name: 'Aaron Cadman',
          club: 'GWS',
        },
      },
    ]);
    const activePlayers = [
      {
        id: 'aaron-cadman',
        name: 'Aaron Cadman',
        position: 'MID',
        club: 'GWS',
      },
      {
        id: 'aaron_cadman',
        name: 'Aaron Cadman',
        position: 'MID',
        club: 'Greater Western Sydney',
      },
      {
        id: 'ply_aaron_cadman',
        name: 'Aaron Cadman',
        position: 'MID',
        club: 'Greater Western Sydney',
      },
      {
        id: 'aaron_hall',
        name: 'Aaron Hall',
        position: 'DEF',
        club: 'North Melbourne',
      },
      {
        id: 'ply_aaron_hall',
        name: 'Aaron Hall',
        position: 'DEF',
        club: 'North Melbourne',
      },
    ];
    playerFindManyMock.mockImplementation((args) => {
      const pickedIds = args?.where?.id?.in;
      if (Array.isArray(pickedIds)) {
        return Promise.resolve(activePlayers.filter((player) => pickedIds.includes(player.id)));
      }

      return Promise.resolve(activePlayers);
    });
    playerCountMock.mockResolvedValue(5);
    resolveLatestProjectedSeasonMock.mockResolvedValue(2026);
    ensurePlayerSeasonSummariesMaterializedMock.mockResolvedValue(undefined);
    getPlayerSeasonSummaryMapMock.mockResolvedValue(new Map());
  });

  it('dedupes active players by canonical identity and excludes picked aliases', async () => {
    const { GET } = await import('./route');

    const response = await GET(request(), routeContext);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.pagination.totalCount).toBe(1);
    expect(payload.data.players).toEqual([
      expect.objectContaining({
        id: 'aaron_hall',
        name: 'Aaron Hall',
        club: 'North Melbourne',
      }),
    ]);
  });
});
