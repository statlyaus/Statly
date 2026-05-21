import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.fn();
const ensureRosterTablesMock = vi.fn();

const prismaMock = {
  leagueMember: {
    findFirst: vi.fn(),
  },
  league: {
    findUnique: vi.fn(),
  },
  leagueRoster: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  leagueRosterPlayer: {
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/ensureLobbyColumns', () => ({
  ensureRosterTables: ensureRosterTablesMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function getRequest(leagueId = 'league-1', userId = 'user-1') {
  return new NextRequest(`http://localhost/api/leagues/${leagueId}/actions/${userId}`);
}

describe('GET /api/leagues/[id]/actions/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.leagueMember.findFirst.mockReset();
    prismaMock.$queryRaw.mockReset();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    ensureRosterTablesMock.mockResolvedValue(undefined);
    prismaMock.leagueMember.findFirst.mockResolvedValue({ id: 'member-1' });
    prismaMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'action-1',
        actionType: 'OPTIMIZE_LINEUP',
        status: 'PENDING',
        details: '{"source":"test"}',
        targetMemberId: null,
        processingAt: null,
        processedAt: null,
        createdAt: new Date('2026-05-18T00:00:00.000Z'),
        updatedAt: new Date('2026-05-18T00:01:00.000Z'),
      },
    ]);
  });

  it('rejects unauthenticated reads before processing due actions', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1', userId: 'user-1' }),
    });

    expect(response.status).toBe(401);
    expect(ensureRosterTablesMock).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.leagueMember.findFirst).not.toHaveBeenCalled();
  });

  it('forbids cross-user action reads before processing due actions', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-2');
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1', userId: 'user-1' }),
    });

    expect(response.status).toBe(403);
    expect(ensureRosterTablesMock).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    expect(prismaMock.leagueMember.findFirst).not.toHaveBeenCalled();
  });

  it('returns actions for the authenticated self user', async () => {
    const { GET } = await import('./route');

    const response = await GET(getRequest(), {
      params: Promise.resolve({ id: 'league-1', userId: 'user-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ensureRosterTablesMock).toHaveBeenCalledOnce();
    expect(prismaMock.leagueMember.findFirst).toHaveBeenCalledWith({
      where: {
        leagueId: 'league-1',
        userId: 'user-1',
      },
    });
    expect(body.success).toBe(true);
    expect(body.data.actions).toEqual([
      expect.objectContaining({
        id: 'action-1',
        actionType: 'OPTIMIZE_LINEUP',
        status: 'PENDING',
        details: { source: 'test' },
      }),
    ]);
  });
});
