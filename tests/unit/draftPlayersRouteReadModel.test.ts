import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

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
        statsSeason: 2026,
        availableStatSeasons: [2026, 2025],
        statsBySeason: {
          '2026': {
            games: 22,
            dataThrough: '2026-09-01',
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
            basisByStat: {
              kicks: 'TOTAL',
              handballs: 'TOTAL',
              marks: 'TOTAL',
              tackles: 'TOTAL',
              goals: 'TOTAL',
              hitouts: 'TOTAL',
              clearances: 'TOTAL',
              inside50s: 'TOTAL',
              rebound50s: 'TOTAL',
              clangers: 'TOTAL',
              contestedPossessions: 'TOTAL',
              uncontestedPossessions: 'TOTAL',
              freesFor: 'TOTAL',
              freesAgainst: 'TOTAL',
              onePercenters: 'TOTAL',
              goalAssists: 'TOTAL',
              timeOnGroundPct: 'PER_GAME',
              disposalEffPct: 'PER_GAME',
              turnovers: 'TOTAL',
              intercepts: 'TOTAL',
              metresGained: 'TOTAL',
              contestedMarks: 'TOTAL',
              effectiveDisposals: 'TOTAL',
              scoreInvolvements: 'TOTAL',
              aflFantasy: 'TOTAL',
            },
          },
        },
        stats: {},
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
    expect(body.data.statSeason).toBe(2026);
    expect(body.data.statSeasons).toEqual([2026]);
    const [calebDaniel, unknownPlayer] = body.data.players;

    expect(body.data.players[0]).toMatchObject({
      id: 'caleb_daniel',
      name: 'Caleb Daniel',
      position: 'DEF',
      club: 'North Melbourne',
      isAvailable: true,
      gamesPlayed: 22,
      avgPoints: 90,
      averagePoints: 90,
      statlyZScore: expect.any(Number),
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
    expect(calebDaniel).not.toHaveProperty('statsTotal');
    expect(calebDaniel.statlyZBreakdown).toHaveLength(REAL_DATA_NINE_CATEGORY_PRESET.length);
    expect(
      calebDaniel.statlyZBreakdown.map((entry: { category: FantasyCategoryKey }) => entry.category)
    ).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
    expect(calebDaniel.statlyZBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'goals', value: 0.5, zScore: 0 }),
        expect.objectContaining({ category: 'tackles', value: 4, zScore: 0 }),
        expect.objectContaining({ category: 'inside50s', value: 3, zScore: 0 }),
      ])
    );
    expect(calebDaniel.statlyZMissingCategories).toEqual([]);
    expect(body.data.players[1]).toMatchObject({
      id: 'unknown_player',
      name: 'Unknown Player',
      position: 'MID',
      club: 'Adelaide',
      isAvailable: true,
      statlyZScore: expect.any(Number),
    });
    expect(unknownPlayer.statlyZBreakdown).toEqual([]);
    expect(unknownPlayer.statlyZMissingCategories).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
    expect(unknownPlayer.avgPoints).toBeUndefined();
  });

  it('calculates Statly Z from the full available cohort before pagination and filters', async () => {
    const draftId = 'cmq29ngg50004ux5s39ya2azu';
    const pagePlayer = {
      id: 'ace_player',
      name: 'Ace Player',
      position: 'DEF',
      club: 'Adelaide',
      active: true,
    };
    const cohortOnlyPlayer = {
      id: 'baseline_player',
      name: 'Baseline Player',
      position: 'MID',
      club: 'Brisbane',
      active: true,
    };

    prismaMocks.draft.findUnique.mockResolvedValueOnce({
      id: draftId,
      createdAt: new Date('2026-06-06T10:00:00.000Z'),
      startedAt: null,
      completedAt: null,
      leagueId: 'league-1',
      league: {
        categoriesJson: JSON.stringify(['goals']),
      },
    });
    prismaMocks.player.findMany.mockImplementation(async (args) => {
      if (args?.take === 3 && args?.skip === 0) {
        return [pagePlayer];
      }

      return [pagePlayer, cohortOnlyPlayer];
    });
    const cohortStatsPlayers = [
      {
        id: 'ace_player',
        name: 'Ace Player',
        team: 'Adelaide',
        position: 'DEF',
        games: 2,
        statsSeason: 2026,
        availableStatSeasons: [2026],
        statsBySeason: {
          '2026': {
            games: 2,
            dataThrough: '2026-03-15',
            stats: {
              goals: 10,
              aflFantasy: 200,
            },
            basisByStat: { goals: 'TOTAL', aflFantasy: 'TOTAL' },
          },
        },
        stats: {},
      },
      {
        id: 'baseline_player',
        name: 'Baseline Player',
        team: 'Brisbane',
        position: 'MID',
        games: 2,
        statsSeason: 2026,
        availableStatSeasons: [2026],
        statsBySeason: {
          '2026': {
            games: 2,
            dataThrough: '2026-03-15',
            stats: {
              goals: 2,
              aflFantasy: 100,
            },
            basisByStat: { goals: 'TOTAL', aflFantasy: 'TOTAL' },
          },
        },
        stats: {},
      },
    ];
    dataMocks.getPlayers
      .mockResolvedValueOnce(cohortStatsPlayers)
      .mockResolvedValueOnce(cohortStatsPlayers);

    const response = await GET(
      request(`/api/drafts/${draftId}/players?q=Ace&position=DEF&page=1&pageSize=2`),
      {
        params: Promise.resolve({ id: draftId }),
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.players).toHaveLength(1);
    expect(body.data.players[0]).toMatchObject({
      id: 'ace_player',
      statlyZScore: 1,
      statlyZBreakdown: [
        {
          category: 'goals',
          value: 5,
          zScore: 1,
        },
      ],
      statlyZMissingCategories: [],
    });
    expect(body.data.players[0]).not.toHaveProperty('statsTotal');

    const pageCall = prismaMocks.player.findMany.mock.calls.find(
      ([args]) => args?.take === 3 && args?.skip === 0
    );
    const cohortCall = prismaMocks.player.findMany.mock.calls.find(
      ([args]) => args?.take === undefined
    );

    expect(pageCall?.[0]).toMatchObject({
      where: {
        active: true,
        position: 'DEF',
        name: { contains: 'Ace' },
        picks: { none: { draftId } },
      },
      skip: 0,
      take: 3,
    });
    expect(pageCall?.[0].where.name).toEqual({ contains: 'Ace' });
    expect(cohortCall?.[0]).toMatchObject({
      where: {
        active: true,
        picks: { none: { draftId } },
      },
    });
    expect(cohortCall?.[0].where).not.toHaveProperty('name');
    expect(cohortCall?.[0].where).not.toHaveProperty('position');
  });
});
