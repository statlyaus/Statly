import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { getAuthenticatedUserIdMock, findUniqueMock } = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn(),
  findUniqueMock: vi.fn(),
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
});
