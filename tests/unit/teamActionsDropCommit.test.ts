import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAuthenticatedUserId: vi.fn() }));
const membershipMocks = vi.hoisted(() => ({ verifyLeagueMembership: vi.fn() }));
const projectLeague = vi.hoisted(() => vi.fn());

const tx = vi.hoisted(() => ({
  league: { findUnique: vi.fn().mockResolvedValue({ activeSeasonId: 'season-1' }) },
  leagueRosterPlayer: { deleteMany: vi.fn() },
  teamAction: { create: vi.fn() },
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  leagueMember: { findFirst: vi.fn() },
  leagueRosterPlayer: { findFirst: vi.fn(), deleteMany: vi.fn() },
  teamAction: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: authMocks.getAuthenticatedUserId }));
vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: membershipMocks.verifyLeagueMembership,
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerIds: vi.fn(async () => new Map()),
}));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(() => ({ projectLeague })),
}));

async function drop(): Promise<Response> {
  const { POST } = await import('@/app/api/leagues/[id]/actions/[userId]/route');
  const response = await POST(
    new Request('https://statly.test/api/leagues/league-1/actions/user-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionType: 'DROP_PLAYER', details: { playerId: 'player-1' } }),
    }) as NextRequest,
    { params: Promise.resolve({ id: 'league-1', userId: 'user-1' }) }
  );
  if (!response) throw new Error('POST returned no response');
  return response;
}

describe('team action drop commit', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    membershipMocks.verifyLeagueMembership.mockResolvedValue({ isMember: true });
    prismaMocks.leagueMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prismaMocks.leagueRosterPlayer.findFirst.mockResolvedValue({ playerId: 'player-1' });
    prismaMocks.$transaction.mockImplementation((work: (client: typeof tx) => unknown) => work(tx));
    tx.leagueRosterPlayer.deleteMany.mockResolvedValue({ count: 1 });
    tx.teamAction.create.mockResolvedValue({ id: 'action-1' });
    projectLeague.mockResolvedValue({ owned: 0, available: 1 });
  });

  it('removes the roster row and writes the waiver hold in one transaction', async () => {
    const response = await drop();

    expect(response.status).toBe(200);
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.leagueRosterPlayer.deleteMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', memberId: 'member-1', playerId: 'player-1' },
    });
    expect(tx.teamAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leagueId: 'league-1',
        seasonId: 'season-1',
        memberId: 'member-1',
        actionType: 'DROP_PLAYER',
        details: { playerId: 'player-1' },
      }),
    });
    expect(prismaMocks.leagueRosterPlayer.deleteMany).not.toHaveBeenCalled();
    expect(prismaMocks.teamAction.create).not.toHaveBeenCalled();
  });

  it('refuses with 409 when the player already left the roster, instead of reporting a drop', async () => {
    tx.leagueRosterPlayer.deleteMany.mockResolvedValue({ count: 0 });

    const response = await drop();

    expect(response.status).toBe(409);
    expect(tx.teamAction.create).not.toHaveBeenCalled();
  });

  it('answers 500 when the drop transaction fails', async () => {
    prismaMocks.$transaction.mockRejectedValue(new Error('connection lost'));

    const response = await drop();

    expect(response.status).toBe(500);
  });

  it('keeps the committed drop and its waiver hold when the availability projection fails', async () => {
    projectLeague.mockRejectedValue(new Error('projection unavailable'));

    const response = await drop();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.action).toMatchObject({ actionType: 'DROP_PLAYER', status: 'PENDING' });
    expect(prismaMocks.teamAction.update).not.toHaveBeenCalled();
  });
});
