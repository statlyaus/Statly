import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

const mocks = vi.hoisted(() => ({
  latestSeasonDocs: [] as Array<{ data: () => Record<string, unknown> }>,
  seasonDocs: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
  where: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  firebaseAdminIsDisabled: () => false,
  adminDb: {
    collection: () => ({
      orderBy: () => ({
        limit: () => ({ get: async () => ({ docs: mocks.latestSeasonDocs }) }),
      }),
      where: (...args: unknown[]) => {
        mocks.where(...args);
        return { get: async () => ({ docs: mocks.seasonDocs }) };
      },
    }),
  },
}));

import { GET } from './route';

const doc = (name: string, stats: Record<string, number>) => ({
  id: `${name}-doc`,
  data: () => ({ player_name: name, team: 'Sydney', season: 2026, stats }),
});

describe('GET /api/rankings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.latestSeasonDocs = [{ data: () => ({ season: 2026 }) }];
    mocks.seasonDocs = [
      doc('Alpha', { goals: 3, contested_possessions: 10 }),
      doc('Beta', { goals: 1 }),
    ];
  });

  it('defaults to the latest season with data', async () => {
    await GET(new NextRequest('http://localhost/api/rankings'));
    expect(mocks.where).toHaveBeenCalledWith('season', '==', 2026);
  });

  it('honours an explicit season', async () => {
    await GET(new NextRequest('http://localhost/api/rankings?season=2024'));
    expect(mocks.where).toHaveBeenCalledWith('season', '==', 2024);
  });

  it('ranks on the league preset, reports missing stats as null and has no ownership field', async () => {
    const response = await GET(new NextRequest('http://localhost/api/rankings'));
    const body = await response.json();
    const beta = body.data.players.find((p: { playerName: string }) => p.playerName === 'Beta');

    expect(Object.keys(beta.categories)).toEqual([...REAL_DATA_NINE_CATEGORY_PRESET]);
    expect(beta.categories.contestedPossessions).toEqual({ perGame: null, zScore: null });
    expect(beta).not.toHaveProperty('ownership');
    expect(body.data.meta.season).toBe(2026);
  });
});
