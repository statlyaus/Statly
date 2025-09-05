import 'server-only';
import type { Job } from 'bullmq';
import { Worker, QueueEvents } from 'bullmq';
import { draftQueue, type DraftJobData } from '../queues/draftQueue';
import { ScalableRedisConnection } from '../queues/scalableConnection';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { DraftStatus } from '@prisma/client';
import { openDraftLobby, startDraftCountdown } from '@/lib/draftLobby';
import { getTransactionManager, draftTransactionPatterns } from '@/lib/transactionManager';

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
  private cleanupInterval?: NodeJS.Timeout;
  // Track whether the worker has been started to avoid duplicate intervals/cleanup jobs
  private started = false;
  // Track whether shutdown is in progress or has completed to make shutdown idempotent
  private isShuttingDown = false;

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

    logger.info('Enhanced Draft Worker initialized', {
      workerId,
      concurrency: this.worker.opts.concurrency,
    });
  }

  /**
   * Start the worker
   */
  public async start(): Promise<void> {
    if (this.started) {
      logger.info('Enhanced Draft Worker start called but worker is already started', {
        workerId: this.metrics.workerId,
      });
      return;
    }

    // Mark as started before creating intervals to avoid races where start is called twice
    this.started = true;
    this.startMetricsCollection();
    this.startCleanupJob();

    logger.info('Enhanced Draft Worker started', {
      workerId: this.metrics.workerId,
    });
  }

  private async processJob(job: Job<DraftJobData>): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('Processing draft job', {
        jobId: job.id,
        jobName: job.name,
        leagueId: job.data.leagueId,
        workerId: this.metrics.workerId,
      });

      switch (job.name) {
        case 'start':
          await this.openLobby(job);
          break;
        case 'start-draft':
          await this.startDraft(job);
          break;
        case 'auto-pick':
          await this.advancePick(job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateMetrics(processingTime, false);

      logger.info('Draft job completed successfully', {
        jobId: job.id,
        processingTime,
        workerId: this.metrics.workerId,
      });
    } catch (error) {
      this.updateMetrics(Date.now() - startTime, true);
      logger.error('Draft job failed', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
        workerId: this.metrics.workerId,
      });
      throw error;
    }
  }

  private async openLobby(job: Job<DraftJobData>): Promise<void> {
    const { leagueId, pickClock } = job.data;
    const transactionManager = getTransactionManager(prisma);

    const result = await transactionManager.executeTransaction(async (tx) => {
      // Find the draft for this league
      const draft = await tx.draft.findFirst({
        where: {
          leagueId,
          status: DraftStatus.SCHEDULED,
        },
      });

      if (!draft) {
        logger.warn(`No scheduled draft found for league ${leagueId}`, {
          leagueId,
          jobId: job.id,
          workerId: this.metrics.workerId,
        });
        return null;
      }

      // Open the lobby (5 minutes before draft)
      await openDraftLobby(draft.id);
      await startDraftCountdown(draft.id);

      return draft;
    });

    if (!result.success) {
      throw new Error(`Failed to open lobby: ${result.error}`);
    }

    if (result.data) {
      // Schedule the actual draft start (5 minutes from now)
      await draftQueue.add(
        'start-draft',
        { leagueId, pickClock },
        {
          delay: 5 * 60 * 1000,
          jobId: `${leagueId}-start`,
          attempts: Number(process.env.DRAFT_JOB_ATTEMPTS || '3'),
          backoff: {
            type: 'exponential',
            delay: Number(process.env.DRAFT_JOB_BACKOFF_MS || '2000'),
          },
        }
      );

      logger.info(`Draft lobby opened for league ${leagueId}`, {
        leagueId,
        draftId: result.data.id,
        jobId: job.id,
        workerId: this.metrics.workerId,
      });
    }
  }

  private async startDraft(job: Job<DraftJobData>): Promise<void> {
    const { leagueId, pickClock } = job.data;
    const transactionManager = getTransactionManager(prisma);

    const result = await transactionManager.executeTransaction(async (tx) => {
      // Find the draft for this league
      const draft = await tx.draft.findFirst({
        where: {
          leagueId,
          lobbyStatus: 'COUNTDOWN',
        },
      });

      if (!draft) {
        logger.warn(`No draft in countdown found for league ${leagueId}`, {
          leagueId,
          jobId: job.id,
          workerId: this.metrics.workerId,
        });
        return null;
      }

      // Update draft status to LIVE and set start time using transaction patterns
      await draftTransactionPatterns.updateDraftState(tx, draft.id, DraftStatus.LIVE, {
        lobbyStatus: 'LIVE',
        startedAt: new Date(),
      });

      return draft;
    });

    if (!result.success) {
      throw new Error(`Failed to start draft: ${result.error}`);
    }

    if (result.data) {
      // Start the first pick timer
      await draftQueue.add(
        'auto-pick',
        { leagueId, pickClock },
        {
          delay: pickClock,
          jobId: `${leagueId}-pick-1`,
          attempts: Number(process.env.DRAFT_JOB_ATTEMPTS || '3'),
          backoff: {
            type: 'exponential',
            delay: Number(process.env.DRAFT_JOB_BACKOFF_MS || '2000'),
          },
        }
      );

      logger.info(`Draft started for league ${leagueId}`, {
        leagueId,
        draftId: result.data.id,
        jobId: job.id,
        jobName: job.name,
        pickClock,
        workerId: this.metrics.workerId,
      });
    }
  }

  private async advancePick(job: Job<DraftJobData>): Promise<void> {
    const { leagueId, pickClock } = job.data;

    logger.info(`Advancing pick for league ${leagueId} via job ${job.name}`, {
      leagueId,
      jobId: job.id,
      jobName: job.name,
      pickClock,
      workerId: this.metrics.workerId,
    });

    const transactionManager = getTransactionManager(prisma);

    // Attempt an atomic claim for the next pick via DB-side schedulingVersion
    type ClaimResult = Awaited<ReturnType<typeof draftTransactionPatterns.claimNextPick>>;
    const claimResult = await transactionManager.executeTransaction<ClaimResult>(async (tx) => {
      return await draftTransactionPatterns.claimNextPick(tx, leagueId);
    });

    if (!claimResult.success) {
      throw new Error(`Failed to advance pick: ${claimResult.error}`);
    }

    const claimData = claimResult.data;
    if (!claimData?.claimed) {
      logger.info(`No pick claimed for league ${leagueId} (another worker likely claimed it)`, {
        leagueId,
        workerId: this.metrics.workerId,
      });
      return;
    }

    const nextPickNumber = claimData.nextPickNumber!;
    const jobId = `${leagueId}-pick-${nextPickNumber}`;

    try {
      await draftQueue.add(
        'auto-pick',
        { leagueId, pickClock },
        {
          delay: pickClock,
          jobId,
          attempts: Number(process.env.DRAFT_JOB_ATTEMPTS || '3'),
          backoff: {
            type: 'exponential',
            delay: Number(process.env.DRAFT_JOB_BACKOFF_MS || '2000'),
          },
        }
      );

      logger.info(`Next pick scheduled for league ${leagueId}`, {
        leagueId,
        nextPickNumber,
        jobId,
        delay: pickClock,
        workerId: this.metrics.workerId,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Job with id')) {
        logger.info(`Pick ${nextPickNumber} already scheduled by another worker`, {
          leagueId,
          nextPickNumber,
          jobId,
          workerId: this.metrics.workerId,
        });
      } else {
        logger.error(`Failed to schedule next pick in queue`, {
          leagueId,
          nextPickNumber,
          jobId,
          error: error instanceof Error ? error.message : String(error),
          workerId: this.metrics.workerId,
        });
        throw error;
      }
    }
  }

  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job<DraftJobData>) => {
      logger.debug('Job completed', {
        jobId: job.id,
        workerId: this.metrics.workerId,
      });
    });

    this.worker.on('failed', (job: Job<DraftJobData> | undefined, err: Error) => {
      logger.error(`Job ${job?.id ?? 'unknown'} failed`, {
        error: err.message,
        stack: err.stack,
        jobId: job?.id,
        jobName: job?.name,
        leagueId: job?.data?.leagueId,
        workerId: this.metrics.workerId,
      });

      // Previously we had manual retry logic here; rely on BullMQ attempts/backoff instead
      // No manual re-queueing: BullMQ will handle retry attempts/backoff configured when jobs are added
    });

    this.worker.on('stalled', (jobId: string) => {
      logger.warn('Job stalled', {
        jobId,
        workerId: this.metrics.workerId,
      });
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Queue event: Job failed', {
        jobId,
        failedReason,
        workerId: this.metrics.workerId,
      });
    });
  }

  private shouldRetryJob(_error: Error): boolean {
    // Kept for compatibility but not used: rely on BullMQ attempts/backoff
    return false;
  }

  private updateMetrics(processingTime: number, failed: boolean): void {
    this.metrics.lastActivity = new Date();

    if (failed) {
      this.metrics.jobsFailed++;
    } else {
      this.metrics.jobsProcessed++;

      // Update average processing time
      const totalJobs = this.metrics.jobsProcessed;
      this.metrics.averageProcessingTime =
        (this.metrics.averageProcessingTime * (totalJobs - 1) + processingTime) / totalJobs;
    }
  }

  private startMetricsCollection(): void {
    setInterval(
      () => {
        logger.info('Worker metrics', {
          ...this.metrics,
          timestamp: new Date().toISOString(),
        });
      },
      5 * 60 * 1000
    ); // Every 5 minutes
  }

  private startCleanupJob(): void {
    // Clean up completed jobs every hour
    this.cleanupInterval = setInterval(
      () => {
        void (async () => {
          try {
            await draftQueue.clean(24 * 60 * 60 * 1000, 100); // Clean jobs older than 24 hours
            logger.info('Queue cleanup completed', {
              workerId: this.metrics.workerId,
            });
          } catch (error) {
            logger.error('Queue cleanup failed', {
              error: error instanceof Error ? error.message : String(error),
              workerId: this.metrics.workerId,
            });
          }
        })();
      },
      60 * 60 * 1000
    );
  }

  public getMetrics(): WorkerMetrics {
    return { ...this.metrics };
  }

  public async shutdown(): Promise<void> {
    // If shutdown already started or completed, return early
    if (this.isShuttingDown) {
      logger.info('Shutdown already in progress or completed for Enhanced Draft Worker', {
        workerId: this.metrics.workerId,
      });
      return;
    }

    this.isShuttingDown = true; // mark shutdown started

    logger.info('Shutting down Enhanced Draft Worker', {
      workerId: this.metrics.workerId,
    });

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    try {
      await Promise.all([this.worker.close(), this.queueEvents.close()]);
    } catch (err) {
      logger.warn('Error while closing worker or queue events during shutdown', {
        error: err instanceof Error ? err.message : String(err),
        workerId: this.metrics.workerId,
      });
    }

    // Mark worker as not started so it can be restarted later
    this.started = false;

    logger.info('Enhanced Draft Worker shutdown complete', {
      workerId: this.metrics.workerId,
    });
  }
}

// Create worker instance with unique ID
const workerId = `draft-worker-${process.pid}-${Date.now()}`;
export const enhancedDraftWorker = new EnhancedDraftWorker(workerId);

// Export the class for use in worker pool
export { EnhancedDraftWorker };

// Graceful shutdown handling
process.on('SIGTERM', () => {
  void enhancedDraftWorker.shutdown().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  void enhancedDraftWorker.shutdown().then(() => process.exit(0));
});

export default enhancedDraftWorker;