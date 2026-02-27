import { NextRequest } from 'next/server';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const collectionFactory = vi.fn();

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(() => collectionFactory()),
  },
}));

vi.mock('@/types/fantasyCategories', async () => {
  const actual = await vi.importActual<typeof import('@/types/fantasyCategories')>(
    '@/types/fantasyCategories'
  );
  return { ...actual, calculateTotalValue: vi.fn() };
});

type MockDoc = { id: string; data: () => Record<string, unknown> };

let calculateTotalValueMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const mod = await import('@/types/fantasyCategories');
  calculateTotalValueMock = vi.mocked(mod.calculateTotalValue);
});

function createCollectionMock(docs: MockDoc[]) {
  const chain: any = {
    where: vi.fn(() => chain),
    get: vi.fn(async () => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
    })),
  };
  return chain;
}

describe('GET /api/players/[id]/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calculateTotalValueMock!.mockReset();
    calculateTotalValueMock!.mockImplementation(() => 300);
  });

  it('aggregates player stats from Firestore', async () => {
    const playerName = 'John Smith';
    const docs: MockDoc[] = [
      {
        id: 'doc1',
        data: () => ({
          player_name: playerName,
          goals: 2,
          disposals: 25,
          marks: 5,
          tackles: 4,
          kicks: 15,
          handballs: 10,
          hitouts: 1,
          inside_50s: 3,
          rebound_50s: 2,
          contested_possessions: 12,
          uncontested_possessions: 18,
          intercepts: 3,
          clearances: 5,
          clangers: 1,
          frees_for: 2,
          frees_against: 1,
          one_percenters: 2,
          goal_assists: 3,
          turnovers: 4,
          metres_gained: 420,
          contested_marks: 2,
          effective_disposals: 20,
          score_involvements: 9,
          time_on_ground_percentage: 80,
          disposal_efficiency: 72,
          round: 5,
          team: 'GEE',
          position: 'MID',
        }),
      },
      {
        id: 'doc2',
        data: () => ({
          player_name: playerName,
          goals: 1,
          disposals: 20,
          marks: 4,
          tackles: 6,
          kicks: 12,
          handballs: 8,
          hitouts: 0,
          inside_50s: 2,
          rebound_50s: 1,
          contested_possessions: 10,
          uncontested_possessions: 14,
          intercepts: 2,
          clearances: 4,
          clangers: 2,
          frees_for: 1,
          frees_against: 0,
          one_percenters: 1,
          goal_assists: 2,
          turnovers: 3,
          metres_gained: 360,
          contested_marks: 1,
          effective_disposals: 16,
          score_involvements: 7,
          time_on_ground_percentage: 82,
          disposal_efficiency: 78,
          round: 6,
          team: 'GEE',
          position: 'MID',
        }),
      },
    ];

    calculateTotalValueMock!.mockImplementation(() => 320);
    collectionFactory.mockImplementation(() => createCollectionMock(docs));

    const req = new NextRequest('http://localhost/api/players/John%20Smith/stats');
    const res = await GET(req, {
      params: Promise.resolve({ id: encodeURIComponent(playerName) }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.playerName).toBe(playerName);
    expect(body.data.totalGames).toBe(2);
    expect(body.data.totalScore).toBe(320);
    expect(body.data.averageScore).toBe(160);
    expect(body.data.latestRound).toBe(6);
    expect(calculateTotalValueMock!).toHaveBeenCalledWith(
      expect.objectContaining({ goals: 3, contestedMarks: 3 })
    );
  });

  it('returns 404 when player has no match records', async () => {
    collectionFactory.mockImplementation(() => createCollectionMock([]));

    const req = new NextRequest('http://localhost/api/players/Jane%20Doe/stats');
    const res = await GET(req, { params: Promise.resolve({ id: 'Jane%20Doe' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
