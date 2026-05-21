import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPoolStatsMock = vi.fn();
const checkHealthMock = vi.fn();
const startMock = vi.fn();
const stopMock = vi.fn();
const addWorkerMock = vi.fn();
const removeWorkerMock = vi.fn();

vi.mock('@/server/workers/workerPool', () => ({
  workerPool: {
    getPoolStats: getPoolStatsMock,
    checkHealth: checkHealthMock,
    start: startMock,
    stop: stopMock,
    addWorker: addWorkerMock,
    removeWorker: removeWorkerMock,
  },
}));

describe('/api/admin/workers authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    vi.stubEnv('ADMIN_API_TOKEN', 'admin-secret');
    getPoolStatsMock.mockReturnValue({ workers: 1 });
    checkHealthMock.mockResolvedValue({ healthy: true });
    startMock.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated worker status requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(new NextRequest('http://localhost/api/admin/workers'));

    expect(response.status).toBe(401);
    expect(getPoolStatsMock).not.toHaveBeenCalled();
  });

  it('allows authenticated worker status requests', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/admin/workers?action=stats', {
        headers: { authorization: 'Bearer admin-secret' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getPoolStatsMock).toHaveBeenCalled();
    expect(body).toEqual({ success: true, data: { workers: 1 } });
  });

  it('rejects unauthenticated worker mutation requests', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/admin/workers', {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      })
    );

    expect(response.status).toBe(401);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('allows authenticated worker mutation requests', async () => {
    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/admin/workers', {
        method: 'POST',
        headers: { 'x-admin-token': 'admin-secret' },
        body: JSON.stringify({ action: 'start' }),
      })
    );

    expect(response.status).toBe(200);
    expect(startMock).toHaveBeenCalled();
  });
});
