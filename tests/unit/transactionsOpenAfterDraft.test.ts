import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DRAFT_NOT_COMPLETE = {
  open: false as const,
  code: 'DRAFT_NOT_COMPLETE' as const,
  reason: 'Adds, waiver claims and trades open once the league draft is complete.',
};

const mocks = vi.hoisted(() => ({
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
  WaiverClaimStoreError: class extends Error {},
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
    mocks.getLeagueMembershipAccess.mockResolvedValue({ isMember: true });
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
    expect(mocks.getTransactionWindow).toHaveBeenCalledWith('league-1');
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
