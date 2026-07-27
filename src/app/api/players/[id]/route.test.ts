import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const seasonQuery = { get: vi.fn() };
  const statsQuery = { get: vi.fn(), where: vi.fn() };
  statsQuery.where.mockReturnValue(statsQuery);

  return {
    collection: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue(seasonQuery),
      where: statsQuery.where,
    }),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    getPlayer: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    resolveCanonicalPlayerId: vi.fn(),
    seasonQuery,
    statsQuery,
  };
});

vi.mock('@/lib/data', () => ({ getPlayer: mocks.getPlayer }));
vi.mock('@/lib/firebaseAdmin', () => ({ adminDb: { collection: mocks.collection } }));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
    },
  },
}));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerId: mocks.resolveCanonicalPlayerId,
}));

import { GET } from './route';

describe('GET /api/players/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCanonicalPlayerId.mockResolvedValue('player-1');
    mocks.findUnique.mockResolvedValue({
      id: 'player-1',
      name: 'Test Player',
      club: 'Test Club',
      position: 'MID',
    });
    mocks.seasonQuery.get.mockRejectedValue(new Error('Missing Firestore credentials'));
    mocks.statsQuery.get.mockRejectedValue(new Error('Missing Firestore credentials'));
  });

  it('returns the base player when optional Firestore statistics are unavailable', async () => {
    const response = await GET(new NextRequest('http://localhost/api/players/player-1'), {
      params: Promise.resolve({ id: 'player-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        id: 'player-1',
        name: 'Test Player',
        team: 'Test Club',
        position: 'MID',
        stats: {},
      },
    });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to load optional player stats; using base player data',
      expect.objectContaining({
        playerName: 'Test Player',
        error: 'Missing Firestore credentials',
      })
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
