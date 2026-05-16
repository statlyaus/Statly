import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRouteContext } from '@/testUtils';

import { GET } from './route';

const resolveSeasonMock = vi.fn();
const ensureSeasonReadyMock = vi.fn();
const getSeasonSummaryMapMock = vi.fn();
const getLatestSnapshotMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock('@/server/stats/StatsReadService', () => ({
  statsReadService: {
    resolveSeason: (...args: unknown[]) => resolveSeasonMock(...args),
    ensureSeasonReady: (...args: unknown[]) => ensureSeasonReadyMock(...args),
    getSeasonSummaryMap: (...args: unknown[]) => getSeasonSummaryMapMock(...args),
    getLatestSnapshot: (...args: unknown[]) => getLatestSnapshotMock(...args),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GET /api/players/[id]/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSeasonMock.mockResolvedValue(2025);
    ensureSeasonReadyMock.mockResolvedValue(undefined);
    getLatestSnapshotMock.mockResolvedValue({ round: 6 });
    findUniqueMock.mockResolvedValue({
      name: 'John Smith',
      club: 'GEE',
      position: 'MID',
    });

    getSeasonSummaryMapMock.mockResolvedValue(
      new Map([
        [
          'john_smith',
          {
            playerId: 'john_smith',
            playerName: 'John Smith',
            club: 'GEE',
            position: 'MID',
            gamesPlayed: 2,
            averageScore: 160,
            totalValue: 320,
            stats: {
              goals: 1.5,
              behinds: 0.5,
              kicks: 13.5,
              handballs: 9,
              disposals: 22.5,
              marks: 4.5,
              tackles: 5,
              hitouts: 0.5,
              clearances: 4.5,
              inside50s: 2.5,
              rebound50s: 1.5,
              contestedPossessions: 11,
              uncontestedPossessions: 16,
              goalAssists: 2.5,
              scoreInvolvements: 8,
              effectiveDisposals: 18,
              disposalEffPct: 75,
              timeOnGroundPct: 81,
              minutes: 98,
              contestedMarks: 1.5,
              intercepts: 2.5,
              metresGained: 390,
              turnovers: 3.5,
              freesFor: 1.5,
              freesAgainst: 0.5,
              onePercenters: 1.5,
              clangers: 1.5,
            },
            totals: {
              goals: 3,
              behinds: 1,
              kicks: 27,
              handballs: 18,
              disposals: 45,
              marks: 9,
              tackles: 10,
              hitouts: 1,
              clearances: 9,
              inside50s: 5,
              rebound50s: 3,
              contestedPossessions: 22,
              uncontestedPossessions: 32,
              goalAssists: 5,
              scoreInvolvements: 16,
              effectiveDisposals: 36,
              disposalEffPct: 150,
              timeOnGroundPct: 162,
              minutes: 196,
              contestedMarks: 3,
              intercepts: 5,
              metresGained: 780,
              turnovers: 7,
              freesFor: 3,
              freesAgainst: 1,
              onePercenters: 3,
              clangers: 3,
            },
          },
        ],
      ])
    );
  });

  it('returns the full canonical projected stat set for a player', async () => {
    const req = new NextRequest('http://localhost/api/players/john_smith/stats');
    const res = await GET(req, createRouteContext({ id: 'john_smith' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(resolveSeasonMock).toHaveBeenCalled();
    expect(ensureSeasonReadyMock).toHaveBeenCalledWith(2025);
    expect(getSeasonSummaryMapMock).toHaveBeenCalledWith(2025, ['john_smith']);
    expect(body.data).toMatchObject({
      playerName: 'John Smith',
      totalGames: 2,
      totalScore: 320,
      averageScore: 160,
      latestRound: 6,
      averageStats: {
        goals: 1.5,
        disposalEffPct: 75,
        timeOnGroundPct: 81,
        minutes: 98,
      },
      totalStats: {
        goals: 3,
        disposalEffPct: 150,
        timeOnGroundPct: 162,
        minutes: 196,
      },
    });
  });

  it('returns 404 when no projected summary exists for the player', async () => {
    getSeasonSummaryMapMock.mockResolvedValue(new Map());

    const req = new NextRequest('http://localhost/api/players/jane_doe/stats');
    const res = await GET(req, createRouteContext({ id: 'jane_doe' }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
