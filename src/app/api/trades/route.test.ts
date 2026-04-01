import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { getAuthenticatedUserIdMock, findManyMock, queryRawMock } = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn(),
  findManyMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trade: {
      findMany: findManyMock,
    },
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('GET /api/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes latest audit activity in the trade summary payload', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    findManyMock.mockResolvedValue([
      {
        id: 'trade-1',
        proposerUserId: 'user-1',
        recipientUserId: 'user-2',
        status: 'PROPOSED',
        createdAt: new Date('2026-03-23T09:00:00.000Z'),
        executedAt: null,
        audit: [
          {
            event: 'TRADE_COUNTERED',
            actorUserId: 'user-2',
            createdAt: new Date('2026-03-23T09:12:00.000Z'),
          },
        ],
      },
    ]);
    queryRawMock.mockResolvedValue([
      {
        id: 'trade-1',
        proposerViewedAt: null,
        recipientViewedAt: '2026-03-23T09:18:00.000Z',
      },
    ]);

    const req = new NextRequest('http://localhost/api/trades?leagueId=league-1');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.trades[0]).toMatchObject({
      tradeId: 'trade-1',
      latestActivityEvent: 'TRADE_COUNTERED',
      latestActivityActorUserId: 'user-2',
      latestActivityAt: '2026-03-23T09:12:00.000Z',
      recipientViewedAt: '2026-03-23T09:18:00.000Z',
    });
  });
});
