import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const {
  getAuthenticatedUserIdMock,
  findUniqueMock,
  cancelTradeMock,
  acceptTradeMock,
  declineTradeMock,
  approveTradeReviewMock,
  rejectTradeReviewMock,
  finalizeTradeReviewMock,
  revalidateTagMock,
} = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn(),
  findUniqueMock: vi.fn(),
  cancelTradeMock: vi.fn(),
  acceptTradeMock: vi.fn(),
  declineTradeMock: vi.fn(),
  approveTradeReviewMock: vi.fn(),
  rejectTradeReviewMock: vi.fn(),
  finalizeTradeReviewMock: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trade: {
      findUnique: findUniqueMock,
    },
  },
}));

vi.mock('@/services/tradeService', () => ({
  tradeService: {
    cancelTrade: cancelTradeMock,
    acceptTrade: acceptTradeMock,
    declineTrade: declineTradeMock,
    approveTradeReview: approveTradeReviewMock,
    rejectTradeReview: rejectTradeReviewMock,
    finalizeTradeReview: finalizeTradeReviewMock,
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

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('POST /api/trades/[id]/[action]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    findUniqueMock.mockResolvedValue({ leagueId: 'league-1' });
    revalidateTagMock.mockResolvedValue(undefined);
  });

  it('cancels a trade for a valid cancel request', async () => {
    cancelTradeMock.mockResolvedValue({
      tradeId: 'trade-1',
      status: 'CANCELLED',
      createdAt: '2026-03-23T00:00:00.000Z',
    });

    const req = new NextRequest('http://localhost/api/trades/trade-1/cancel', {
      method: 'POST',
      body: JSON.stringify({ requestId: 'req-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'trade-1', action: 'cancel' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(cancelTradeMock).toHaveBeenCalledWith({
      requestId: 'req-1',
      tradeId: 'trade-1',
      actorUserId: 'user-1',
    });
    expect(body.data).toMatchObject({
      tradeId: 'trade-1',
      status: 'CANCELLED',
    });
  });

  it('rejects invalid action names', async () => {
    const req = new NextRequest('http://localhost/api/trades/trade-1/archive', {
      method: 'POST',
      body: JSON.stringify({ requestId: 'req-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'trade-1', action: 'archive' }),
    });

    expect(res.status).toBe(400);
    expect(cancelTradeMock).not.toHaveBeenCalled();
    expect(acceptTradeMock).not.toHaveBeenCalled();
    expect(declineTradeMock).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/trades/trade-1/cancel', {
      method: 'POST',
      body: JSON.stringify({ requestId: 'req-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'trade-1', action: 'cancel' }),
    });

    expect(res.status).toBe(401);
    expect(cancelTradeMock).not.toHaveBeenCalled();
  });

  it('returns 400 when requestId is missing', async () => {
    const req = new NextRequest('http://localhost/api/trades/trade-1/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'trade-1', action: 'cancel' }),
    });

    expect(res.status).toBe(400);
    expect(cancelTradeMock).not.toHaveBeenCalled();
  });

  it('routes finalize-review to tradeService.finalizeTradeReview', async () => {
    finalizeTradeReviewMock.mockResolvedValue({
      tradeId: 'trade-1',
      status: 'EXECUTED',
      createdAt: '2026-03-23T00:00:00.000Z',
    });

    const req = new NextRequest('http://localhost/api/trades/trade-1/finalize-review', {
      method: 'POST',
      body: JSON.stringify({ requestId: 'req-finalize' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'trade-1', action: 'finalize-review' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(finalizeTradeReviewMock).toHaveBeenCalledWith({
      requestId: 'req-finalize',
      tradeId: 'trade-1',
      actorUserId: 'user-1',
    });
    expect(body.data).toMatchObject({ tradeId: 'trade-1', status: 'EXECUTED' });
  });
});
