import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getWaitingMock = vi.fn();
const getActiveMock = vi.fn();
const getCompletedMock = vi.fn();
const getFailedMock = vi.fn();
const getDelayedMock = vi.fn();
const pauseMock = vi.fn();
const resumeMock = vi.fn();

vi.mock('@/server/queue/draftQueue', () => ({
  draftQueue: {
    getWaiting: getWaitingMock,
    getActive: getActiveMock,
    getCompleted: getCompletedMock,
    getFailed: getFailedMock,
    getDelayed: getDelayedMock,
    pause: pauseMock,
    resume: resumeMock,
    getJob: vi.fn(),
    remove: vi.fn(),
    clean: vi.fn(),
  },
}));

describe('/api/admin/queue authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');
    getWaitingMock.mockResolvedValue([]);
    getActiveMock.mockResolvedValue([]);
    getCompletedMock.mockResolvedValue([]);
    getFailedMock.mockResolvedValue([]);
    getDelayedMock.mockResolvedValue([]);
    pauseMock.mockResolvedValue(undefined);
    resumeMock.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated queue status requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/admin/queue?action=stats'));

    expect(response.status).toBe(401);
    expect(getWaitingMock).not.toHaveBeenCalled();
  });

  it('allows authenticated queue status requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/queue?action=stats', {
        headers: { 'x-admin-token': 'admin-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(getWaitingMock).toHaveBeenCalled();
  });

  it('rejects unauthenticated queue mutation requests', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/admin/queue', {
        method: 'POST',
        body: JSON.stringify({ action: 'pause' }),
      })
    );

    expect(response.status).toBe(401);
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it('allows authenticated queue mutation requests', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/admin/queue', {
        method: 'POST',
        headers: { authorization: 'Bearer admin-secret' },
        body: JSON.stringify({ action: 'pause' }),
      })
    );

    expect(response.status).toBe(200);
    expect(pauseMock).toHaveBeenCalled();
  });
});
