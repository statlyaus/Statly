import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthenticatedUserId: vi.fn() }));
const dataMocks = vi.hoisted(() => ({ getPlayers: vi.fn() }));
const loggerMocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  leagueMember: { findFirst: vi.fn() },
  league: { findUnique: vi.fn() },
  leagueRoster: { findUnique: vi.fn(), upsert: vi.fn() },
  leagueRosterPlayer: { findMany: vi.fn() },
}));

vi.mock('@/lib/serverAuth', () => authMocks);
vi.mock('@/lib/data', () => dataMocks);
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/lib/ensureLobbyColumns', () => ({
  ensureRosterTables: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/logger', () => ({ logger: loggerMocks }));

import { GET, PUT } from '@/app/api/leagues/[id]/roster/[userId]/route';

const params = Promise.resolve({ id: 'league-1', userId: 'user-1' });

describe('league roster route read model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    prismaMocks.$transaction.mockImplementation((work: unknown) => {
      if (Array.isArray(work)) return Promise.all(work);
      if (typeof work === 'function') return work(prismaMocks);
      return Promise.resolve(work);
    });
    prismaMocks.leagueMember.findFirst.mockResolvedValue({
      id: 'member-1',
      teamName: 'Alpha FC',
    });
    prismaMocks.league.findUnique.mockResolvedValue({
      id: 'league-1',
      categoriesJson: JSON.stringify(['goals', 'tackles', 'inside50s']),
      settings: {
        categoryDirectionsJson: JSON.stringify({ tackles: 'LOW_WINS' }),
        enableCaptainSystem: true,
        captainMultiplier: 2,
        viceCaptainMultiplier: 1.5,
      },
    });
    prismaMocks.leagueRoster.findUnique.mockResolvedValue({
      id: 'roster-1',
      captainId: 'alex_alpha',
      viceCaptainId: null,
      benchOrder: JSON.stringify([]),
      updatedAt: new Date('2025-07-19T10:00:00.000Z'),
    });
    prismaMocks.leagueRosterPlayer.findMany.mockResolvedValue([
      {
        player: {
          id: 'alex_alpha',
          name: 'Alex Alpha',
          club: 'Adelaide',
          position: 'MID',
        },
      },
    ]);
    dataMocks.getPlayers.mockResolvedValue([
      {
        id: 'alex-alpha-adelaide',
        name: 'Alex Alpha',
        team: 'Adelaide',
        position: 'MID',
        stats: {},
        statsBySeason: {
          '2025': {
            games: 10,
            dataThrough: '2025-07-18',
            stats: { goals: 20, tackles: 0 },
            basisByStat: { goals: 'TOTAL', tackles: 'TOTAL' },
          },
        },
      },
    ]);
  });

  it('returns canonical roster ownership with ordered per-game category data', async () => {
    const response = await GET(request('GET'), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.leaguePlayerStats.context).toEqual({
      basis: 'PER_GAME',
      period: 'SEASON',
      season: 2025,
      availableSeasons: [2025],
      dataThrough: '2025-07-18',
    });
    expect(
      body.data.leaguePlayerStats.columns.map((column: { key: string }) => column.key)
    ).toEqual(['goals', 'tackles', 'inside50s']);
    expect(body.data.leaguePlayerStats.columns[1].direction).toBe('LOW_WINS');
    expect(body.data.roster).toMatchObject({
      playerIds: ['alex_alpha'],
      players: [
        {
          id: 'alex_alpha',
          gamesPlayed: 10,
          stats: { goals: 2, tackles: 0, inside50s: null },
          leagueStats: {
            gamesPlayed: 10,
            values: { goals: 2, tackles: 0, inside50s: null },
          },
        },
      ],
    });
    const player = body.data.roster.players[0];
    expect(player).not.toHaveProperty('statsTotal');
    expect(player).not.toHaveProperty('price');
    expect(player).not.toHaveProperty('form');
    expect(player).not.toHaveProperty('projectedScore');
    expect(body.data.roster).not.toHaveProperty('totalValue');
    expect(body.data.roster).not.toHaveProperty('averageScore');
    expect(prismaMocks.leagueRoster.upsert).not.toHaveBeenCalled();
  });

  it('rejects a stale client roster instead of changing canonical ownership', async () => {
    prismaMocks.leagueRosterPlayer.findMany.mockResolvedValueOnce([{ playerId: 'alex_alpha' }]);

    const response = await PUT(
      request('PUT', {
        playerIds: ['alex_alpha', 'invented_player'],
        captainId: 'alex_alpha',
      }),
      { params }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.message).toBe('The roster changed. Refresh before saving team preferences.');
    expect(prismaMocks.leagueRoster.upsert).not.toHaveBeenCalled();
  });
});

function request(method: 'GET' | 'PUT', body?: unknown): NextRequest {
  return new Request('https://statly.test/api/leagues/league-1/roster/user-1', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest;
}
