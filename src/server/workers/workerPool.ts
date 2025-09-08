import 'server-only';
// Use NodeJS.Timeout type from global namespace

import { logger } from '@/lib/logger';

import { EnhancedDraftWorker } from './enhancedDraftWorker';
import { ScalableRedisConnection } from '../realtime/scalableConnection';


interface WorkerPoolConfig {
  workerCount: number;
  gracefulShutdownTimeout: number;
  healthCheckInterval: number;
  // Maximum allowed inactivity (ms) before a worker is considered unhealthy
  healthCheckInactivityMs?: number;
  // Whether this instance should handle process signals (SIGTERM/SIGINT)
  // Only one instance per process should handle signals to avoid conflicts
  handleSignals?: boolean;
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

  // Static guard to ensure signal handlers are only registered once per process
  private static signalHandlersRegistered = false;
  // Static reference to the instance that should handle shutdown
  private static shutdownHandlerInstance: WorkerPool | null = null;

  constructor(config: WorkerPoolConfig) {
    this.config = config;
    // Only setup signal handling if explicitly requested and not already registered
    if (config.handleSignals && !WorkerPool.signalHandlersRegistered) {
      this.setupGracefulShutdown();
    }
  }

  /**
// --- around lines 45-46 in src/server/workers/workerPool.ts ---
      const workerId = `draft-worker-${process.pid}-${i + 1}-${Date.now()}`;
      const worker = new EnhancedDraftWorker(workerId);

// --- around line 136 in src/server/workers/workerPool.ts ---
    const workerId = `draft-worker-${process.pid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  async start(): Promise<void> {
    logger.info(`Starting worker pool with ${this.config.workerCount} workers`);

    // Ensure Redis connection is healthy before starting workers
    const redisConnection = ScalableRedisConnection.getInstance();
    const healthStatus = await redisConnection.getHealthStatus();

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
  getPoolStats() {
    const workerStats = Array.from(this.workers.values()).map((worker) => worker.getMetrics());

    const totalJobs = workerStats.reduce((sum, stats) => sum + (stats.jobsProcessed || 0), 0);
    const totalFailures = workerStats.reduce((sum, stats) => sum + (stats.jobsFailed || 0), 0);
    const avgProcessingTime =
      workerStats.length > 0
        ? workerStats.reduce((sum, stats) => sum + (stats.averageProcessingTime || 0), 0) /
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
      successRate: totalJobs > 0
        ? Math.max(0, ((totalJobs - totalFailures) / totalJobs) * 100)
        : 100,

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
  async checkHealth(): Promise<{
    healthy: boolean;
    workers: Array<{ id: string; healthy: boolean; error?: string }>;
  }> {
    const workerHealthChecks = await Promise.all(
      Array.from(this.workers.entries()).map(async ([id, worker]) => {
        try {
          const metrics = worker.getMetrics();
          const inactivityThreshold = this.config.healthCheckInactivityMs ?? 60000; // default 1 minute
          const isHealthy = Date.now() - metrics.lastActivity.getTime() < inactivityThreshold;

          return {
            id,
            healthy: isHealthy,
            error: isHealthy ? undefined : 'Worker inactive',
          };
        } catch (error) {
          return {
            id,
            healthy: false,
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
            logger.warn('Worker pool health check failed:', health);

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
class WorkerPool {
  private workers: Map<string, EnhancedDraftWorker> = new Map();
  private config: WorkerPoolConfig;
  private static handlersRegistered = false;
  private shutdownInProgress = false;

  private setupGracefulShutdown(): void {
    if (WorkerPool.handlersRegistered) {
      return;
    }
    WorkerPool.handlersRegistered = true;

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

  // …rest of WorkerPool…
}
    }
  }

  /**
   * Setup graceful shutdown handlers
   * Only registers handlers once per process to avoid conflicts
   */
  private setupGracefulShutdown(): void {
    if (WorkerPool.signalHandlersRegistered) {
      logger.warn('Signal handlers already registered, skipping setup');
const defaultConfig: WorkerPoolConfig = {
  workerCount: parseInt(process.env.DRAFT_WORKER_COUNT || '2') || 2,
  gracefulShutdownTimeout: parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT || '30000') || 30000,
  healthCheckInterval: parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL || '30000') || 30000,
  healthCheckInactivityMs: parseInt(process.env.WORKER_HEALTH_INACTIVITY_MS || '60000') || 60000,
};
    WorkerPool.signalHandlersRegistered = true;

    const shutdown = () => {
      const instance = WorkerPool.shutdownHandlerInstance;
      if (!instance) {
        logger.error('No shutdown handler instance available');
        process.exit(1);
        return;
      }

      void instance.stop()
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
    
    logger.info('Signal handlers registered for graceful shutdown');
  }

  /**
   * Static method to manually trigger shutdown of the registered instance
   * Useful for external signal management
   */
  static async shutdown(): Promise<void> {
    const instance = WorkerPool.shutdownHandlerInstance;
    if (!instance) {
      logger.warn('No shutdown handler instance available');
      return;
    }
    
    await instance.stop();
  }

  /**
   * Static method to check if signal handlers are registered
   */
  static areSignalHandlersRegistered(): boolean {
    return WorkerPool.signalHandlersRegistered;
  }
}

// Default configuration
const defaultConfig: WorkerPoolConfig = {
  workerCount: parseInt(process.env.DRAFT_WORKER_COUNT || '2'),
  gracefulShutdownTimeout: parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT || '30000'),
  healthCheckInterval: parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL || '30000'),
  healthCheckInactivityMs: parseInt(process.env.WORKER_HEALTH_INACTIVITY_MS || '60000'),
  // Enable signal handling by default for the singleton instance
  handleSignals: true,
};

// Allow external config injection
// By default, additional instances don't handle signals to avoid conflicts
export const createWorkerPool = (config?: Partial<WorkerPoolConfig>) => {
  const finalConfig = { 
    ...defaultConfig, 
    handleSignals: false, // Don't handle signals by default for additional instances
    ...config 
  };
  return new WorkerPool(finalConfig);
};

// Lazy singleton instance
let _workerPoolInstance: WorkerPool | null = null;

export const workerPool = {
  get instance() {
    if (!_workerPoolInstance) {
      _workerPoolInstance = new WorkerPool(defaultConfig);
    }
    return _workerPoolInstance;
  },

  // Delegate methods to the singleton instance with arrow functions for proper `this` binding
  getPoolStats: () => {
    return workerPool.instance.getPoolStats();
  },

  checkHealth: async () => {
    return workerPool.instance.checkHealth();
  },

  start: async () => {
    return workerPool.instance.start();
  },

  stop: async () => {
    return workerPool.instance.stop();
  },

  addWorker: async () => {
    return workerPool.instance.addWorker();
  },

  removeWorker: async (workerId: string) => {
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
