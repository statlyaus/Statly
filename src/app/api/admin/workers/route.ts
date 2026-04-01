import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

// Configurable delay (ms) to wait after stopping the pool before starting it again
const WORKER_RESTART_DELAY_MS = Number(process.env.WORKER_RESTART_DELAY_MS) || 500;

// Lazy import to prevent initialization during build
async function getWorkerPool() {
  const { workerPool } = await import('@/server/workers/workerPool');
  return workerPool;
}

export async function GET(request: NextRequest) {
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, workerId } = body;

    switch (action) {
      case 'start': {
        const workerPool = await getWorkerPool();
        await workerPool.start();
        return NextResponse.json({
          success: true,
          message: 'Worker pool started successfully',
        });
      }

      case 'stop': {
        const workerPool = await getWorkerPool();
        await workerPool.stop();
        return NextResponse.json({
          success: true,
          message: 'Worker pool stopped successfully',
        });
      }

      case 'addWorker': {
        const workerPool = await getWorkerPool();
        const newWorkerId = await workerPool.addWorker();
        return NextResponse.json({
          success: true,
          data: { workerId: newWorkerId },
          message: 'Worker added successfully',
        });
      }

      case 'removeWorker': {
        if (!workerId) {
          return NextResponse.json(
            {
              success: false,
              error: 'Worker ID is required for removeWorker action',
            },
            { status: 400 }
          );
        }

        const workerPool = await getWorkerPool();
        const removed = await workerPool.removeWorker(workerId);
        if (!removed) {
          return NextResponse.json(
            {
              success: false,
              error: 'Worker not found',
            },
            { status: 404 }
          );
        }

        return NextResponse.json({
          success: true,
          message: 'Worker removed successfully',
        });
      }

      case 'restart': {
        const workerPool = await getWorkerPool();
        await workerPool.stop();
        // Wait a short time to allow resources and graceful shutdown handlers to complete
        await new Promise<void>((resolve) =>
          setTimeout(() => void resolve(), WORKER_RESTART_DELAY_MS)
        );
        await workerPool.start();
        return NextResponse.json({
          success: true,
          message: 'Worker pool restarted successfully',
        });
      }

      default:
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid action',
          },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('Error in worker pool management:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
