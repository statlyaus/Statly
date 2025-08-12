import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors } from '@/lib/apiResponse';
import { withRequestTracing } from '@/lib/requestTracing';
import { adminDb } from '@/lib/firebaseAdmin';

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceStatus;
    memory: ServiceStatus;
    // Add other services as needed
  };
  metrics?: {
    totalRequests?: number;
    activeConnections?: number;
    averageResponseTime?: number;
  };
}

interface ServiceStatus {
  status: 'healthy' | 'unhealthy';
  responseTime?: number;
  error?: string;
  lastChecked: string;
}

const startTime = Date.now();

async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    // Simple database connectivity check
    await adminDb.collection('_health').limit(1).get();
    return {
      status: 'healthy',
      responseTime: Date.now() - start,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      lastChecked: new Date().toISOString(),
    };
  }
}

function checkMemory(): ServiceStatus {
  const memUsage = process.memoryUsage();
  const totalMemoryMB = memUsage.heapTotal / 1024 / 1024;
  const usedMemoryMB = memUsage.heapUsed / 1024 / 1024;
  const memoryUsagePercent = (usedMemoryMB / totalMemoryMB) * 100;

  return {
    status: memoryUsagePercent < 90 ? 'healthy' : 'unhealthy',
    lastChecked: new Date().toISOString(),
    error: memoryUsagePercent >= 90 ? `High memory usage: ${memoryUsagePercent.toFixed(1)}%` : undefined,
  };
}

export async function GET(req: NextRequest) {
  const tracer = withRequestTracing(req, { endpoint: 'health' });
  
  try {
    const [database, memory] = await Promise.all([
      checkDatabase(),
      Promise.resolve(checkMemory()),
    ]);

    const services = { database, memory };
    
    // Determine overall status
    const hasUnhealthyService = Object.values(services).some(service => service.status === 'unhealthy');
    const status: HealthCheck['status'] = hasUnhealthyService ? 'unhealthy' : 'healthy';

    const healthCheck: HealthCheck = {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Date.now() - startTime,
      services,
    };

    const httpStatus = status === 'healthy' ? 200 : 503;
    
    tracer.complete(httpStatus, { 
      healthStatus: status,
      servicesChecked: Object.keys(services).length 
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
