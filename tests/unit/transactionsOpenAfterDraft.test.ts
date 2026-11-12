import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DRAFT_NOT_COMPLETE = {
  open: false as const,
  code: 'DRAFT_NOT_COMPLETE' as const,
  reason: 'Adds, waiver claims and trades open once the league draft is complete.',
};

const mocks = vi.hoisted(() => ({
  WaiverClaimStoreError: class extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
  getAuthenticatedUserId: vi.fn(),
  getLeagueMembershipAccess: vi.fn(),
  getTransactionWindow: vi.fn(),
  submitClaim: vi.fn(),
  loadWaiverSettings: vi.fn(),
  resolveCanonicalPlayerId: vi.fn(),
  prisma: {
    player: { findMany: vi.fn() },
    leagueRosterPlayer: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: mocks.getLeagueMembershipAccess,
}));
vi.mock('@/server/players/playerIdentityService', () => ({
  resolveCanonicalPlayerId: mocks.resolveCanonicalPlayerId,
}));
vi.mock('@/server/leagues/transactionWindow', () => ({
  getTransactionWindow: mocks.getTransactionWindow,
  transactionsClosedResponse: (window: typeof DRAFT_NOT_COMPLETE) =>
    NextResponse.json({ error: window.reason, code: window.code }, { status: 409 }),
}));
vi.mock('@/server/waivers/WaiverProcessingService', () => ({
  PrismaWaiverClaimStore: class {
    submitClaim = mocks.submitClaim;
    loadWaiverSettings = mocks.loadWaiverSettings;
  },
  WaiverClaimStoreError: mocks.WaiverClaimStoreError,
}));

function jsonRequest(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('transactions open only after the draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: true, memberId: 'member-1' });
    mocks.getTransactionWindow.mockResolvedValue(DRAFT_NOT_COMPLETE);
  });

  it('refuses a waiver claim with 409 and the reason before the draft is complete', async () => {
    const { POST } = await import('@/app/api/leagues/[id]/waivers/submit/route');

    const response = await POST(
      jsonRequest('http://localhost/api/leagues/league-1/waivers/submit', {
        teamId: 'team-1',
        playerId: 'player-1',
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: DRAFT_NOT_COMPLETE.reason,
      code: 'DRAFT_NOT_COMPLETE',
    });
    // The acting member goes to the guard, so a Bloodsucker window can tell who is asking.
    expect(mocks.getTransactionWindow).toHaveBeenCalledWith('league-1', mocks.prisma, {
      memberId: 'member-1',
    });
    expect(mocks.submitClaim).not.toHaveBeenCalled();
  });

  it('does not reveal the draft state to someone outside the league', async () => {
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: false });
    const { POST } = await import('@/app/api/leagues/[id]/waivers/submit/route');

    const response = await POST(
      jsonRequest('http://localhost/api/leagues/league-1/waivers/submit', {
        teamId: 'team-1',
        playerId: 'player-1',
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getTransactionWindow).not.toHaveBeenCalled();
  });
});

describe('waiver claim refusals once transactions are open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: true });
    mocks.getTransactionWindow.mockResolvedValue({ open: true });
    mocks.resolveCanonicalPlayerId.mockResolvedValue('player-1');
    mocks.prisma.player.findMany.mockResolvedValue([
      { id: 'player-1', name: 'Player One', club: 'CARL', position: 'MID' },
    ]);
    mocks.prisma.leagueRosterPlayer.findFirst.mockResolvedValue(null);
    mocks.loadWaiverSettings.mockResolvedValue({ system: 'ROLLING' });
  });

  it.each([
    [new Error('PLAYER_OWNED'), 409, 'Player already owned'],
    [new mocks.WaiverClaimStoreError('INSUFFICIENT_FAAB', 'x'), 400, 'Insufficient FAAB remaining'],
    [new Error('INSUFFICIENT_FAAB'), 400, 'Insufficient FAAB remaining'],
    [new mocks.WaiverClaimStoreError('TEAM_NOT_FOUND', 'x'), 403, 'Team not found'],
    [
      new mocks.WaiverClaimStoreError('FAAB_BALANCE_UNAVAILABLE', 'x'),
      400,
      'FAAB balance unavailable',
    ],
    [
      new mocks.WaiverClaimStoreError('DROP_NOT_ON_ROSTER', 'x'),
      409,
      'The player you chose to drop is not on your roster',
    ],
    [
      new mocks.WaiverClaimStoreError('ROSTER_FULL', 'x'),
      409,
      'Your roster is full: choose a player to drop',
    ],
    [
      new mocks.WaiverClaimStoreError('DUPLICATE_CLAIM', 'x'),
      409,
      'You already have a pending claim for this player',
    ],
    [new mocks.WaiverClaimStoreError('INVALID_BID', 'x'), 400, 'Bid must be a whole number'],
    [new Error('TEAM_NOT_FOUND'), 500, 'Internal Server Error'],
    [new Error('boom'), 500, 'Internal Server Error'],
  ])('answers %s with %i', async (error, status, message) => {
    mocks.submitClaim.mockRejectedValue(error);
    const { POST } = await import('@/app/api/leagues/[id]/waivers/submit/route');

    const response = await POST(
      jsonRequest('http://localhost/api/leagues/league-1/waivers/submit', {
        teamId: 'team-1',
        playerId: 'player-1',
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it.each([7.5, '7', -1])('refuses the FAAB bid %s before storing anything', async (bidAmount) => {
    mocks.loadWaiverSettings.mockResolvedValue({ system: 'FAAB', faabBudget: 100, minimumBid: 0 });
    const { POST } = await import('@/app/api/leagues/[id]/waivers/submit/route');

    const response = await POST(
      jsonRequest('http://localhost/api/leagues/league-1/waivers/submit', {
        teamId: 'team-1',
        playerId: 'player-1',
        bidAmount,
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.submitClaim).not.toHaveBeenCalled();
  });
});
