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
    collectAllMetrics: vi.fn(() => Promise.resolve({
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
    })),
  },
}));

describe('Health API', () => {
  let mockRequest: NextRequest;

  beforeEach(() => {
    mockRequest = new NextRequest('http://localhost:3000/api/health');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return 200 with healthy status when all services are healthy', async () => {
      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('healthy');
      expect(data.data.services).toHaveProperty('database');
      expect(data.data.services).toHaveProperty('memory');
      expect(data.data.services).toHaveProperty('redis');
      expect(data.data.services).toHaveProperty('metrics');
      expect(data.data.metrics).toBeDefined();
    });

    it('should include comprehensive metrics', async () => {
      const response = await GET(mockRequest);
      const data = await response.json();

      expect(data.data.metrics).toEqual(expect.objectContaining({
        totalRequests: expect.any(Number),
        errorRate: expect.any(Number),
        averageResponseTime: expect.any(Number),
        memoryUsage: expect.any(Object),
        redis: expect.any(Object),
      }));
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
      expect(data.data.services.memory.status).toBe('healthy');
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

    it('should return 503 when Redis is not ready', async () => {
      const { redisClient } = await import('@/lib/redis');
      vi.mocked(redisClient.isConnected).mockReturnValue(false);

      const response = await PATCH(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.ready).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const { adminDb } = await import('@/lib/firebaseAdmin');
      vi.mocked(adminDb.collection).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.data.status).toBe('unhealthy');
      expect(data.data.services.database.status).toBe('unhealthy');
    });

    it('should handle Redis errors gracefully', async () => {
      const { redisClient } = await import('@/lib/redis');
      vi.mocked(redisClient.ping).mockRejectedValue(new Error('Redis connection failed'));

      const response = await GET(mockRequest);
      const data = await response.json();

      expect(data.data.services.redis.status).toBe('unhealthy');
    });
  });
});
