import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPlayers: vi.fn(),
  collection: vi.fn(() => {
    throw new Error('player search must not read Firestore');
  }),
}));

vi.mock('@/lib/data', () => ({ getPlayers: mocks.getPlayers }));
vi.mock('../../src/lib/data', () => ({ getPlayers: mocks.getPlayers }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: { collection: mocks.collection } }));
vi.mock('../../src/lib/firebaseAdmin', () => ({ adminDb: { collection: mocks.collection } }));

function search(q: string) {
  return new Request(
    `https://statly.test/api/players/search?q=${encodeURIComponent(q)}`
  ) as NextRequest;
}

describe('player search route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getPlayers.mockResolvedValue([
      {
        id: 'aaron-naughton',
        name: 'Aaron Naughton',
        team: 'Western Bulldogs',
        position: 'FWD',
        games: 10,
        goals: 30,
      },
      {
        id: 'nick-daicos',
        name: 'Nick Daicos',
        team: 'Collingwood',
        position: 'MID',
        games: 12,
        goals: 8,
      },
    ]);
  });

  it('searches the canonical player list without scanning Firestore', async () => {
    const { GET } = await import('../../src/app/api/players/search/route');
    const response = await GET(search('naughton'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.players.map((player: { id: string }) => player.id)).toEqual(['aaron-naughton']);
    expect(body.players[0]).toMatchObject({
      name: 'Aaron Naughton',
      team: 'Western Bulldogs',
      totalGames: 10,
    });
    expect(mocks.collection).not.toHaveBeenCalled();
  });

  it('returns nothing for queries shorter than two characters', async () => {
    const { GET } = await import('../../src/app/api/players/search/route');
    const response = await GET(search('a'));

    await expect(response.json()).resolves.toEqual({ players: [] });
    expect(mocks.getPlayers).not.toHaveBeenCalled();
  });

  it('averages season totals over games once, ignoring the latest single-match fields', async () => {
    const seasonTotals = (games: number) => ({
      kicks: 15 * games,
      handballs: 10 * games,
      marks: 5 * games,
      tackles: 4 * games,
      goals: 2 * games,
      inside50s: 3 * games,
      contestedPossessions: 9 * games,
      timeOnGroundPct: 80,
      disposalEfficiency: 72,
    });
    mocks.getPlayers.mockResolvedValue([
      // Top-level stat fields are the latest single match (src/lib/data.ts); `stats` is the season.
      {
        id: 'ten-games',
        name: 'Rate Player Ten',
        team: 'Carlton',
        games: 10,
        goals: 0,
        kicks: 1,
        stats: seasonTotals(10),
      },
      {
        id: 'twenty-games',
        name: 'Rate Player Twenty',
        team: 'Carlton',
        games: 20,
        goals: 9,
        kicks: 40,
        stats: seasonTotals(20),
      },
    ]);
    const { calculateTotalValue } = await import('../../src/types/fantasyCategories');
    const expectedAverage = Math.round(
      calculateTotalValue({
        games: 1,
        kicks: 15,
        handballs: 10,
        marks: 5,
        tackles: 4,
        goals: 2,
        hitouts: 0,
        clearances: 0,
        inside50s: 3,
        rebound50s: 0,
        clangers: 0,
        contestedPossessions: 9,
        uncontestedPossessions: 0,
        freesFor: 0,
        freesAgainst: 0,
        onePercenters: 0,
        goalAssists: 0,
        timeOnGroundPct: 80,
        disposalEffPct: 72,
        turnovers: 0,
        intercepts: 0,
        metresGained: 0,
        contestedMarks: 0,
        effectiveDisposals: 0,
        scoreInvolvements: 0,
      })
    );

    const { GET } = await import('../../src/app/api/players/search/route');
    const body = await (await GET(search('rate player'))).json();
    const byId = Object.fromEntries(
      body.players.map((player: { id: string; averageScore: number; totalScore: number }) => [
        player.id,
        player,
      ])
    );

    expect(expectedAverage).toBeGreaterThan(0);
    expect(byId['ten-games']).toMatchObject({
      averageScore: expectedAverage,
      totalGames: 10,
    });
    expect(byId['twenty-games']).toMatchObject({
      averageScore: expectedAverage,
      totalGames: 20,
    });
  });
});
