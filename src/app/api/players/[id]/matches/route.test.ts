import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getMatchStats: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ get: mocks.getMatchStats }),
    }),
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: mocks.loggerWarn },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { player: { findMany: mocks.findMany } },
}));

import { GET } from './route';

describe('GET /api/players/[id]/matches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([{ name: 'Test Player' }]);
    mocks.getMatchStats.mockRejectedValue(new Error('Missing Firestore credentials'));
  });

  it('returns an empty history when optional Firestore match data is unavailable', async () => {
    const response = await GET(new NextRequest('http://localhost/api/players/player-1/matches'), {
      params: Promise.resolve({ id: 'player-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: [] });
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to load optional player match history; returning empty history',
      expect.objectContaining({
        playerId: 'player-1',
        error: 'Missing Firestore credentials',
      })
    );
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});
