import { type NextRequest, NextResponse } from 'next/server';

import { commonErrors } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';
import { getLeagueRosterOwnershipHealth } from '@/lib/leagueRosterOwnershipHealth';
import { getPlayerReadModelHealth } from '@/lib/playerReadModelHealth';
import { logger } from '@/lib/logger';
import { metricsCollector, type ApplicationMetrics } from '@/lib/metrics';
import { redisClient } from '@/lib/redis';
import { withRequestTracing } from '@/lib/requestTracing';
export const runtime = 'nodejs';

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceStatus;
    memory: ServiceStatus;
    rosterOwnership: ServiceStatus;
    playerReadModels: ServiceStatus;
    redis?: ServiceStatus;
    metrics: ServiceStatus;
  };
  metrics?: ApplicationMetrics;
}

interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
  details?: Record<string, number | string | boolean>;
  lastChecked: string;
}

const startTime = Date.now();

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
      return {
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: 'Redis not connected',
        lastChecked: new Date().toISOString(),
      };
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
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Cache service error'
          : error instanceof Error
            ? error.message
            : 'Redis error',
      lastChecked: new Date().toISOString(),
    };
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

async function checkPlayerReadModels(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const summary = await getPlayerReadModelHealth();
    return {
      status: summary.status,
      responseTime: Date.now() - start,
      error:
        summary.status === 'healthy'
          ? undefined
          : summary.status === 'degraded'
            ? `Player read models degraded for season ${summary.details.resolvedSeason}: summaryGap=${summary.details.summaryGapDetected}, advancedCoverageHealthy=${summary.details.advancedStatCoverageHealthy}, degradedStats=${summary.details.degradedAdvancedStats.join(', ') || 'none'}. Run precompute / publication pipeline.`
            : summary.error,
      details: {
        playerCount: summary.details.playerCount,
        resolvedSeason: summary.details.resolvedSeason,
        seasonSummaryCount: summary.details.seasonSummaryCount,
        totalSummaryRows: summary.details.totalSummaryRows,
        summaryGapDetected: summary.details.summaryGapDetected,
        evaluationMode: summary.details.evaluationMode,
        latestSummaryUpdatedAt: summary.details.latestSummaryUpdatedAt ?? '',
        hasPublication: Boolean(summary.details.latestPublication),
        advancedStatCoverageHealthy: summary.details.advancedStatCoverageHealthy,
        degradedAdvancedStats: summary.details.degradedAdvancedStats.join(','),
      },
      lastChecked: summary.lastChecked,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Player read-model health check failed'
          : error instanceof Error
            ? error.message
            : String(error),
      lastChecked: new Date().toISOString(),
    };
  }
}

async function checkRosterOwnership(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const summary = await getLeagueRosterOwnershipHealth();
    return {
      status: summary.status,
      responseTime: Date.now() - start,
      error:
        summary.status === 'healthy'
          ? undefined
          : `Roster ownership drift detected: missingMembers=${summary.leaguesWithMissingMembers}, duplicatePlayers=${summary.leaguesWithDuplicatePlayers}, orphanedRows=${summary.leaguesWithOrphanedRows}, activeEmptyMembers=${summary.activeLeaguesWithEmptyMembers}`,
      details: {
        checkedLeagues: summary.checkedLeagues,
        leaguesWithMissingMembers: summary.leaguesWithMissingMembers,
        leaguesWithDuplicatePlayers: summary.leaguesWithDuplicatePlayers,
        leaguesWithOrphanedRows: summary.leaguesWithOrphanedRows,
        activeLeaguesWithEmptyMembers: summary.activeLeaguesWithEmptyMembers,
      },
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Roster ownership health check failed'
          : error instanceof Error
            ? error.message
            : String(error),
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
    status = 'unhealthy';
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
    const [database, memory, rosterOwnership, playerReadModels, redis, metricsCheck] =
      await Promise.all([
        checkDatabase(),
        Promise.resolve(checkMemory()),
        checkRosterOwnership(),
        checkPlayerReadModels(),
        checkRedis(),
        checkMetrics(),
      ]);

    // Collect application metrics
    const metrics = await metricsCollector.collectAllMetrics(startTime);

    const services = {
      database,
      memory,
      rosterOwnership,
      playerReadModels,
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
    const criticalServices = [database, redis, metricsCheck];
    const isReady = criticalServices.every((service) => service.status === 'healthy');

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
