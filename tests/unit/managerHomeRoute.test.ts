import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthenticatedUserIdMock = vi.hoisted(() => vi.fn());
const loadManagerHomeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/serverAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('@/server/dashboard/managerHome', () => ({
  loadManagerHome: loadManagerHomeMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

import { GET } from '@/app/api/dashboard/home/route';

function request(search = '') {
  return new NextRequest(`http://localhost/api/dashboard/home${search}`);
}

describe('GET /api/dashboard/home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires authentication', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(loadManagerHomeMock).not.toHaveBeenCalled();
  });

  it('loads only the signed-in user, ignoring any userId in the query', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    loadManagerHomeMock.mockResolvedValue({ generatedAt: '2026-09-26T00:00:00.000Z', leagues: [] });

    const response = await GET(request('?userId=someone-else'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(loadManagerHomeMock).toHaveBeenCalledWith({ userId: 'user-1' });
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { generatedAt: '2026-09-26T00:00:00.000Z', leagues: [] },
    });
  });

  it('returns a generic error without leaking details', async () => {
    getAuthenticatedUserIdMock.mockResolvedValue('user-1');
    loadManagerHomeMock.mockRejectedValue(new Error('database exploded'));

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Could not load your leagues',
    });
  });
});
