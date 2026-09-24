import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftQueue, workerPool, logger } = vi.hoisted(() => ({
  draftQueue: {
    getWaiting: vi.fn(),
    getActive: vi.fn(),
    getCompleted: vi.fn(),
    getFailed: vi.fn(),
    getDelayed: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getJob: vi.fn(),
    remove: vi.fn(),
    clean: vi.fn(),
  },
  workerPool: {
    getPoolStats: vi.fn(),
    checkHealth: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    addWorker: vi.fn(),
    removeWorker: vi.fn(),
  },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/server/queue/draftQueue', () => ({ draftQueue }));
vi.mock('@/server/workers/workerPool', () => ({ workerPool }));

import { GET as GET_QUEUE, POST as POST_QUEUE } from '@/app/api/admin/queue/route';
import { GET as GET_WORKERS, POST as POST_WORKERS } from '@/app/api/admin/workers/route';

// Generated per run: the suite must exercise the configured-value comparison without any
// credential-shaped literal appearing in the repository.
const operatorSecret = randomUUID();
const wrongSecret = randomUUID();
const operatorHeaders = { 'x-admin-secret': operatorSecret };

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init);
}

function queuePost(headers?: Record<string, string>) {
  return POST_QUEUE(
    request('/api/admin/queue', {
      method: 'POST',
      ...(headers ? { headers } : {}),
      body: JSON.stringify({ action: 'pause' }),
    })
  );
}

function workersPost(headers?: Record<string, string>) {
  return POST_WORKERS(
    request('/api/admin/workers', {
      method: 'POST',
      ...(headers ? { headers } : {}),
      body: JSON.stringify({ action: 'stop' }),
    })
  );
}

describe('administrative control-plane authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_SECRET;
  });

  it('denies every administrative handler when the operator secret is not configured', async () => {
    const responses = await Promise.all([
      GET_QUEUE(request('/api/admin/queue')),
      queuePost(),
      GET_WORKERS(request('/api/admin/workers')),
      workersPost(),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(draftQueue.pause).not.toHaveBeenCalled();
    expect(workerPool.stop).not.toHaveBeenCalled();
  });

  it('denies an incorrect operator secret without reaching queue or worker state', async () => {
    process.env.ADMIN_SECRET = operatorSecret;

    const responses = await Promise.all([
      GET_QUEUE(request('/api/admin/queue')),
      queuePost({ 'x-admin-secret': wrongSecret }),
      GET_WORKERS(request('/api/admin/workers')),
      workersPost({ 'x-admin-secret': wrongSecret }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(draftQueue.pause).not.toHaveBeenCalled();
    expect(workerPool.stop).not.toHaveBeenCalled();
  });

  it('allows queue and worker control when the operator secret matches', async () => {
    process.env.ADMIN_SECRET = operatorSecret;
    draftQueue.pause.mockResolvedValue(undefined);
    workerPool.stop.mockResolvedValue(undefined);

    const queueResponse = await queuePost(operatorHeaders);
    const workerResponse = await workersPost(operatorHeaders);

    expect(queueResponse.status).toBe(200);
    expect(workerResponse.status).toBe(200);
    expect(draftQueue.pause).toHaveBeenCalledTimes(1);
    expect(workerPool.stop).toHaveBeenCalledTimes(1);
  });
});
