import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
}));

const leagueMembershipMocks = vi.hoisted(() => ({
  verifyLeagueMembership: vi.fn(),
}));

const leagueAccessMocks = vi.hoisted(() => ({
  getLeagueMembershipAccess: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => ({
  league: {
    findUnique: vi.fn(),
  },
  leagueRosterPlayer: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  player: {
    findMany: vi.fn(),
  },
}));

const firestoreMocks = vi.hoisted(() => {
  const playerDocs = new Map<string, { name: string; team: string; position: string }>([
    ['drafted-player', { name: 'Drafted Player', team: 'CARL', position: 'MID' }],
    ['free-player', { name: 'Free Player', team: 'SYD', position: 'FWD' }],
  ]);

  const makeQuery = (docs: Array<{ id: string; data: Record<string, unknown> }>) => {
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      startAfter: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: vi.fn().mockResolvedValue({
        docs: docs.map((doc) => ({
          id: doc.id,
          data: () => doc.data,
        })),
        empty: docs.length === 0,
      }),
    };
    return query;
  };

  const availablePlayersQuery = makeQuery([
    { id: 'drafted-player', data: { available: true } },
    { id: 'free-player', data: { available: true } },
  ]);

  const emptyQuery = makeQuery([]);
  const ownershipDoc = { exists: false, data: () => undefined };
  const settingsDoc = { exists: false, data: () => undefined };

  const collection = vi.fn((collectionPath: string) => {
    if (collectionPath === 'leagues') {
      return {
        doc: vi.fn((leagueId: string) => ({
          collection: vi.fn((subcollection: string) => {
            if (subcollection === 'availablePlayers') return availablePlayersQuery;
            return emptyQuery;
          }),
          path: `leagues/${leagueId}`,
        })),
      };
    }

    if (collectionPath === 'players') {
      return {
        doc: vi.fn((playerId: string) => ({
          id: playerId,
          path: `players/${playerId}`,
        })),
      };
    }

    if (collectionPath.endsWith('/rosters')) return emptyQuery;
    if (collectionPath.endsWith('/waivers')) {
      return { doc: vi.fn(() => ({ id: 'claim-1', path: `${collectionPath}/claim-1` })) };
    }
    if (collectionPath.endsWith('/activity')) {
      return { doc: vi.fn(() => ({ path: `${collectionPath}/activity-1` })) };
    }

    return emptyQuery;
  });

  const doc = vi.fn((path: string) => ({
    path,
    get: vi.fn().mockResolvedValue(path.endsWith('/config/settings') ? settingsDoc : ownershipDoc),
  }));

  return {
    availablePlayersQuery,
    emptyQuery,
    runTransaction: vi.fn(),
    adminDb: {
      collection,
      doc,
      getAll: vi.fn(async (...refs: Array<{ id: string }>) =>
        refs.map((ref) => ({
          id: ref.id,
          exists: playerDocs.has(ref.id),
          data: () => playerDocs.get(ref.id),
        }))
      ),
      runTransaction: vi.fn(),
    },
  };
});

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));

vi.mock('../../src/lib/serverAuth', () => ({
  getAuthenticatedUserId: authMocks.getAuthenticatedUserId,
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: leagueMembershipMocks.verifyLeagueMembership,
}));

vi.mock('../../src/lib/leagueMembership', () => ({
  verifyLeagueMembership: leagueMembershipMocks.verifyLeagueMembership,
}));

vi.mock('@/server/leagues/membership', () => ({
  getLeagueMembershipAccess: leagueAccessMocks.getLeagueMembershipAccess,
}));

vi.mock('../../src/server/leagues/membership', () => ({
  getLeagueMembershipAccess: leagueAccessMocks.getLeagueMembershipAccess,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('../../src/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: firestoreMocks.adminDb,
}));

vi.mock('../../src/lib/firebaseAdmin', () => ({
  adminDb: firestoreMocks.adminDb,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    apiError: vi.fn(),
    apiRequest: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  withTiming: vi.fn((_label: string, work: () => unknown) => work()),
}));

vi.mock('../../src/lib/logger', () => ({
  logger: {
    apiError: vi.fn(),
    apiRequest: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  withTiming: vi.fn((_label: string, work: () => unknown) => work()),
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

vi.mock('@/lib/metrics', () => ({
  withMetrics: (handler: unknown) => handler,
}));

vi.mock('../../src/lib/metrics', () => ({
  withMetrics: (handler: unknown) => handler,
}));

describe('league free-agent availability uses Prisma ownership as canonical', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    firestoreMocks.emptyQuery.where.mockImplementation(() => firestoreMocks.emptyQuery);
    firestoreMocks.emptyQuery.orderBy.mockImplementation(() => firestoreMocks.emptyQuery);
    firestoreMocks.emptyQuery.startAfter.mockImplementation(() => firestoreMocks.emptyQuery);
    firestoreMocks.emptyQuery.limit.mockImplementation(() => firestoreMocks.emptyQuery);
    firestoreMocks.emptyQuery.get.mockResolvedValue({ docs: [], empty: true });

    authMocks.getAuthenticatedUserId.mockResolvedValue('statly-dev-tester');
    leagueMembershipMocks.verifyLeagueMembership.mockResolvedValue({ isMember: true });
    leagueAccessMocks.getLeagueMembershipAccess.mockResolvedValue({
      leagueId: 'league-1',
      userId: 'statly-dev-tester',
      memberId: 'member-1',
      role: 'OWNER',
      isMember: true,
      canManage: true,
    });

    prismaMocks.league.findUnique.mockResolvedValue({ id: 'league-1' });
    prismaMocks.leagueRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'drafted-player', memberId: 'member-1' },
    ]);
    prismaMocks.leagueRosterPlayer.findFirst.mockResolvedValue({
      playerId: 'drafted-player',
      memberId: 'member-1',
    });
    prismaMocks.player.findMany.mockResolvedValue([
      { id: 'free-player', name: 'Free Player', club: 'SYD', position: 'FWD' },
    ]);
    firestoreMocks.adminDb.runTransaction.mockImplementation(async (work) => {
      const tx = {
        get: vi.fn(async () => ({ exists: false, data: () => undefined })),
        set: vi.fn(),
        update: vi.fn(),
      };
      return work(tx);
    });
  });

  it('excludes Prisma-owned drafted players from the free-agent player API even when Firestore availability is stale', async () => {
    const { GET } = await import('../../src/app/api/leagues/[id]/players/route');

    const response = await GET(request('/api/leagues/league-1/players?owned=false&limit=100'), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMocks.leagueRosterPlayer.findMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1' },
      select: { playerId: true, memberId: true },
    });
    expect(body.items.map((player: { id: string }) => player.id)).toEqual(['free-player']);
  });

  it('returns Prisma-owned drafted players from the owned player API without relying on Firestore projection state', async () => {
    prismaMocks.player.findMany.mockResolvedValue([
      { id: 'drafted-player', name: 'Drafted Player', club: 'CARL', position: 'MID' },
    ]);

    const { GET } = await import('../../src/app/api/leagues/[id]/players/route');

    const response = await GET(request('/api/leagues/league-1/players?owned=true&limit=100'), {
      params: Promise.resolve({ id: 'league-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        id: 'drafted-player',
        name: 'Drafted Player',
        ownership: 100,
      }),
    ]);
  });

  it('rejects waiver claims for Prisma-owned drafted players before Firestore ownership checks', async () => {
    const { POST } = await import('../../src/app/api/leagues/[id]/waivers/submit/route');

    const response = await POST(
      jsonRequest('/api/leagues/league-1/waivers/submit', {
        teamId: 'member-1',
        playerId: 'drafted-player',
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('Player already owned');
    expect(prismaMocks.leagueRosterPlayer.findFirst).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', playerId: 'drafted-player' },
      select: { playerId: true, memberId: true },
    });
    expect(firestoreMocks.adminDb.runTransaction).not.toHaveBeenCalled();
  });

  it('allows waiver claims for undrafted players after Prisma confirms they are unowned', async () => {
    prismaMocks.leagueRosterPlayer.findFirst.mockResolvedValue(null);

    const { POST } = await import('../../src/app/api/leagues/[id]/waivers/submit/route');

    const response = await POST(
      jsonRequest('/api/leagues/league-1/waivers/submit', {
        teamId: 'member-1',
        playerId: 'free-player',
      }),
      { params: Promise.resolve({ id: 'league-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ id: 'claim-1' });
  });
});

function request(path: string): NextRequest {
  return new Request(`https://statly.test${path}`) as NextRequest;
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new Request(`https://statly.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}
