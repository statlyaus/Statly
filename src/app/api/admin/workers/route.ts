import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminForbiddenResponse, isAdminRequest } from '@/lib/adminAuth';
import { logger } from '@/lib/logger';

// Configurable delay (ms) to wait after stopping the pool before starting it again

// Lazy import to prevent initialization during build
async function getWorkerPool() {
  const { workerPool } = await import('@/server/workers/workerPool');
  return workerPool;
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return adminForbiddenResponse(request);

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    switch (action) {
      case 'stats': {
        const workerPool = await getWorkerPool();
        const stats = workerPool.getPoolStats();
        return NextResponse.json({
          success: true,
          data: stats,
        });
      }

      case 'health': {
        const workerPool = await getWorkerPool();
        const health = await workerPool.checkHealth();
        return NextResponse.json({
          success: true,
          data: health,
        });
      }

      default: {
        // Return both stats and health by default
        const workerPool = await getWorkerPool();
        const [poolStats, poolHealth] = await Promise.all([
          workerPool.getPoolStats(),
          workerPool.checkHealth(),
        ]);

        return NextResponse.json({
          success: true,
          data: {
            stats: poolStats,
            health: poolHealth,
          },
        });
      }
    }
  } catch (error) {
    logger.error('Error in worker pool API:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Workers are separate long-running processes (`npm run worker:start`). A web request cannot start,
 * stop or resize them: on serverless hosting the process freezes when the response is sent, so the
 * old actions reported success for workers that never ran.
 */
export function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return adminForbiddenResponse(request);

  return NextResponse.json(
    {
      success: false,
      error:
        'Workers run as separate processes and cannot be started or stopped from this route. Use npm run worker:start on the worker host.',
    },
    { status: 501 }
  );
}
