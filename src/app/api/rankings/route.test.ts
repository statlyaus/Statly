import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureSeasonReadyMock = vi.fn();
const listRankingsMock = vi.fn();
const publicationFindUniqueMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerProjectionPublication: {
      findUnique: (...args: unknown[]) => publicationFindUniqueMock(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/server/stats/StatsReadService', () => ({
  statsReadService: {
    ensureSeasonReady: (...args: unknown[]) => ensureSeasonReadyMock(...args),
    listRankings: (...args: unknown[]) => listRankingsMock(...args),
  },
}));

describe('GET /api/rankings', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    ensureSeasonReadyMock.mockResolvedValue(undefined);
    listRankingsMock.mockResolvedValue([
      {
        id: '2026:season:zscore_replacement:1:ply_alpha',
        season: 2026,
        scope: 'season',
        method: 'zscore_replacement',
        methodVersion: 1,
        rank: 1,
        playerId: 'ply_alpha',
        playerName: 'Alpha Player',
        club: 'Western Bulldogs',
        position: 'MID',
        gamesPlayed: 2,
        averageScore: 91,
        totalValue: 144,
        rankingValue: 2.75,
        minimumGames: 2,
        populationSize: 125,
        isSmallSample: true,
        categories: {
          goals: 1.2,
          goalAssists: 0.6,
          tackles: 0.9,
          clearances: 0.8,
          inside50s: 0.7,
          rebound50s: 0.1,
          hitouts: -0.2,
          intercepts: 0.4,
          marks: 0.5,
        },
        stats: {
          goals: 2,
          goalAssists: 1,
          tackles: 6,
          clearances: 5,
          inside50s: 4,
          rebound50s: 1,
          hitouts: 0,
          intercepts: 3,
          marks: 7,
        },
        totals: {
          goals: 4,
          goalAssists: 2,
          tackles: 12,
          clearances: 10,
          inside50s: 8,
          rebound50s: 2,
          hitouts: 0,
          intercepts: 6,
          marks: 14,
        },
        metadata: {
          replacementPosition: 'MID',
        },
        snapshotAt: new Date('2026-04-21T12:00:00.000Z'),
      },
    ]);
    publicationFindUniqueMock.mockResolvedValue({
      rankingMethod: 'zscore_replacement',
      rankingMethodVersion: 1,
      rankingMinimumGames: 2,
      rankingPopulationSize: 125,
      rankingsDirty: false,
      rankingPublishedAt: new Date('2026-04-21T12:00:00.000Z'),
    });
  });

  it('serves published season rankings from ranking snapshots', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/rankings?season=2026&sortBy=overall')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ensureSeasonReadyMock).toHaveBeenCalledWith(2026);
    expect(listRankingsMock).toHaveBeenCalledWith({ season: 2026, scope: 'season' });
    expect(body.success).toBe(true);
    expect(body.data.players[0]).toMatchObject({
      playerId: 'ply_alpha',
      playerName: 'Alpha Player',
      team: 'Western Bulldogs',
      position: 'MID',
      games: 2,
      overall: 2.75,
      rank: 1,
      isSmallSample: true,
    });
    expect(body.data.meta).toMatchObject({
      rankingMethod: 'zscore_replacement',
      rankingMethodVersion: 1,
      minimumGames: 2,
      populationSize: 125,
      rankingsDirty: false,
    });
  });

  it('rejects unpublished ranking periods', async () => {
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/rankings?period=last3'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain('Only season rankings are published');
    expect(listRankingsMock).not.toHaveBeenCalled();
  });
});
