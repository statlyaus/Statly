import { NextRequest } from 'next/server';

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/data', () => ({
  getPlayers: vi.fn(async () =>
    Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `P${i}` }))
  ),
}));
vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    verifySessionCookie: vi.fn(),
    verifyIdToken: vi.fn(),
  },
  adminDb: {} as Record<string, never>,
}));
vi.mock('@/lib/precomputedStats', () => ({
  getPrecomputedStatsForPlayers: vi.fn(async (_db, playerIds: string[]) => {
    const result = new Map<string, { stats: Record<string, number>; totals: Record<string, number>; gamesPlayed: number }>();
    for (const playerId of playerIds) {
      result.set(playerId, { stats: {}, totals: {}, gamesPlayed: 0 });
    }
    return result;
  }),
}));
import { GET } from './route';

describe('GET /api/players', () => {
  it('returns players for valid query params', async () => {
    const req = new NextRequest(
      'http://localhost/api/players?search=a&team=b&position=c&page=2&limit=5'
    );
    const res = await GET(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.page).toBe(2);
    expect(data.limit).toBe(5);
    expect(data.players).toHaveLength(5);
  });

  it('returns 400 for invalid page and limit', async () => {
    const req = new NextRequest('http://localhost/api/players?page=0&limit=1001');
    const res = await GET(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.errors.page?.length).toBeGreaterThan(0);
    expect(data.errors.limit?.length).toBeGreaterThan(0);
  });

  it('returns 400 for non-numeric page', async () => {
    const req = new NextRequest('http://localhost/api/players?page=abc');
    const res = await GET(req);
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.errors.page?.length).toBeGreaterThan(0);
  });
});
