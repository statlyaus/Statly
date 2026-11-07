import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  firestoreGet: vi.fn(),
  checkRelationalDatabase: vi.fn(),
  metricsHealthCheck: vi.fn(),
  collectAllMetrics: vi.fn(),
}));

const firebaseAdmin = vi.hoisted(() => () => ({
  adminDb: {
    collection: () => ({ doc: () => ({ get: mocks.firestoreGet }) }),
  },
}));
vi.mock('@/lib/firebaseAdmin', firebaseAdmin);
vi.mock('../../src/lib/firebaseAdmin', firebaseAdmin);

const redis = vi.hoisted(() => () => ({
  redisClient: {
    isConnected: () => true,
    ping: vi.fn().mockResolvedValue('PONG'),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue('test'),
    del: vi.fn().mockResolvedValue(1),
  },
}));
vi.mock('@/lib/redis', redis);
vi.mock('../../src/lib/redis', redis);

const metrics = vi.hoisted(() => () => ({
  metricsCollector: {
    healthCheck: mocks.metricsHealthCheck,
    collectAllMetrics: mocks.collectAllMetrics,
  },
}));
vi.mock('@/lib/metrics', metrics);
vi.mock('../../src/lib/metrics', metrics);

const relational = vi.hoisted(() => () => ({
  checkRelationalDatabase: mocks.checkRelationalDatabase,
}));
vi.mock('@/server/health/relationalDatabaseHealth', relational);
vi.mock('../../src/server/health/relationalDatabaseHealth', relational);

const tracing = vi.hoisted(() => () => ({
  withRequestTracing: () => ({
    complete: vi.fn(),
    error: vi.fn(),
    getTraceHeaders: () => ({}),
  }),
}));
vi.mock('@/lib/requestTracing', tracing);
vi.mock('../../src/lib/requestTracing', tracing);

const request = () => new Request('https://statly.test/api/health') as NextRequest;

describe('health route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.firestoreGet.mockResolvedValue({ exists: true });
    mocks.checkRelationalDatabase.mockResolvedValue({
      status: 'unhealthy',
      responseTime: 3,
      error: 'connect ECONNREFUSED 10.0.0.5:5432',
      lastChecked: new Date().toISOString(),
    });
    mocks.metricsHealthCheck.mockResolvedValue({ status: 'healthy' });
    mocks.collectAllMetrics.mockResolvedValue({ requests: { total: 42 } });
  });

  it('returns only per-service status to anonymous callers', async () => {
    const { GET } = await import('../../src/app/api/health/route');
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.data).toEqual({
      status: 'unhealthy',
      timestamp: expect.any(String),
      services: {
        database: 'healthy',
        relationalDatabase: 'unhealthy',
        memory: expect.any(String),
        redis: 'healthy',
        metrics: 'healthy',
      },
    });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(mocks.collectAllMetrics).not.toHaveBeenCalled();
  });

  it('reuses one round of checks for repeated calls', async () => {
    const { GET } = await import('../../src/app/api/health/route');
    await GET(request());
    await GET(request());

    expect(mocks.checkRelationalDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.firestoreGet).toHaveBeenCalledTimes(1);
  });
});
