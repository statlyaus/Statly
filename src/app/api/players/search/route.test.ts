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
// eslint-disable-next-line no-unused-vars
type SnapshotCallback = (doc: MockDoc) => void;

function createCollectionMock(docs: MockDoc[]) {
  const chain: any = {
    get: vi.fn(async () => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: (callback: SnapshotCallback) => {
        docs.forEach((entry) => callback(entry));
      },
    })),
  };
  return chain;
}

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
  });

  it('returns filtered players from Firestore search results', async () => {
    const docs: MockDoc[] = [
      {
        id: 'doc1',
        data: () => ({
          player_name: 'John Smith',
          team: 'Cats',
          position: 'MID',
          goals: 2,
          kicks: 20,
          handballs: 10,
          marks: 5,
          tackles: 6,
          hitouts: 0,
          clearances: 4,
          inside_50s: 3,
          rebound_50s: 2,
          clangers: 1,
          contested_possessions: 12,
          uncontested_possessions: 18,
          frees_for: 2,
          frees_against: 1,
          one_percenters: 1,
          goal_assists: 2,
          turnovers: 3,
          intercepts: 2,
          metres_gained: 450,
          contested_marks: 2,
          effective_disposals: 22,
          score_involvements: 9,
          time_on_ground_percentage: 82,
          disposal_efficiency: 76,
          round: 6,
        }),
      },
      {
        id: 'doc2',
        data: () => ({
          player_name: 'Bob Jones',
          team: 'Dogs',
          position: 'FWD',
          goals: 1,
          kicks: 12,
          handballs: 8,
          marks: 4,
          tackles: 3,
          hitouts: 0,
          clearances: 2,
          inside_50s: 1,
          rebound_50s: 1,
          clangers: 0,
          contested_possessions: 8,
          uncontested_possessions: 10,
          frees_for: 1,
          frees_against: 0,
          one_percenters: 0,
          goal_assists: 1,
          turnovers: 2,
          intercepts: 1,
          metres_gained: 320,
          contested_marks: 1,
          effective_disposals: 14,
          score_involvements: 5,
          time_on_ground_percentage: 78,
          disposal_efficiency: 70,
          round: 6,
        }),
      },
    ];

    calculateTotalValueMock!.mockImplementation(({ goals }: { goals: number }) => goals * 15);
    collectionFactory.mockImplementation(() => createCollectionMock(docs));

    const req = new NextRequest('http://localhost/api/players/search?q=smith');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toHaveLength(1);
    expect(body.players[0]).toMatchObject({ name: 'John Smith', totalScore: 30 });
    expect(calculateTotalValueMock!).toHaveBeenCalled();
  });

  it('returns empty list when query shorter than 2 characters', async () => {
    const req = new NextRequest('http://localhost/api/players/search?q=s');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.players).toEqual([]);
    expect(collectionFactory).not.toHaveBeenCalled();
  });
});
