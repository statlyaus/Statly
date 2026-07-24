import type { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
}));

const membershipMocks = vi.hoisted(() => ({
  verifyLeagueMembership: vi.fn(),
}));

const rosterMocks = vi.hoisted(() => ({
  ensureRosterTables: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));

vi.mock('../../src/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: membershipMocks.verifyLeagueMembership,
}));

vi.mock('../../src/lib/leagueMembership', () => ({
  verifyLeagueMembership: membershipMocks.verifyLeagueMembership,
}));

vi.mock('@/lib/ensureLobbyColumns', () => ({
  ensureRosterTables: rosterMocks.ensureRosterTables,
}));

vi.mock('../../src/lib/ensureLobbyColumns', () => ({
  ensureRosterTables: rosterMocks.ensureRosterTables,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(() => ({
    projectLeague: vi.fn().mockResolvedValue({ owned: 0, available: 0 }),
  })),
}));

vi.mock('../../src/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: vi.fn(() => ({
    projectLeague: vi.fn().mockResolvedValue({ owned: 0, available: 0 }),
  })),
}));

describe('team actions route architecture', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    rosterMocks.ensureRosterTables.mockRejectedValue(
      new Error('Unexpected Prisma setup before authorization')
    );
  });

  it('rejects anonymous action reads before Prisma work', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue(null);

    const { GET } = await import('../../src/app/api/leagues/[id]/actions/[userId]/route');
    const response = await GET(
      new Request('https://statly.test/api/leagues/league-1/actions/user-1') as NextRequest,
      { params: Promise.resolve({ id: 'league-1', userId: 'user-1' }) }
    );

    expect(response!.status).toBe(401);
    expect(rosterMocks.ensureRosterTables).not.toHaveBeenCalled();
    expect(membershipMocks.verifyLeagueMembership).not.toHaveBeenCalled();
  });

  it('rejects URL user impersonation before Prisma work', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue('signed-in-user');

    const { POST } = await import('../../src/app/api/leagues/[id]/actions/[userId]/route');
    const response = await POST(
      jsonRequest('/api/leagues/league-1/actions/other-user', {
        actionType: 'OPTIMIZE_LINEUP',
        details: {},
      }),
      { params: Promise.resolve({ id: 'league-1', userId: 'other-user' }) }
    );

    expect(response!.status).toBe(403);
    expect(rosterMocks.ensureRosterTables).not.toHaveBeenCalled();
    expect(membershipMocks.verifyLeagueMembership).not.toHaveBeenCalled();
  });

  it('rejects non-object action details without silently replacing the payload', async () => {
    authMocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    membershipMocks.verifyLeagueMembership.mockResolvedValue({ isMember: true });

    const { POST } = await import('../../src/app/api/leagues/[id]/actions/[userId]/route');
    const response = await POST(
      jsonRequest('/api/leagues/league-1/actions/user-1', {
        actionType: 'OPTIMIZE_LINEUP',
        details: 'unexpected-details',
      }),
      { params: Promise.resolve({ id: 'league-1', userId: 'user-1' }) }
    );

    expect(response!.status).toBe(400);
    await expect(response!.json()).resolves.toMatchObject({
      error: { message: 'Action details must be an object' },
    });
    expect(rosterMocks.ensureRosterTables).not.toHaveBeenCalled();
  });

  it('canonicalizes scalar and trade-array player references before persistence', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/leagues/[id]/actions/[userId]/route.ts'),
      'utf8'
    );

    expect(source).toContain("const scalarKeys = ['playerId', 'dropPlayerId']");
    expect(source).toContain("const arrayKeys = ['offeredPlayers', 'requestedPlayers']");
    expect(source).toContain('resolveCanonicalPlayerIds(requestedPlayerIds)');
  });
});

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
