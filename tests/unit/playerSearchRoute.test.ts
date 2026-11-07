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
});
