import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRouteContext } from '@/testUtils';

import { GET } from './route';

const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const findManyMock = vi.fn();
const ensurePlayerSeasonSummariesMaterializedMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    playerMatchLogProjection: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

vi.mock('@/server/readModels/playerReadModels', () => ({
  ensurePlayerSeasonSummariesMaterialized: (...args: unknown[]) =>
    ensurePlayerSeasonSummariesMaterializedMock(...args),
  parseMatchLogStatsJson: (raw: string) => {
    const parsed = JSON.parse(raw) as {
      stats: Record<string, number>;
      availability?: Record<string, boolean>;
    };
    return {
      ...parsed.stats,
      disposalEffPct: parsed.availability?.disposalEffPct === false ? null : parsed.stats.disposalEffPct,
      metresGained: parsed.availability?.metresGained === false ? null : parsed.stats.metresGained,
      scoreInvolvements:
        parsed.availability?.scoreInvolvements === false ? null : parsed.stats.scoreInvolvements,
    };
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GET /api/players/[id]/matches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({ id: 'john_smith' });
    findFirstMock.mockResolvedValue(null);
    ensurePlayerSeasonSummariesMaterializedMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([
      {
        playerId: 'john_smith',
        season: 2026,
        roundNumber: 5,
        matchId: '2026-R5-ADE-CAR',
        matchDate: '2026-04-20',
        opponent: 'Carlton',
        statsJson: JSON.stringify({
          stats: {
            kicks: 4,
            disposals: 8,
            scoreInvolvements: 0,
            disposalEffPct: 0,
            metresGained: 0,
          },
          availability: {
            scoreInvolvements: true,
            disposalEffPct: false,
            metresGained: false,
          },
        }),
      },
    ]);
  });

  it('returns unknown advanced match stats as null instead of coerced zeroes', async () => {
    const req = new NextRequest('http://localhost/api/players/john_smith/matches?season=2026');
    const res = await GET(req, createRouteContext({ id: 'john_smith' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([
      expect.objectContaining({
        matchId: '2026-R5-ADE-CAR',
        stats: expect.objectContaining({
          kicks: 4,
          disposals: 8,
          scoreInvolvements: 0,
          disposalEffPct: null,
          metresGained: null,
        }),
      }),
    ]);
  });
});
