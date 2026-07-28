import { logger } from '@/lib/logger';

import { EnhancedDraftWorker } from './enhancedDraftWorker';
import { ScalableRedisConnection } from '../realtime/scalableConnection';

interface WorkerPoolConfig {
  workerCount: number;
  gracefulShutdownTimeout: number;
  healthCheckInterval: number;
  healthCheckInactivityMs?: number;
  handleSignals?: boolean;
}

class WorkerPool {
  private workers: Map<string, EnhancedDraftWorker> = new Map();
  private config: WorkerPoolConfig;
  private shutdownInProgress = false;
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  constructor(config: WorkerPoolConfig) {
    this.config = config;
    if (config.handleSignals) this.setupGracefulShutdown();
  }

  async start(): Promise<void> {
    logger.info(`Starting worker pool with ${this.config.workerCount} workers`);

    // Ensure Redis is healthy before starting workers
    const redisConnection = ScalableRedisConnection.getInstance();
    const healthStatus = await redisConnection.forceHealthCheck();
    if (!healthStatus.isHealthy) {
      throw new Error(`Redis connection unhealthy: ${healthStatus.error}`);
    }

    for (let i = 0; i < this.config.workerCount; i++) {
      const workerId = `draft-worker-${process.pid}-${i + 1}`;
      const worker = new EnhancedDraftWorker(workerId);
      await worker.start();
      this.workers.set(workerId, worker);
      logger.info(`Started worker: ${workerId}`);
    }

    this.startHealthMonitoring();
    logger.info(`Worker pool started with ${this.workers.size} workers`);
  }

  async stop(): Promise<void> {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;

    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      await Promise.all(
        Array.from(this.workers.values()).map((w) => this.shutdownWorkerWithTimeout(w))
      );
      this.workers.clear();
      await ScalableRedisConnection.shutdownInstance();
      logger.info('Worker pool stopped');
    } finally {
      this.shutdownInProgress = false;
    }
  }

  async addWorker(): Promise<string> {
    if (this.shutdownInProgress) throw new Error('Cannot add worker during shutdown');
    const workerId = `draft-worker-${process.pid}-${Date.now()}`;
    const worker = new EnhancedDraftWorker(workerId);
    await worker.start();
    this.workers.set(workerId, worker);
    logger.info(`Added worker: ${workerId}`);
    return workerId;
  }

  async removeWorker(workerId: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    await this.shutdownWorkerWithTimeout(worker);
    this.workers.delete(workerId);
    logger.info(`Removed worker: ${workerId}`);
    return true;
  }

  getPoolStats() {
    const workerStats = Array.from(this.workers.values()).map((w) => w.getMetrics());
    const totalJobs = workerStats.reduce((s, m) => s + (m.jobsProcessed || 0), 0);
    const totalFailures = workerStats.reduce((s, m) => s + (m.jobsFailed || 0), 0);
    const avgProcessingTime =
      workerStats.length > 0
        ? workerStats.reduce((s, m) => s + (m.averageProcessingTime || 0), 0) / workerStats.length
        : 0;
    const successRate = totalJobs > 0 ? ((totalJobs - totalFailures) / totalJobs) * 100 : 100;

    return {
      workerCount: this.workers.size,
      totalJobsProcessed: totalJobs,
      totalJobsFailed: totalFailures,
      averageProcessingTime: avgProcessingTime,
      successRate,
      workers: workerStats,
    };
  }

  async checkHealth(): Promise<{
    healthy: boolean;
    workers: Array<{
      id: string;
      healthy: boolean;
      status: 'ready' | 'idle' | 'error';
      error?: string;
    }>;
  }> {
    const checks = await Promise.all(
      Array.from(this.workers.entries()).map(async ([id, worker]) => {
        try {
          const metrics = worker.getMetrics();
          const threshold = this.config.healthCheckInactivityMs ?? 60000;
          const idle = Date.now() - metrics.lastActivity.getTime() >= threshold;
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
            status: idle ? ('idle' as const) : ('ready' as const),
          };
        } catch (e) {
          return {
            id,
            healthy: false,
            status: 'error' as const,
            error: e instanceof Error ? e.message : 'Unknown error',
          };
        }
      })
    );

    return { healthy: checks.every((c) => c.healthy), workers: checks };
  }

  private startHealthMonitoring() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        if (!health.healthy) {
          logger.warn('Worker pool health degraded', health);
        } else {
          const idleWorkers = health.workers.filter((worker) => worker.status === 'idle').length;
          if (idleWorkers > 0) {
            logger.debug('Worker pool healthy with idle workers', {
              workerCount: health.workers.length,
              idleWorkers,
            });
          }
        }
      } catch (e) {
        logger.error('Health check failed', e);
      }
    }, this.config.healthCheckInterval);
  }

  private async shutdownWorkerWithTimeout(worker: EnhancedDraftWorker) {
    const timeoutMs = this.config.gracefulShutdownTimeout;
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Worker shutdown timeout')), timeoutMs)
    );
    await Promise.race([worker.shutdown(), timeout]).catch((e) => {
      logger.error('Failed to shutdown worker gracefully', e);
    });
  }

  private setupGracefulShutdown() {
    const shutdown = () => {
      void this.stop()
        .then(() => process.exit(0))
        .catch((e) => {
          logger.error('Error during shutdown:', e);
          process.exit(1);
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

// Default configuration
const defaultConfig: WorkerPoolConfig = {
  workerCount: parseInt(process.env.DRAFT_WORKER_COUNT || '2') || 2,
  gracefulShutdownTimeout: parseInt(process.env.WORKER_SHUTDOWN_TIMEOUT || '30000') || 30000,
  healthCheckInterval: parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL || '30000') || 30000,
  healthCheckInactivityMs: parseInt(process.env.WORKER_HEALTH_INACTIVITY_MS || '60000') || 60000,
  handleSignals: true,
};

export const createWorkerPool = (config?: Partial<WorkerPoolConfig>) => {
  const finalConfig: WorkerPoolConfig = {
    ...defaultConfig,
    handleSignals: false,
    ...config,
  } as WorkerPoolConfig;
  return new WorkerPool(finalConfig);
};

let _workerPoolInstance: WorkerPool | null = null;
export const workerPool = {
  get instance() {
    if (!_workerPoolInstance) _workerPoolInstance = new WorkerPool(defaultConfig);
    return _workerPoolInstance;
  },
  getPoolStats: () => workerPool.instance.getPoolStats(),
  checkHealth: () => workerPool.instance.checkHealth(),
  start: () => workerPool.instance.start(),
  stop: () => workerPool.instance.stop(),
  addWorker: () => workerPool.instance.addWorker(),
  removeWorker: (workerId: string) => workerPool.instance.removeWorker(workerId),
};

export { WorkerPool, type WorkerPoolConfig };
