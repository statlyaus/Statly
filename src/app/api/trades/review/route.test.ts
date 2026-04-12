import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const {
  getAuthenticatedUserIdMock,
  getUserMock,
  findUniqueMock,
  acceptTradeMock,
  castTradeReviewVoteMock,
} = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn(),
  getUserMock: vi.fn(),
  findUniqueMock: vi.fn(),
  acceptTradeMock: vi.fn(),
  castTradeReviewVoteMock: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    getUser: getUserMock,
  },
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
    acceptTrade: acceptTradeMock,
    castTradeReviewVote: castTradeReviewVoteMock,
    approveTradeReview: vi.fn(),
    rejectTradeReview: vi.fn(),
    finalizeTradeReview: vi.fn(),
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

function makeTrade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trade-1',
    proposerUserId: 'user-1',
    recipientUserId: 'user-2',
    status: 'PROPOSED',
    reviewMode: 'NONE',
    reviewStatus: 'NOT_REQUIRED',
    acceptedAt: null,
    executedAt: null,
    reviewRequestedAt: null,
    reviewWindowEndsAt: null,
    reviewDecidedAt: null,
    reviewVotes: [],
    audit: [],
    league: {
      members: [
        { userId: 'user-1', role: 'OWNER' },
        { userId: 'user-2', role: 'MANAGER' },
        { userId: 'user-3', role: 'MANAGER' },
      ],
    },
    ...overrides,
  };
}

describe('trade review route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedUserIdMock.mockResolvedValue('user-2');
    getUserMock.mockResolvedValue({ customClaims: {} });
    findUniqueMock.mockResolvedValue(makeTrade());
  });

  it('requires authentication for GET', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/trades/review?tradeId=trade-1');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns review state for league participants', async () => {
    const req = new NextRequest('http://localhost/api/trades/review?tradeId=trade-1');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.state).toMatchObject({
      status: 'offered',
      tradeStatus: 'PROPOSED',
      reviewMode: 'NONE',
    });
  });

  it('accept action delegates to the trade service for recipient acceptance', async () => {
    acceptTradeMock.mockResolvedValue({
      tradeId: 'trade-1',
      status: 'REVIEW_PENDING',
      createdAt: '2026-03-31T00:00:00.000Z',
    });
    findUniqueMock.mockResolvedValueOnce(makeTrade()).mockResolvedValueOnce(
      makeTrade({
        status: 'REVIEW_PENDING',
        reviewMode: 'ADMIN',
        reviewStatus: 'PENDING',
      })
    );

    const req = new NextRequest('http://localhost/api/trades/review?tradeId=trade-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'accept', requestId: 'req-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(acceptTradeMock).toHaveBeenCalledWith({
      requestId: 'req-1',
      tradeId: 'trade-1',
      actorUserId: 'user-2',
    });
  });

  it('veto action records a veto vote for eligible league members', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-3');
    findUniqueMock
      .mockResolvedValueOnce(
        makeTrade({
          status: 'REVIEW_PENDING',
          reviewMode: 'VETO',
          reviewStatus: 'PENDING',
        })
      )
      .mockResolvedValueOnce(
        makeTrade({
          status: 'REVIEW_PENDING',
          reviewMode: 'VETO',
          reviewStatus: 'PENDING',
          reviewVotes: [
            {
              voterUserId: 'user-3',
              voteType: 'VETO',
              createdAt: new Date('2026-03-31T00:00:00.000Z'),
            },
          ],
        })
      );

    const req = new NextRequest('http://localhost/api/trades/review?tradeId=trade-1', {
      method: 'POST',
      body: JSON.stringify({ action: 'veto', requestId: 'req-veto-1' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(castTradeReviewVoteMock).toHaveBeenCalledWith({
      requestId: 'req-veto-1',
      tradeId: 'trade-1',
      actorUserId: 'user-3',
      voteType: 'VETO',
    });
  });
});
