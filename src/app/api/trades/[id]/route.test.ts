import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { getAuthenticatedUserIdMock, findUniqueMock, queryRawMock, executeRawMock } = vi.hoisted(
  () => ({
    getAuthenticatedUserIdMock: vi.fn(),
    findUniqueMock: vi.fn(),
    queryRawMock: vi.fn(),
    executeRawMock: vi.fn(),
  })
);

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trade: {
      findUnique: findUniqueMock,
    },
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    $executeRaw: (...args: unknown[]) => executeRawMock(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('GET /api/trades/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid trade id params', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    const req = new NextRequest('http://localhost/api/trades/');
    const res = await GET(req, { params: Promise.resolve({ id: '' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns sanitized 500 response on unexpected failures', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    findUniqueMock.mockRejectedValue(new Error('db connection exploded'));

    const req = new NextRequest('http://localhost/api/trades/trade-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'trade-1' }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.message).toBe('Server error');
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('marks the trade as viewed for the current user before returning details', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-2');
    findUniqueMock.mockResolvedValue({
      id: 'trade-1',
      proposerUserId: 'user-1',
      recipientUserId: 'user-2',
      status: 'PROPOSED',
      createdAt: new Date('2026-03-23T09:00:00.000Z'),
      executedAt: null,
      acceptedAt: null,
      reviewMode: 'NONE',
      reviewStatus: 'NOT_REQUIRED',
      reviewRequestedAt: null,
      reviewWindowEndsAt: null,
      reviewDecidedAt: null,
      items: [],
      reviewVotes: [],
      audit: [],
    });
    executeRawMock.mockResolvedValue(1);
    queryRawMock.mockResolvedValue([
      {
        id: 'trade-1',
        proposerViewedAt: null,
        recipientViewedAt: '2026-03-23T09:12:00.000Z',
      },
    ]);

    const req = new NextRequest('http://localhost/api/trades/trade-1');
    const res = await GET(req, { params: Promise.resolve({ id: 'trade-1' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(executeRawMock).toHaveBeenCalled();
    expect(body.data.recipientViewedAt).toBe('2026-03-23T09:12:00.000Z');
  });
});
