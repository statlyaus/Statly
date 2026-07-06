import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  leagueMember: {
    findFirst: vi.fn(),
  },
  player: {
    findUnique: vi.fn(),
  },
  leagueRoster: {
    upsert: vi.fn(),
    update: vi.fn(),
  },
  leagueRosterPlayer: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  teamAction: {
    findFirst: vi.fn(),
  },
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));

vi.mock('../../src/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/cacheTags', () => ({
  tags: {
    league: (leagueId: string) => `league:${leagueId}`,
    waivers: (leagueId: string) => `waivers:${leagueId}`,
  },
}));

vi.mock('../../src/lib/cacheTags', () => ({
  tags: {
    league: (leagueId: string) => `league:${leagueId}`,
    waivers: (leagueId: string) => `waivers:${leagueId}`,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(() => ({
    projectLeague: vi.fn().mockResolvedValue({ owned: 0, available: 1 }),
  })),
}));

vi.mock('../../src/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(() => ({
    projectLeague: vi.fn().mockResolvedValue({ owned: 0, available: 1 }),
  })),
}));

describe('league roster free-agent add eligibility', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    authMocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    prismaMocks.leagueMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prismaMocks.player.findUnique.mockResolvedValue({ id: 'held-player' });
    prismaMocks.leagueRosterPlayer.findFirst.mockResolvedValue(null);
    prismaMocks.teamAction.findFirst.mockResolvedValue({
      id: 'drop-hold-1',
      processingAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    prismaMocks.leagueRoster.upsert.mockResolvedValue({
      id: 'roster-1',
      playerIds: JSON.stringify([]),
    });
    prismaMocks.leagueRoster.update.mockResolvedValue({ id: 'roster-1' });
    prismaMocks.leagueRosterPlayer.create.mockResolvedValue({ id: 'roster-player-1' });
    prismaMocks.$transaction.mockImplementation((work: unknown) => {
      if (Array.isArray(work)) return Promise.all(work);
      if (typeof work === 'function') return work(prismaMocks);
      return Promise.resolve(null);
    });
  });

  it('rejects direct free-agent adds while a dropped player is still on waivers', async () => {
    const { POST } = await import('../../src/app/api/leagues/[id]/roster/add/route');

    const response = await POST(
      jsonRequest('/api/leagues/league-1/roster/add', { playerId: 'held-player' }),
      {
        params: Promise.resolve({ id: 'league-1' }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toEqual({ message: 'Player is on waivers' });
    expect(prismaMocks.teamAction.findFirst).toHaveBeenCalledWith({
      where: {
        leagueId: 'league-1',
        actionType: 'DROP_PLAYER',
        status: 'PENDING',
        processingAt: { gt: expect.any(Date) },
        details: { contains: '"playerId":"held-player"' },
      },
      select: { id: true },
    });
    expect(prismaMocks.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });
});

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
