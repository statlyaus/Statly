import { NextRequest } from 'next/server';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const getPlayersMock = vi.fn();
const getPrecomputedStatsForPlayersMock = vi.fn();

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {},
}));

vi.mock('@/lib/data', () => ({
  getPlayers: (...args: unknown[]) => getPlayersMock(...args),
}));

vi.mock('@/lib/precomputedStats', () => ({
  getPrecomputedStatsForPlayers: (...args: unknown[]) => getPrecomputedStatsForPlayersMock(...args),
}));

vi.mock('@/types/fantasyCategories', async () => {
  const actual = await vi.importActual<typeof import('@/types/fantasyCategories')>(
    '@/types/fantasyCategories'
  );
  return { ...actual, calculateTotalValue: vi.fn() };
});

let calculateTotalValueMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('@/types/fantasyCategories');
  calculateTotalValueMock = vi.mocked(mod.calculateTotalValue);
});

describe('GET /api/players/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calculateTotalValueMock!.mockReset();
    calculateTotalValueMock!.mockImplementation(() => 90);
    getPrecomputedStatsForPlayersMock.mockResolvedValue(new Map());
    getPlayersMock.mockResolvedValue([
      {
        id: 'john_smith',
        name: 'John Smith',
        team: 'Cats',
        position: 'MID',
        stats: {},
      },
      {
        id: 'bob_jones',
        name: 'Bob Jones',
        team: 'Dogs',
        position: 'FWD',
        stats: {},
      },
    ]);
  });

  it('returns filtered players enriched with canonical precomputed stats', async () => {
    calculateTotalValueMock!.mockImplementation(({ goals }: { goals: number }) => goals * 15);
    getPrecomputedStatsForPlayersMock.mockResolvedValue(
      new Map([
        [
          'john_smith',
          {
            gamesPlayed: 2,
            totals: { goals: 2 },
            stats: { goals: 1 },
          },
        ],
      ])
    );

    const req = new NextRequest('http://localhost/api/players/search?q=smith');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toHaveLength(1);
    expect(body.players[0]).toMatchObject({ id: 'john_smith', name: 'John Smith', totalScore: 30 });
    expect(calculateTotalValueMock!).toHaveBeenCalled();
    expect(getPrecomputedStatsForPlayersMock).toHaveBeenCalledWith(
      expect.anything(),
      ['john_smith'],
      [expect.any(Number)]
    );
  });

  it('returns empty list when query shorter than 2 characters', async () => {
    const req = new NextRequest('http://localhost/api/players/search?q=s');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toEqual([]);
    expect(getPrecomputedStatsForPlayersMock).not.toHaveBeenCalled();
  });

  it('keeps same-name players distinct when canonical ids differ', async () => {
    getPlayersMock.mockResolvedValue([
      {
        id: 'sam_power_gws',
        name: 'Sam Power',
        team: 'GWS',
        position: 'MID',
        stats: {},
      },
      {
        id: 'sam_power_crows',
        name: 'Sam Power',
        team: 'Adelaide',
        position: 'FWD',
        stats: {},
      },
    ]);
    getPrecomputedStatsForPlayersMock.mockResolvedValue(new Map());

    const req = new NextRequest('http://localhost/api/players/search?q=sam');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toHaveLength(2);
    expect(body.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sam_power_gws', name: 'Sam Power', team: 'GWS' }),
        expect.objectContaining({ id: 'sam_power_crows', name: 'Sam Power', team: 'Adelaide' }),
      ])
    );
  });

  it('falls back to local player data when precomputed stats are missing', async () => {
    getPlayersMock.mockResolvedValue([
      {
        id: 'sam_power',
        name: 'Sam Power',
        team: 'GWS',
        position: 'MID',
        games: 3,
        goals: 2,
        stats: {},
      },
    ]);
    calculateTotalValueMock!.mockImplementation(({ goals }: { goals: number }) => goals * 10);

    const req = new NextRequest('http://localhost/api/players/search?q=sam');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toHaveLength(1);
    expect(body.players[0]).toMatchObject({
      id: 'sam_power',
      name: 'Sam Power',
      team: 'GWS',
      totalGames: 3,
    });
  });
});
