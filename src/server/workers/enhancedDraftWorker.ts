import 'server-only';
import { Worker, QueueEvents } from 'bullmq';

import { logger } from '@/lib/logger';

import { draftQueue, type DraftJobData } from '../queue/draftQueue';
import { ScalableRedisConnection } from '../realtime/scalableConnection';

import type { Job } from 'bullmq';

interface WorkerMetrics {
  jobsProcessed: number;
  jobsFailed: number;
  averageProcessingTime: number;
  lastActivity: Date;
  workerId: string;
}

class EnhancedDraftWorker {
  private worker: Worker<DraftJobData>;
  private queueEvents: QueueEvents;
  private metrics: WorkerMetrics;
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private started = false;

  constructor(workerId: string) {
    this.metrics = {
      jobsProcessed: 0,
      jobsFailed: 0,
      averageProcessingTime: 0,
      lastActivity: new Date(),
      workerId,
    };

    this.worker = new Worker<DraftJobData>('draftQueue', this.processJob.bind(this), {
      connection: ScalableRedisConnection.getInstance().getWorkerClient(),
      concurrency: Number(process.env.DRAFT_WORKER_CONCURRENCY) || 5,
      maxStalledCount: 3,
      stalledInterval: 30000,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    });

    this.queueEvents = new QueueEvents('draftQueue', {
      connection: ScalableRedisConnection.getInstance().getQueueEventsClient(),
    });

    this.setupEventHandlers();
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.startCleanupJob();
    logger.info('Enhanced Draft Worker started', { workerId: this.metrics.workerId });
  }

  public getMetrics(): WorkerMetrics {
    return { ...this.metrics };
  }

  private async processJob(job: Job<DraftJobData>): Promise<void> {
    const start = Date.now();
    try {
      logger.info('Processing draft job', { jobId: job.id, jobName: job.name });
      // TODO: implement job-specific logic as needed
    } catch (error) {
      this.updateMetrics(Date.now() - start, true);
      logger.error('Draft job failed', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    this.updateMetrics(Date.now() - start, false);
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job<DraftJobData>) => {
      logger.debug('Job completed', { jobId: job.id, workerId: this.metrics.workerId });
    });

    this.worker.on('failed', (job: Job<DraftJobData> | undefined, err: Error) => {
      logger.error(`Job ${job?.id ?? 'unknown'} failed`, { error: err.message, stack: err.stack });
    });

    this.worker.on('stalled', (jobId: string) => {
      logger.warn('Job stalled', { jobId, workerId: this.metrics.workerId });
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Queue event failed', { jobId, failedReason });
    });
  }

  private updateMetrics(processingTime: number, failed: boolean): void {
    this.metrics.lastActivity = new Date();
    if (failed) {
      this.metrics.jobsFailed++;
    } else {
      this.metrics.jobsProcessed++;
      const n = this.metrics.jobsProcessed;
      this.metrics.averageProcessingTime =
        n === 1 ? processingTime : (this.metrics.averageProcessingTime * (n - 1) + processingTime) / n;
    }
  }

  private startCleanupJob(): void {
    this.cleanupInterval = setInterval(() => {
      void (async () => {
        try {
          await draftQueue.clean(24 * 60 * 60 * 1000, 100);
          logger.info('Queue cleanup completed', { workerId: this.metrics.workerId });
        } catch (error) {
          logger.error('Queue cleanup failed', {
            error: error instanceof Error ? error.message : String(error),
            workerId: this.metrics.workerId,
          });
        }
      })();
    }, 60 * 60 * 1000);
  }

  public async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    await Promise.all([this.worker.close(), this.queueEvents.close()]).catch((err) => {
      logger.warn('Error during worker shutdown', { error: err instanceof Error ? err.message : String(err) });
    });
    this.started = false;
    logger.info('Enhanced Draft Worker shutdown complete', { workerId: this.metrics.workerId });
  }
}

export { EnhancedDraftWorker };
