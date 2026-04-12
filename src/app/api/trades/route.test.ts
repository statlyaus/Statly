import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const {
  getAuthenticatedUserIdMock,
  findManyMock,
  queryRawMock,
  proposeTradeMock,
  revalidateTagMock,
} = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn(),
  findManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  proposeTradeMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));

vi.mock('@/lib/cacheTags', () => ({
  tags: {
    trades: (leagueId: string) => `trades:${leagueId}`,
    league: (leagueId: string) => `league:${leagueId}`,
  },
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/services/tradeService', () => ({
  tradeService: {
    proposeTrade: proposeTradeMock,
  },
  TradeServiceError: class TradeServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly context?: Record<string, unknown>
    ) {
      super(message);
    }
  },
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

const validRequestId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('POST /api/trades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-proposer');
    proposeTradeMock.mockResolvedValue({
      tradeId: 'trade-new',
      status: 'PROPOSED',
      createdAt: '2026-04-06T00:00:00.000Z',
    });
    revalidateTagMock.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/trades', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(proposeTradeMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid requestId', async () => {
    const req = new NextRequest('http://localhost/api/trades', {
      method: 'POST',
      body: JSON.stringify({
        requestId: 'not-a-valid-id',
        leagueId: 'league-1',
        recipientUserId: 'user-recipient',
        items: [
          {
            playerId: 'p1',
            fromUserId: 'user-proposer',
            toUserId: 'user-recipient',
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(proposeTradeMock).not.toHaveBeenCalled();
  });

  it('returns 400 when a trade item does not move between teams', async () => {
    const req = new NextRequest('http://localhost/api/trades', {
      method: 'POST',
      body: JSON.stringify({
        requestId: validRequestId,
        leagueId: 'league-1',
        recipientUserId: 'user-recipient',
        items: [
          {
            playerId: 'p1',
            fromUserId: 'user-proposer',
            toUserId: 'user-proposer',
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(proposeTradeMock).not.toHaveBeenCalled();
  });

  it('returns 400 for duplicate playerId in items', async () => {
    const req = new NextRequest('http://localhost/api/trades', {
      method: 'POST',
      body: JSON.stringify({
        requestId: validRequestId,
        leagueId: 'league-1',
        recipientUserId: 'user-recipient',
        items: [
          {
            playerId: 'p1',
            fromUserId: 'user-proposer',
            toUserId: 'user-recipient',
          },
          {
            playerId: 'p1',
            fromUserId: 'user-recipient',
            toUserId: 'user-proposer',
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(proposeTradeMock).not.toHaveBeenCalled();
  });

  it('proposes a trade when payload validates', async () => {
    const req = new NextRequest('http://localhost/api/trades', {
      method: 'POST',
      body: JSON.stringify({
        requestId: validRequestId,
        leagueId: 'league-1',
        recipientUserId: 'user-recipient',
        items: [
          {
            playerId: 'p1',
            fromUserId: 'user-proposer',
            toUserId: 'user-recipient',
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(proposeTradeMock).toHaveBeenCalledWith({
      requestId: validRequestId,
      leagueId: 'league-1',
      roundId: null,
      proposerUserId: 'user-proposer',
      recipientUserId: 'user-recipient',
      parentTradeId: null,
      note: null,
      items: [
        {
          playerId: 'p1',
          fromUserId: 'user-proposer',
          toUserId: 'user-recipient',
        },
      ],
    });
    expect(body.data).toMatchObject({
      tradeId: 'trade-new',
      status: 'PROPOSED',
    });
    expect(revalidateTagMock).toHaveBeenCalled();
  });
});
