import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import { adminDb } from '@/lib/firebaseAdmin';
import { redisClient } from '@/lib/redis';
import { metricsCollector, type ApplicationMetrics } from '@/lib/metrics';

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceStatus;
    memory: ServiceStatus;
    redis?: ServiceStatus;
    metrics: ServiceStatus;
  };
  metrics?: ApplicationMetrics;
}

interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
  lastChecked: string;
}

const startTime = Date.now();

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

async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    // Enhanced database check - test both read and write capabilities
    const healthCollection = adminDb.collection('_health');

    // Test read
    await healthCollection.limit(1).get();

    // Test write (with immediate cleanup)
    const testDoc = healthCollection.doc('health_check');
    const testData = { timestamp: new Date(), check: 'health' };
    await testDoc.set(testData);
    await testDoc.delete(); // Clean up immediately

    const responseTime = Date.now() - start;

    return {
      status: responseTime < 1000 ? 'healthy' : 'degraded', // Warn if slow
      responseTime,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Database connectivity issue'
          : error instanceof Error
            ? error.message
            : String(error),
      lastChecked: new Date().toISOString(),
    };
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    if (!redisClient.isConnected()) {
      return redisFailureStatus('Redis not connected', Date.now() - start);
    }

    // Test basic operations
    await redisClient.ping();

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
    error =
      process.env.NODE_ENV === 'production'
        ? 'High memory usage detected'
        : `High memory usage: ${memoryUsagePercent.toFixed(1)}%`;
  } else if (memoryUsagePercent >= 75) {
    status = 'degraded';
    error =
      process.env.NODE_ENV === 'production'
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

export async function GET(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'health' });

  try {
    // Run all health checks in parallel
    const [database, memory, redis, metricsCheck] = await Promise.all([
      checkDatabase(),
      Promise.resolve(checkMemory()),
      checkRedis(),
      checkMetrics(),
    ]);

    // Collect application metrics
    const metrics = await metricsCollector.collectAllMetrics(startTime);

    const services = {
      database,
      memory,
      redis,
      metrics: metricsCheck,
    };

    // Determine overall status based on all services
    const serviceStatuses = Object.values(services);
    const hasUnhealthyService = serviceStatuses.some((service) => service.status === 'unhealthy');
    const hasDegradedService = serviceStatuses.some((service) => service.status === 'degraded');

    let status: HealthCheck['status'];
    if (hasUnhealthyService) {
      status = 'unhealthy';
    } else if (hasDegradedService) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    const healthCheck: HealthCheck = {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Date.now() - startTime,
      services,
      metrics,
    };

    // Map status to HTTP status code
    let httpStatus: number;
    switch (status) {
      case 'healthy':
        httpStatus = 200;
        break;
      case 'degraded':
        httpStatus = 200; // Still operational, just degraded
        break;
      case 'unhealthy':
        httpStatus = 503;
        break;
      default:
        httpStatus = 500;
    }

    tracer.complete(httpStatus, {
      healthStatus: status,
      servicesChecked: Object.keys(services).length,
      hasRedis: redisClient.isConnected(),
    });

    return NextResponse.json(
      {
        success: true,
        data: healthCheck,
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
    // More comprehensive checks for readiness
    const [database, redis, metricsCheck] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkMetrics(),
    ]);

    // For readiness, we require all critical services to be healthy
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
