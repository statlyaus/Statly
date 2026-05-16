import { NextRequest } from 'next/server';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const collectionFactory = vi.fn();

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(() => collectionFactory()),
  },
}));

vi.mock('@/lib/metrics', () => ({
  withMetrics: (fn: any) => fn,
}));

vi.mock('@/lib/rateLimit', () => ({
  withRateLimit: () => () => ({ success: true }),
  rateLimitConfigs: { public: {} },
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

type MockDoc = { id: string; data: () => Record<string, unknown> };

function createQueryMock(docs: MockDoc[]) {
  const query: any = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    startAfter: vi.fn(() => query),
    get: vi.fn(async () => ({
      docs,
      size: docs.length,
      empty: docs.length === 0,
    })),
  };
  return query;
}

describe('GET /api/player-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calculateTotalValueMock!.mockReset();
    calculateTotalValueMock!.mockImplementation(() => 100);
  });

  it('returns player stats sourced from Firestore', async () => {
    const docs: MockDoc[] = [
      {
        id: 'doc1',
        data: () => ({
          player_uid: 'ply-1',
          player_name: 'John Smith',
          goals: 2,
          tackles: 5,
          clearances: 8,
          inside_50s: 3,
          intercepts: 1,
          contested_marks: 2,
          rebound_50s: 4,
          contested_possessions: 6,
          one_percenters: 9,
          goal_assists: 11,
          effective_disposals: 12,
          score_involvements: 7,
          season: 2025,
          round: 3,
          match_uid: 'match-1',
          opposition: 'WBD',
          team: 'GEE',
          position: 'MID',
        }),
      },
      {
        id: 'doc2',
        data: () => ({
          player_uid: 'ply-2',
          player_name: 'Jane Doe',
          goals: 1,
          tackles: 3,
          inside_50s: 2,
          intercepts: 0,
          contested_marks: 1,
          rebound_50s: 1,
          contested_possessions: 5,
          effective_disposals: 10,
          score_involvements: 6,
          season: 2025,
          round: 3,
          match_uid: 'match-2',
          opposition: 'CAR',
          team: 'COL',
          position: 'FWD',
        }),
      },
    ];

    calculateTotalValueMock!.mockImplementation((stats: { goals: number }) => stats.goals * 10);
    collectionFactory.mockImplementation(() => createQueryMock(docs));

    const req = new NextRequest('http://localhost/api/player-stats?season=2025&limit=10');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      player_name: 'John Smith',
      totalValue: 20,
      categories: {
        goals: 2,
        tackles: 5,
        inside50s: 3,
        intercepts: 1,
        contestedMarks: 2,
        rebound50s: 4,
        contestedPossessions: 6,
        effectiveDisposals: 12,
        scoreInvolvements: 7,
      },
      perGameLog: {
        clearances: 8,
        onePercenters: 9,
        goalAssists: 11,
      },
    });
    expect(body.data[1]).toMatchObject({ player_name: 'Jane Doe', totalValue: 10 });
    expect(body.data[1].tenthCell.value).toBeNull();
    expect(body.data[1].perGameLog.disposalEffPct).toBeNull();
    expect(body.data[1].perGameLog.timeOnGroundPct).toBeNull();
    expect(body.query.nextCursor).toBeNull();
  });

  it('prefers canonical_stats over legacy stat fields when present', async () => {
    const docs: MockDoc[] = [
      {
        id: 'doc1',
        data: () => ({
          player_uid: 'ply-1',
          player_name: 'John Smith',
          goals: 1,
          season: 2025,
          round: 3,
          match_uid: 'match-1',
          opposition: 'WBD',
          team: 'GEE',
          position: 'MID',
          canonical_stats: {
            version: 1,
            source_name: 'fitzroy_merged',
            stats: {
              goals: 4,
              tackles: 7,
              inside_50s: 3,
              contested_marks: 2,
              rebound_50s: 5,
              contested_possessions: 9,
              effective_disposals: 11,
              score_involvements: 6,
            },
            availability: {
              goals: true,
              tackles: true,
              inside_50s: true,
              contested_marks: true,
              rebound_50s: true,
              contested_possessions: true,
              effective_disposals: true,
              score_involvements: true,
            },
            provenance: {},
            source_priority: ['fitzroy_merged'],
            raw_source_rows: null,
          },
        }),
      },
    ];

    calculateTotalValueMock!.mockImplementation((stats: { goals: number }) => stats.goals * 10);
    collectionFactory.mockImplementation(() => createQueryMock(docs));

    const req = new NextRequest('http://localhost/api/player-stats?season=2025&limit=10');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      player_name: 'John Smith',
      totalValue: 40,
      categories: {
        goals: 4,
        tackles: 7,
        inside50s: 3,
        contestedMarks: 2,
        rebound50s: 5,
        contestedPossessions: 9,
        effectiveDisposals: 11,
        scoreInvolvements: 6,
      },
    });
  });

  it('rejects invalid cursor values', async () => {
    const req = new NextRequest('http://localhost/api/player-stats?season=2025&cursor=bad/value');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid cursor');
    expect(collectionFactory).not.toHaveBeenCalled();
  });
});
