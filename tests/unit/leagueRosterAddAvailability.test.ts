import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthenticatedUserId: vi.fn() }));
const prismaMocks = vi.hoisted(() => ({ leagueMember: { findUnique: vi.fn() } }));
const ownershipMocks = vi.hoisted(() => ({ addFreeAgent: vi.fn() }));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: authMocks.getAuthenticatedUserId }));
vi.mock('../../src/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('../../src/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/cacheTags', () => ({
  tags: { league: (id: string) => id, waivers: (id: string) => id },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(() => ({ projectLeague: vi.fn() })),
}));
vi.mock('@/server/rosters/LeagueOwnershipService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/rosters/LeagueOwnershipService')>();
  return {
    ...actual,
    LeagueOwnershipService: vi.fn(() => ({ addFreeAgent: ownershipMocks.addFreeAgent })),
  };
});

describe('league roster free-agent add eligibility', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    prismaMocks.leagueMember.findUnique.mockResolvedValue({ id: 'member-1' });
  });

  it('returns a stable conflict while a player is on waivers', async () => {
    const { OwnershipMutationError } = await import('@/server/rosters/LeagueOwnershipService');
    ownershipMocks.addFreeAgent.mockRejectedValue(
      new OwnershipMutationError('PLAYER_ON_WAIVERS', 'Player is on waivers')
    );
    const { POST } = await import('../../src/app/api/leagues/[id]/roster/add/route');

    const response = await POST(
      jsonRequest('/api/leagues/league-1/roster/add', { playerId: 'held-player' }),
      {
        params: Promise.resolve({ id: 'league-1' }),
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({ error: { message: 'Player is on waivers' } })
    );
    expect(ownershipMocks.addFreeAgent).toHaveBeenCalledWith({
      leagueId: 'league-1',
      memberId: 'member-1',
      playerId: 'held-player',
    });
  });
});

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
