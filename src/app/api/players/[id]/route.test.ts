import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const getPlayerMock = vi.fn();
const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const verifyLeagueMembershipMock = vi.fn();
const getLeagueOwnershipMapMock = vi.fn();
const getAuthenticatedUserIdMock = vi.fn();
const resolveSeasonMock = vi.fn();
const ensureSeasonReadyMock = vi.fn();
const getLatestSnapshotMock = vi.fn();

const emptySnapshot = {
  empty: true,
  forEach: vi.fn(),
};

vi.mock('@/lib/data', () => ({
  getPlayer: (...args: unknown[]) => getPlayerMock(...args),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      limit: vi.fn(() => ({
        get: vi.fn(async () => emptySnapshot),
      })),
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(async () => emptySnapshot),
        })),
      })),
    })),
  },
}));

vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: (...args: unknown[]) => verifyLeagueMembershipMock(...args),
}));

vi.mock('@/lib/leagueOwnership', () => ({
  getLeagueOwnershipMap: (...args: unknown[]) => getLeagueOwnershipMapMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: (...args: unknown[]) => getAuthenticatedUserIdMock(...args),
}));

vi.mock('@/server/stats/StatsReadService', () => ({
  statsReadService: {
    resolveSeason: (...args: unknown[]) => resolveSeasonMock(...args),
    ensureSeasonReady: (...args: unknown[]) => ensureSeasonReadyMock(...args),
    getLatestSnapshot: (...args: unknown[]) => getLatestSnapshotMock(...args),
  },
}));

describe('GET /api/players/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue(null);
    findFirstMock.mockResolvedValue(null);
    getPlayerMock.mockResolvedValue({
      id: 'john_smith',
      name: 'John Smith',
      team: 'Cats',
      position: 'MID',
      stats: {},
    });
    verifyLeagueMembershipMock.mockResolvedValue({ isMember: true });
    getLeagueOwnershipMapMock.mockResolvedValue({
      totalTeams: 10,
      counts: new Map([['john_smith', 4]]),
    });
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    resolveSeasonMock.mockResolvedValue(2025);
    ensureSeasonReadyMock.mockResolvedValue(undefined);
    getLatestSnapshotMock.mockResolvedValue(null);
  });

  it('does not load fallback player data when the route param is already a canonical id', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'john_smith',
      name: 'John Smith',
      club: 'Cats',
      position: 'MID',
    });

    const req = new NextRequest('http://localhost/api/players/john_smith');
    const res = await GET(req, { params: Promise.resolve({ id: 'john_smith' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ id: 'john_smith', name: 'John Smith' });
    expect(getPlayerMock).not.toHaveBeenCalled();
  });

  it('returns the canonical player id for a legacy slug lookup', async () => {
    const req = new NextRequest('http://localhost/api/players/john-smith-cats');
    const res = await GET(req, { params: Promise.resolve({ id: 'john-smith-cats' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      id: 'john_smith',
      name: 'John Smith',
      team: 'Cats',
    });
  });

  it('uses the canonical player id for ownership lookups on legacy routes', async () => {
    const req = new NextRequest('http://localhost/api/players/john-smith-cats?leagueId=league-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'john-smith-cats' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getLeagueOwnershipMapMock).toHaveBeenCalledWith('league-1', ['john_smith']);
    expect(body.data).toMatchObject({
      id: 'john_smith',
      ownership: 40,
    });
  });
});
