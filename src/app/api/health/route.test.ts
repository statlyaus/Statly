import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, HEAD, PATCH } from './route';

// Mock the dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/requestTracing', () => ({
  withRequestTracing: vi.fn(() => ({
    complete: vi.fn(),
    error: vi.fn(),
    getTraceHeaders: vi.fn(() => ({ 'X-Trace-Id': 'test-trace-id' })),
  })),
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminDb: {
    collection: vi.fn(() => ({
      limit: vi.fn(() => ({
        get: vi.fn(() => Promise.resolve()),
      })),
      doc: vi.fn(() => ({
        get: vi.fn(() => Promise.resolve()),
        set: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock('@/lib/redis', () => ({
  redisClient: {
    isConnected: vi.fn(() => true),
    ping: vi.fn(() => Promise.resolve('PONG')),
    set: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => Promise.resolve('test')),
    del: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/lib/metrics', () => ({
  metricsCollector: {
    healthCheck: vi.fn(() => Promise.resolve({ status: 'healthy' })),
    collectAllMetrics: vi.fn(() =>
      Promise.resolve({
        totalRequests: 100,
        totalErrors: 1,
        errorRate: 1.0,
        averageResponseTime: 150,
        activeConnections: 5,
        memoryUsage: {
          heapUsed: 50000000,
          heapTotal: 100000000,
          external: 5000000,
          arrayBuffers: 1000000,
        },
        uptime: 86400000,
        version: '1.0.0',
        redis: {
          connectedClients: 2,
          usedMemory: 1000000,
          totalCommandsProcessed: 500,
          keyspaceHits: 400,
          keyspaceMisses: 100,
          hitRate: 80.0,
        },
      })
    ),
  },
}));

vi.mock('@/server/health/relationalDatabaseHealth', () => ({
  checkRelationalDatabase: vi.fn(() =>
    Promise.resolve({
      status: 'healthy',
      responseTime: 5,
      lastChecked: new Date().toISOString(),
    })
  ),
}));

describe('Health API', () => {
  let mockRequest: NextRequest;
  // The route shares one round of checks for 10 seconds, so each test starts a minute later.
  let clock = Date.UTC(2026, 0, 1);

  function useOptionalLocalRedisEnv() {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('REDIS_URL', undefined);
    vi.stubEnv('REDIS_HOST', undefined);
    vi.stubEnv('REDIS_PORT', undefined);
    vi.stubEnv('REDIS_PASSWORD', undefined);
  }

  beforeEach(() => {
    mockRequest = new NextRequest('http://localhost:3000/api/health');
    vi.clearAllMocks();
    useOptionalLocalRedisEnv();
    clock += 60_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('GET /api/health', () => {
    it('should return 200 with healthy status when all services are healthy', async () => {
      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('healthy');
      expect(data.data.services).toHaveProperty('database');
      expect(data.data.services).toHaveProperty('relationalDatabase');
      expect(data.data.services).toHaveProperty('memory');
      expect(data.data.services).toHaveProperty('redis');
      expect(data.data.services).toHaveProperty('metrics');
    });

    it('should not expose application metrics, uptime or per-service timings', async () => {
      const { metricsCollector } = await import('@/lib/metrics');
      const response = await GET(mockRequest);
      const data = await response.json();

      expect(data.data.metrics).toBeUndefined();
      expect(data.data.uptime).toBeUndefined();
      expect(data.data.services.database).toBe('healthy');
      expect(metricsCollector.collectAllMetrics).not.toHaveBeenCalled();
    });

    it('should include proper trace headers', async () => {
      const response = await GET(mockRequest);

      expect(response.headers.get('X-Trace-Id')).toBe('test-trace-id');
    });

    it('should return proper status codes based on service health', async () => {
      const response = await GET(mockRequest);
      const data = await response.json();

      // Should return healthy status with our mocked services
      expect(response.status).toBe(200);
      expect(data.data.status).toBe('healthy');
      expect(data.data.services.memory).toBe('healthy');
    });

    it('should stay operational but degraded when optional local Redis is unavailable', async () => {
      const { redisClient } = await import('@/lib/redis');
      vi.mocked(redisClient.ping).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.status).toBe('degraded');
      expect(data.data.services.redis).toBe('degraded');
      expect(JSON.stringify(data)).not.toContain('Optional local Redis unavailable');
    });

    it('should treat development heap pressure as degraded instead of unhealthy', async () => {
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100,
        heapTotal: 100,
        heapUsed: 95,
        external: 0,
        arrayBuffers: 0,
      });

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.status).toBe('degraded');
      expect(data.data.services.memory).toBe('degraded');
    });
  });

  describe('HEAD /api/health', () => {
    it('should return 200 for liveness probe', async () => {
      const response = await HEAD(mockRequest);

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Trace-Id')).toBe('test-trace-id');
    });
  });

  describe('PATCH /api/health', () => {
    it('should return 200 when all critical services are ready', async () => {
      const response = await PATCH(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ready).toBe(true);
      expect(data.services).toHaveProperty('database');
      expect(data.services).toHaveProperty('redis');
      expect(data.services).toHaveProperty('metrics');
    });

    it('should return 200 when optional local Redis is not ready', async () => {
      const { redisClient } = await import('@/lib/redis');
      vi.mocked(redisClient.ping).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await PATCH(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ready).toBe(true);
      expect(data.services.redis).toBe('degraded');
    });

    it('should return 503 when production Redis is not ready', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { redisClient } = await import('@/lib/redis');
      vi.mocked(redisClient.ping).mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const response = await PATCH(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.ready).toBe(false);
      expect(data.services.redis).toBe('unhealthy');
    });
  });

  describe('Error Handling', () => {
    it('reports the database from Prisma, the authoritative store', async () => {
      const { checkRelationalDatabase } = await import('@/server/health/relationalDatabaseHealth');
      vi.mocked(checkRelationalDatabase).mockResolvedValueOnce({
        status: 'unhealthy',
        responseTime: 5,
        error: 'Relational database connectivity issue',
        lastChecked: new Date().toISOString(),
      });

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.data.status).toBe('unhealthy');
      expect(data.data.services.database).toBe('unhealthy');
      expect(data.data.services.relationalDatabase).toBe('unhealthy');
      expect(JSON.stringify(data)).not.toContain('connectivity issue');
    });

    it('treats a Firestore projection failure as degraded, not a database outage', async () => {
      const { adminDb } = await import('@/lib/firebaseAdmin');
      vi.mocked(adminDb.collection).mockImplementationOnce(() => {
        throw new Error('Firestore unavailable');
      });

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.status).toBe('degraded');
      expect(data.data.services.database).toBe('healthy');
      expect(data.data.services.firestoreProjection).toBe('degraded');
    });

    it('waits for production Redis that is still connecting on a cold start', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { redisClient } = await import('@/lib/redis');
      vi.mocked(redisClient.isConnected).mockReturnValue(false);

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.services.redis).toBe('healthy');
    });

    it('should handle configured Redis errors gracefully', async () => {
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
      const { redisClient } = await import('@/lib/redis');
      vi.mocked(redisClient.ping).mockRejectedValue(new Error('Redis connection failed'));

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(data.data.services.redis).toBe('unhealthy');
    });
  });
});
