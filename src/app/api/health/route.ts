import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import { adminDb } from '@/lib/firebaseAdmin';
import { redisClient } from '@/lib/redis';
import { metricsCollector } from '@/lib/metrics';
import { checkRelationalDatabase } from '@/server/health/relationalDatabaseHealth';

interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
  lastChecked: string;
}

interface ServiceChecks {
  // Prisma is the authoritative database; `relationalDatabase` is the same probe under its older name.
  database: ServiceStatus;
  relationalDatabase: ServiceStatus;
  firestoreProjection: ServiceStatus;
  memory: ServiceStatus;
  redis: ServiceStatus;
  metrics: ServiceStatus;
}

// The route is public, so one round of checks (a Prisma query, a Firestore read and Redis writes)
// serves every caller for this long instead of running per request.
const CHECK_TTL_MS = 10_000;
// A fresh instance's Redis client is still connecting; ioredis queues the ping until it is ready.
const REDIS_PING_TIMEOUT_MS = 2_000;
let cachedChecks: { at: number; result: Promise<ServiceChecks> } | null = null;

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isRedisExplicitlyConfigured(): boolean {
  return Boolean(
    process.env.REDIS_URL ||
    process.env.REDIS_HOST ||
    process.env.REDIS_PORT ||
    process.env.REDIS_PASSWORD
  );
}

function isRedisRequired(): boolean {
  return isProductionEnvironment() || isRedisExplicitlyConfigured();
}

function redisFailureStatus(error: string, responseTime: number): ServiceStatus {
  const required = isRedisRequired();

  return {
    status: required ? 'unhealthy' : 'degraded',
    responseTime,
    error: required ? error : `Optional local Redis unavailable: ${error}`,
    lastChecked: new Date().toISOString(),
  };
}

// Firestore is an ingestion and compatibility projection, never the authority, so its failure
// degrades the service rather than making it unhealthy.
async function checkFirestoreProjection(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await adminDb.collection('_health').doc('ping').get();

    const responseTime = Date.now() - start;

    return {
      status: responseTime < 1000 ? 'healthy' : 'degraded', // Warn if slow
      responseTime,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'degraded',
      responseTime: Date.now() - start,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Firestore projection connectivity issue'
          : error instanceof Error
            ? error.message
            : String(error),
      lastChecked: new Date().toISOString(),
    };
  }
}

function pingRedisWithin(timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Redis not connected')), timeoutMs);
  });
  return Promise.race([redisClient.ping(), timeout]).finally(() => clearTimeout(timer));
}

async function checkRedis(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    // Waits for a connection still being made on a cold start instead of failing it.
    await pingRedisWithin(REDIS_PING_TIMEOUT_MS);

    // Test set/get/delete operations
    const testKey = 'health_check:' + Date.now();
    await redisClient.set(testKey, 'test', 5); // 5 second TTL
    const value = await redisClient.get(testKey);
    await redisClient.del(testKey);

    if (value !== 'test') {
      throw new Error('Redis set/get operation failed');
    }

    const responseTime = Date.now() - start;

    return {
      status: responseTime < 100 ? 'healthy' : 'degraded',
      responseTime,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return redisFailureStatus(
      process.env.NODE_ENV === 'production'
        ? 'Cache service error'
        : error instanceof Error
          ? error.message
          : 'Redis error',
      Date.now() - start
    );
  }
}

async function checkMetrics(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const healthCheck = await metricsCollector.healthCheck();

    return {
      status: healthCheck.status === 'healthy' ? 'healthy' : 'unhealthy',
      responseTime: Date.now() - start,
      error: healthCheck.error,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Metrics service error'
          : error instanceof Error
            ? error.message
            : 'Metrics error',
      lastChecked: new Date().toISOString(),
    };
  }
}

function checkMemory(): ServiceStatus {
  const memUsage = process.memoryUsage();
  const totalMemoryMB = memUsage.heapTotal / 1024 / 1024;
  const usedMemoryMB = memUsage.heapUsed / 1024 / 1024;
  const memoryUsagePercent = (usedMemoryMB / totalMemoryMB) * 100;

  let status: ServiceStatus['status'];
  let error: string | undefined;

  if (memoryUsagePercent >= 90) {
    status = isProductionEnvironment() ? 'unhealthy' : 'degraded';
    error = isProductionEnvironment()
      ? 'High memory usage detected'
      : `High memory usage: ${memoryUsagePercent.toFixed(1)}%`;
  } else if (memoryUsagePercent >= 75) {
    status = 'degraded';
    error = isProductionEnvironment()
      ? 'Elevated memory usage'
      : `Elevated memory usage: ${memoryUsagePercent.toFixed(1)}%`;
  } else {
    status = 'healthy';
  }

  return {
    status,
    lastChecked: new Date().toISOString(),
    error,
  };
}

function runChecks(): Promise<ServiceChecks> {
  const now = Date.now();
  if (cachedChecks && now - cachedChecks.at < CHECK_TTL_MS) {
    return cachedChecks.result;
  }
  const result = Promise.all([
    checkRelationalDatabase(),
    checkFirestoreProjection(),
    checkRedis(),
    checkMetrics(),
  ]).then(([relationalDatabase, firestoreProjection, redis, metrics]) => ({
    database: relationalDatabase,
    relationalDatabase,
    firestoreProjection,
    memory: checkMemory(),
    redis,
    metrics,
  }));
  cachedChecks = { at: now, result };
  return result;
}

export async function GET(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'health' });

  try {
    const services = await runChecks();
    const serviceStatuses = Object.values(services);

    // Detail (errors, timings) stays in the server log; anonymous callers see status only.
    for (const [name, service] of Object.entries(services)) {
      if (service.status !== 'healthy') {
        logger.warn('Health check service not healthy', {
          service: name,
          status: service.status,
          error: service.error,
          responseTime: service.responseTime,
        });
      }
    }

    let status: ServiceStatus['status'];
    if (serviceStatuses.some((service) => service.status === 'unhealthy')) {
      status = 'unhealthy';
    } else if (serviceStatuses.some((service) => service.status === 'degraded')) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    // Degraded is still operational.
    const httpStatus = status === 'unhealthy' ? 503 : 200;

    tracer.complete(httpStatus, {
      healthStatus: status,
      servicesChecked: serviceStatuses.length,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          status,
          timestamp: new Date().toISOString(),
          services: {
            database: services.database.status,
            relationalDatabase: services.relationalDatabase.status,
            firestoreProjection: services.firestoreProjection.status,
            memory: services.memory.status,
            redis: services.redis.status,
            metrics: services.metrics.status,
          },
        },
        timestamp: new Date().toISOString(),
      },
      {
        status: httpStatus,
        headers: tracer.getTraceHeaders(),
      }
    );
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);

    logger.error('Health check failed', error instanceof Error ? error : new Error(String(error)));

    return commonErrors.internalServerError('Health check failed');
  }
}

// Liveness probe - simple endpoint that returns 200 if the service is running
export async function HEAD(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'health-liveness' });

  try {
    tracer.complete(200);
    return new NextResponse(null, {
      status: 200,
      headers: tracer.getTraceHeaders(),
    });
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return new NextResponse(null, { status: 500 });
  }
}

// Readiness probe - comprehensive check for Kubernetes readiness
export async function PATCH(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'health-readiness' });

  try {
    const {
      database,
      relationalDatabase,
      firestoreProjection,
      redis,
      metrics: metricsCheck,
    } = await runChecks();

    // For readiness, we require all critical services to be healthy. The Firestore projection is
    // reported but not critical.
    const criticalServices = [database, metricsCheck];
    const redisReady = isRedisRequired()
      ? redis.status === 'healthy'
      : redis.status !== 'unhealthy';
    const isReady = criticalServices.every((service) => service.status === 'healthy') && redisReady;

    const status = isReady ? 200 : 503;
    tracer.complete(status, {
      ready: isReady,
      criticalServicesCount: criticalServices.length,
    });

    return new NextResponse(
      JSON.stringify({
        ready: isReady,
        timestamp: new Date().toISOString(),
        services: {
          database: database.status,
          relationalDatabase: relationalDatabase.status,
          firestoreProjection: firestoreProjection.status,
          redis: redis.status,
          metrics: metricsCheck.status,
        },
      }),
      {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...tracer.getTraceHeaders(),
        },
      }
    );
  } catch (error) {
    tracer.error(error instanceof Error ? error : new Error(String(error)), 500);
    return new NextResponse(
      JSON.stringify({
        ready: false,
        error: 'Readiness check failed',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
