import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisGetMock = vi.fn();
const redisSetMock = vi.fn();
const rankingSnapshotFindFirstMock = vi.fn();
const listPlayerRankingSnapshotsMock = vi.fn();
const resolveLatestProjectedSeasonMock = vi.fn();

vi.mock('@/lib/redis', () => ({
  redisClient: {
    isConnected: vi.fn(() => true),
    connect: vi.fn(async () => undefined),
    get: redisGetMock,
    set: redisSetMock,
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerRankingSnapshot: {
      findFirst: rankingSnapshotFindFirstMock,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/server/readModels/playerReadModels', () => ({
  listPlayerRankingSnapshots: (...args: unknown[]) => listPlayerRankingSnapshotsMock(...args),
  resolveLatestProjectedSeason: (...args: unknown[]) => resolveLatestProjectedSeasonMock(...args),
}));

describe('GET /api/player-stats/aggregate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T00:00:00.000Z'));
    redisGetMock.mockResolvedValue(null);
    redisSetMock.mockResolvedValue(undefined);
    rankingSnapshotFindFirstMock.mockResolvedValue({
      snapshotAt: new Date('2026-03-14T00:00:00.000Z'),
    });
    resolveLatestProjectedSeasonMock.mockResolvedValue(2026);
    listPlayerRankingSnapshotsMock.mockResolvedValue([
      {
        id: '2026:season:ply_ed_richards',
        season: 2026,
        scope: 'season',
        rank: 1,
        playerId: 'ply_ed_richards',
        playerName: 'Ed Richards',
        club: 'Western Bulldogs',
        position: 'MID',
        gamesPlayed: 2,
        averageScore: 19,
        totalValue: 38,
        categories: {
          goals: 1.5,
          tackles: 4,
          inside50s: 5,
          intercepts: 2,
          contestedMarks: 1,
          rebound50s: 3,
          contestedPossessions: 6,
          effectiveDisposals: 12,
          scoreInvolvements: 7,
        },
        stats: {
          goals: 1.5,
          behinds: 0,
          kicks: 10,
          handballs: 5,
          disposals: 15,
          marks: 3,
          tackles: 4,
          hitouts: 0,
          clearances: 4,
          inside50s: 5,
          rebound50s: 3,
          contestedPossessions: 6,
          uncontestedPossessions: 5,
          goalAssists: 1,
          scoreInvolvements: 7,
          effectiveDisposals: 12,
          disposalEffPct: 70,
          timeOnGroundPct: 80,
          contestedMarks: 1,
          intercepts: 2,
          metresGained: 250,
          turnovers: 1.5,
          freesFor: 1,
          freesAgainst: 0.5,
          onePercenters: 0,
          clangers: 1,
        },
        totals: {
          goals: 3,
          behinds: 0,
          kicks: 20,
          handballs: 10,
          disposals: 30,
          marks: 6,
          tackles: 8,
          hitouts: 0,
          clearances: 8,
          inside50s: 10,
          rebound50s: 6,
          contestedPossessions: 12,
          uncontestedPossessions: 10,
          goalAssists: 2,
          scoreInvolvements: 14,
          effectiveDisposals: 24,
          disposalEffPct: 140,
          timeOnGroundPct: 160,
          contestedMarks: 2,
          intercepts: 4,
          metresGained: 500,
          turnovers: 3,
          freesFor: 2,
          freesAgainst: 1,
          onePercenters: 0,
          clangers: 2,
        },
        snapshotAt: new Date('2026-03-14T00:00:00.000Z'),
      },
    ]);
  });

  it('transforms projected ranking snapshots into aggregate response rows', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/player-stats/aggregate?season=2026&limit=10')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source).toBe('snapshot');
    expect(body.count).toBe(1);
    expect(body.data[0]).toMatchObject({
      player_id: 'ply_ed_richards',
      player_name: 'Ed Richards',
      team: 'Western Bulldogs',
      position: 'MID',
      season: 2026,
      games: 2,
      totalValue: 38,
      fantasy_points: 38,
    });
    expect(body.data[0].averages.goals).toBe(1.5);
    expect(body.data[0].categories.tackles).toBe(4);
    expect(body.data[0].tenthCell).toEqual({
      type: 'efficiency',
      value: 70,
      label: 'DE%',
    });
    expect(redisSetMock).toHaveBeenCalled();
  });

  it('uses the latest projected season when season is omitted', async () => {
    resolveLatestProjectedSeasonMock.mockResolvedValueOnce(2025);

    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/player-stats/aggregate'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.query.season).toBe(2025);
    expect(resolveLatestProjectedSeasonMock).toHaveBeenCalled();
  });

  it('rejects public refresh requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/player-stats/aggregate?refresh=true')
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('Manual refresh');
  });
});
