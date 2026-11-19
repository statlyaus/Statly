import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getCategoryRankings: vi.fn(),
  getPlayers: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitConfigs: { public: {} },
  withRateLimit: () => mocks.check,
}));
vi.mock('@/server/rankings/getCategoryRankings', () => ({
  getCategoryRankings: mocks.getCategoryRankings,
}));
vi.mock('@/lib/data', () => ({ getPlayers: mocks.getPlayers }));
vi.mock('@/lib/prisma', () => ({ prisma: { player: { findMany: mocks.findMany } } }));
vi.mock('@/lib/firebaseAdmin', () => ({ firebaseAdminIsDisabled: () => true, adminDb: {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET as getMatches } from '@/app/api/players/[id]/matches/route';
import { GET as searchPlayers } from '@/app/api/players/search/route';
import { GET as getRankings } from '@/app/api/rankings/route';

const limited = {
  success: false,
  status: 429,
  headers: { 'Retry-After': '60' },
  body: { success: false, error: { message: 'Too Many Requests' } },
};

describe('public player routes are rate limited', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockResolvedValue(limited);
  });

  it('rankings answers 429 without reading stats', async () => {
    const response = await getRankings(new NextRequest('http://localhost/api/rankings'));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(mocks.getCategoryRankings).not.toHaveBeenCalled();
  });

  it('player search answers 429 without reading players', async () => {
    const response = await searchPlayers(
      new NextRequest('http://localhost/api/players/search?q=daicos')
    );

    expect(response.status).toBe(429);
    expect(mocks.getPlayers).not.toHaveBeenCalled();
  });

  it('match log answers 429 without reading players', async () => {
    const response = await getMatches(new NextRequest('http://localhost/api/players/p-1/matches'), {
      params: Promise.resolve({ id: 'p-1' }),
    });

    expect(response.status).toBe(429);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
