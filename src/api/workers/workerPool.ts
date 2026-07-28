import { EnhancedDraftWorker } from './enhancedDraftWorker';
import { logger } from '@/lib/logger';
import { ScalableRedisConnection } from '../queues/scalableConnection';

interface WorkerPoolConfig {
  workerCount: number;
  gracefulShutdownTimeout: number;
  healthCheckInterval: number;
  // Maximum allowed inactivity (ms) before a worker is considered unhealthy
  healthCheckInactivityMs?: number;
}

type WorkerMetrics = ReturnType<EnhancedDraftWorker['getMetrics']>;

interface WorkerPoolStats {
  workerCount: number;
  totalJobsProcessed: number;
  totalJobsFailed: number;
  averageProcessingTime: number;
  successRate: number;
  workers: WorkerMetrics[];
}

interface WorkerHealth {
  id: string;
  healthy: boolean;
  status: 'ready' | 'idle' | 'error';
  error?: string;
}

interface WorkerPoolHealth {
  healthy: boolean;
  workers: WorkerHealth[];
}

class WorkerPool {
  private workers: Map<string, EnhancedDraftWorker> = new Map();
  private config: WorkerPoolConfig;
  private shutdownInProgress = false;
  // Flag indicating the pool is stopping; used to cancel ongoing health checks
  private stopping = false;
  private healthCheckInterval?: NodeJS.Timeout;
  // Promise representing the currently running health check (if any)
  private currentHealthCheck?: Promise<void>;

  constructor(config: WorkerPoolConfig) {
    this.config = config;
    this.setupGracefulShutdown();
  }

  /**
   * Start the worker pool with specified number of workers
   */
  async start(): Promise<void> {
    logger.info(`Starting worker pool with ${this.config.workerCount} workers`);

    // Ensure Redis connection is healthy before starting workers
    const redisConnection = ScalableRedisConnection.getInstance();
    const healthStatus = await redisConnection.forceHealthCheck();

    if (!healthStatus.isHealthy) {
      throw new Error(`Redis connection unhealthy: ${healthStatus.error}`);
    }

    // Start workers
    for (let i = 0; i < this.config.workerCount; i++) {
      const workerId = `draft-worker-${process.pid}-${i + 1}`;
      const worker = new EnhancedDraftWorker(workerId);

      try {
        await worker.start();
        this.workers.set(workerId, worker);
        logger.info(`Started worker: ${workerId}`);
      } catch (error) {
        logger.error(`Failed to start worker ${workerId}:`, error);
        throw error;
      }
    }

    // Start health monitoring
    this.startHealthMonitoring();

    logger.info(`Worker pool started successfully with ${this.workers.size} workers`);
  }

  /**
   * Stop all workers gracefully
   */
  async stop(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.stopping = true; // signal the health checker to bail out
    logger.info('Initiating graceful worker pool shutdown...');

    // Stop health monitoring interval so no new checks start
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Wait for any currently running health check to finish
    if (this.currentHealthCheck) {
      try {
        await this.currentHealthCheck;
      } catch (err) {
        logger.warn('Health check threw during shutdown', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Shutdown workers in parallel with timeout
    const shutdownPromises = Array.from(this.workers.values()).map((worker) =>
      this.shutdownWorkerWithTimeout(worker)
    );

    await Promise.all(shutdownPromises);
    this.workers.clear();

    logger.info('Worker pool shutdown complete');
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): WorkerPoolStats {
    const workerStats = Array.from(this.workers.values()).map((worker) => worker.getMetrics());

    const totalJobs = workerStats.reduce((sum, stats) => sum + stats.jobsProcessed, 0);
    const totalFailures = workerStats.reduce((sum, stats) => sum + stats.jobsFailed, 0);
    const avgProcessingTime =
      workerStats.length > 0
        ? workerStats.reduce((sum, stats) => sum + stats.averageProcessingTime, 0) /
          workerStats.length
        : 0;

    return {
      workerCount: this.workers.size,
      totalJobsProcessed: totalJobs,
      totalJobsFailed: totalFailures,
      averageProcessingTime: avgProcessingTime,
      successRate: totalJobs > 0 ? ((totalJobs - totalFailures) / totalJobs) * 100 : 100,
      workers: workerStats,
    };
  }

  /**
   * Add a new worker to the pool
   */
  async addWorker(): Promise<string> {
    if (this.shutdownInProgress) {
      throw new Error('Cannot add worker during shutdown');
    }

    const workerId = `draft-worker-${process.pid}-${Date.now()}`;
    const worker = new EnhancedDraftWorker(workerId);

    await worker.start();
    this.workers.set(workerId, worker);

    logger.info(`Added new worker to pool: ${workerId}`);
    return workerId;
  }

  /**
   * Remove a worker from the pool
   */
  async removeWorker(workerId: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return false;
    }

    await this.shutdownWorkerWithTimeout(worker);
    this.workers.delete(workerId);

    logger.info(`Removed worker from pool: ${workerId}`);
    return true;
  }

  /**
   * Check health of all workers
   */
  async checkHealth(): Promise<WorkerPoolHealth> {
    const workerHealthChecks = await Promise.all(
      Array.from(this.workers.entries()).map(async ([id, worker]) => {
        try {
          const metrics = worker.getMetrics();
          const inactivityThreshold = this.config.healthCheckInactivityMs ?? 60000; // default 1 minute
          const isIdle = Date.now() - metrics.lastActivity.getTime() >= inactivityThreshold;

          if (!metrics.ready) {
            return {
              id,
              healthy: false,
              status: 'error' as const,
              error: metrics.runtimeError || 'Worker not ready',
            };
          }

          if (metrics.runtimeError) {
            return {
              id,
              healthy: false,
              status: 'error' as const,
              error: metrics.runtimeError,
            };
          }

          return {
            id,
            healthy: true,
            status: isIdle ? ('idle' as const) : ('ready' as const),
          };
        } catch (error) {
          return {
            id,
            healthy: false,
            status: 'error' as const,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    const allHealthy = workerHealthChecks.every((check) => check.healthy);

    return {
      healthy: allHealthy,
      workers: workerHealthChecks,
    };
  }

  /**
   * Start periodic health monitoring
   */
  private startHealthMonitoring(): void {
    // Reset stopping flag when enabling health monitoring
    this.stopping = false;
    this.healthCheckInterval = setInterval(() => {
      // If we're stopping, don't start a new check
      if (this.stopping) return;

      // Track current health check so shutdown can await it
      this.currentHealthCheck = (async () => {
        if (this.stopping) return;
        try {
          const health = await this.checkHealth();
          if (this.stopping) return;

          if (!health.healthy) {
            logger.warn('Worker pool health check failed:', {
              healthy: health.healthy,
              workers: health.workers,
            });

            // Attempt to restart unhealthy workers
            for (const workerHealth of health.workers) {
              if (this.stopping) break; // abort if stopping
              if (!workerHealth.healthy) {
                logger.info(`Attempting to restart unhealthy worker: ${workerHealth.id}`);

                try {
                  if (this.stopping) break;
                  await this.removeWorker(workerHealth.id);
                  if (this.stopping) break;
                  await this.addWorker();
                } catch (error) {
                  logger.error(`Failed to restart worker ${workerHealth.id}:`, error);
                }
              }
            }
          } else {
            const idleWorkers = health.workers.filter((worker) => worker.status === 'idle').length;
            if (idleWorkers > 0) {
              logger.debug('Worker pool healthy with idle workers', {
                workerCount: health.workers.length,
                idleWorkers,
              });
            }
          }
        } catch (error) {
          logger.error('Health check failed:', error);
        } finally {
          // Clear currentHealthCheck when done
          this.currentHealthCheck = undefined;
        }
      })();
    }, this.config.healthCheckInterval);
  }

  /**
   * Shutdown a worker with timeout
   */
  private async shutdownWorkerWithTimeout(worker: EnhancedDraftWorker): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Worker shutdown timeout')),
        this.config.gracefulShutdownTimeout
      );
    });

    try {
      await Promise.race([worker.shutdown(), timeoutPromise]);
    } catch (error) {
      logger.warn('Worker shutdown timeout, forcing termination:', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Force termination logic would go here if needed
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = () => {
      void this.stop()
        .then(() => {
          process.exit(0);
        })
        .catch((error) => {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

// Default configuration
const defaultConfig: WorkerPoolConfig = {
  workerCount: parseInt(process.env.DRAFT_WORKER_COUNT || '2'),
  gracefulShutdownTimeout: parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT || '30000'),
  healthCheckInterval: parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL || '30000'),
  healthCheckInactivityMs: parseInt(process.env.WORKER_HEALTH_INACTIVITY_MS || '60000'),
};

// Lazy singleton instance
let _workerPoolInstance: WorkerPool | null = null;

export const workerPool = {
  get instance(): WorkerPool {
    if (!_workerPoolInstance) {
      _workerPoolInstance = new WorkerPool(defaultConfig);
    }
    return _workerPoolInstance;
  },

  // Delegate methods to the singleton instance with arrow functions for proper `this` binding
  getPoolStats: (): WorkerPoolStats => {
    return workerPool.instance.getPoolStats();
  },

  checkHealth: async (): Promise<WorkerPoolHealth> => {
    return workerPool.instance.checkHealth();
  },

  start: async (): Promise<void> => {
    return workerPool.instance.start();
  },

  stop: async (): Promise<void> => {
    return workerPool.instance.stop();
  },

  addWorker: async (): Promise<string> => {
    return workerPool.instance.addWorker();
  },

  removeWorker: async (workerId: string): Promise<boolean> => {
    return workerPool.instance.removeWorker(workerId);
  },
};

// Start worker pool if this file is run directly (supports ESM and CJS entry checks)
const isEntryPoint = (() => {
  try {
    // ESM: import.meta.main is true when this module is the entrypoint
    if (
      typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { main?: boolean }).main === true
    ) {
      return true;
    }
  } catch {
    // ignore
  }

  try {
    // CommonJS: require.main === module
    if (
      typeof require !== 'undefined' &&
      (require as unknown as { main?: unknown }).main === module
    ) {
      return true;
    }
  } catch {
    // ignore
  }

  // Fallback: allow explicit opt-in via env var
  if (process.env.START_WORKER_POOL === 'true') return true;

  return false;
})();

if (isEntryPoint) {
  void workerPool.start().catch((error) => {
    logger.error('Failed to start worker pool:', error);
    process.exit(1);
  });
}

export { WorkerPool, type WorkerPoolConfig };
