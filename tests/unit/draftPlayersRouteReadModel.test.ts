import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const prismaMocks = vi.hoisted(() => ({
  pick: {
    findFirst: vi.fn(),
  },
  draft: {
    findUnique: vi.fn(),
  },
  player: {
    findMany: vi.fn(),
  },
}));

const readinessMocks = vi.hoisted(() => ({
  getLeagueDraftOperationalReadiness: vi.fn(),
}));

const dataMocks = vi.hoisted(() => ({
  getPlayers: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('@/server/draft/services/DraftReadinessService', () => readinessMocks);

vi.mock('@/lib/data', () => dataMocks);

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET } from '@/app/api/drafts/[id]/players/route';

function request(path = '/api/drafts/cmq29ngg50004ux5s39ya2azu/players?page=1&pageSize=2') {
  return new Request(`https://statly.test${path}`) as NextRequest;
}

describe('draft players read model route', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMocks.pick.findFirst.mockResolvedValue(null);
    prismaMocks.draft.findUnique.mockResolvedValue({
      id: 'cmq29ngg50004ux5s39ya2azu',
      createdAt: new Date('2026-06-06T10:00:00.000Z'),
      startedAt: null,
      completedAt: null,
      leagueId: 'league-1',
      league: {
        categoriesJson: JSON.stringify([...REAL_DATA_NINE_CATEGORY_PRESET]),
      },
    });
    prismaMocks.player.findMany.mockResolvedValue([
      {
        id: 'caleb_daniel',
        name: 'Caleb Daniel',
        position: 'DEF',
        club: 'North Melbourne',
        active: true,
      },
      {
        id: 'unknown_player',
        name: 'Unknown Player',
        position: 'MID',
        club: 'Adelaide',
        active: true,
      },
    ]);
    readinessMocks.getLeagueDraftOperationalReadiness.mockResolvedValue({
      leagueId: 'league-1',
      status: 'room_open',
      playerPool: { availableCount: 2, hasPlayers: true },
    });
    dataMocks.getPlayers.mockResolvedValue([
      {
        id: 'caleb_daniel',
        name: 'Caleb Daniel',
        team: 'North Melbourne',
        position: 'DEF',
        games: 22,
        stats: {
          kicks: 220,
          handballs: 176,
          marks: 132,
          tackles: 88,
          goals: 11,
          hitouts: 0,
          clearances: 44,
          inside50s: 66,
          rebound50s: 55,
          clangers: 33,
          contestedPossessions: 110,
          uncontestedPossessions: 286,
          freesFor: 22,
          freesAgainst: 11,
          onePercenters: 44,
          goalAssists: 22,
          timeOnGroundPct: 84,
          disposalEffPct: 78,
          turnovers: 44,
          intercepts: 66,
          metresGained: 6600,
          contestedMarks: 22,
          effectiveDisposals: 308,
          scoreInvolvements: 99,
          aflFantasy: 1980,
        },
      },
    ]);
  });

  it('returns selected league categories and stat-enriched available players', async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ id: 'cmq29ngg50004ux5s39ya2azu' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.selectedCategories).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
    expect(body.data.players[0]).toMatchObject({
      id: 'caleb_daniel',
      name: 'Caleb Daniel',
      position: 'DEF',
      club: 'North Melbourne',
      isAvailable: true,
      gamesPlayed: 22,
      avgPoints: 90,
      averagePoints: 90,
      statsTotal: {
        goals: 11,
        tackles: 88,
        inside50s: 66,
        intercepts: 66,
        contestedMarks: 22,
        rebound50s: 55,
        contestedPossessions: 110,
        effectiveDisposals: 308,
        scoreInvolvements: 99,
      },
      stats: {
        goals: 0.5,
        tackles: 4,
        inside50s: 3,
        intercepts: 3,
        contestedMarks: 1,
        rebound50s: 2.5,
        contestedPossessions: 5,
        effectiveDisposals: 14,
        scoreInvolvements: 4.5,
      },
    });
    expect(body.data.players[1]).toMatchObject({
      id: 'unknown_player',
      name: 'Unknown Player',
      position: 'MID',
      club: 'Adelaide',
      isAvailable: true,
    });
    expect(body.data.players[1].avgPoints).toBeUndefined();
  });
});
