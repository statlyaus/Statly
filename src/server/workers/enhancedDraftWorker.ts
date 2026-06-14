import { pathToFileURL } from 'node:url';

import { Worker, QueueEvents } from 'bullmq';

import { logger } from '@/lib/logger';
import { draftRepository } from '@/server/draft/repository/DraftRepository';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';
import { draftScheduler } from '@/server/draft/services/DraftScheduler';

import {
  draftQueue,
  getDraftStartJobId,
  type DraftJobData,
  type DraftPickExpiryJobData,
  type DraftStartJobData,
} from '../queue/draftQueue';
import { ScalableRedisConnection } from '../realtime/scalableConnection';

import type { Job } from 'bullmq';

interface WorkerMetrics {
  jobsProcessed: number;
  jobsFailed: number;
  averageProcessingTime: number;
  startedAt: Date;
  lastActivity: Date;
  ready: boolean;
  runtimeError?: string;
  lastErrorAt?: Date;
  workerId: string;
}

export async function reconcileLiveDraftPickExpiryJobs(): Promise<number> {
  const schedules = await draftRepository.transaction((tx) =>
    draftRepository.listLiveDraftPickExpirySchedules(tx)
  );

  let scheduledCount = 0;
  let repairedCount = 0;
  let skippedCount = 0;
  for (const schedule of schedules) {
    let pickDeadlineAt = schedule.pickDeadlineAt;
    let schedulingVersion = schedule.schedulingVersion;

    if (!pickDeadlineAt) {
      const pickStartedAt = schedule.pickStartedAt ?? schedule.startedAt ?? new Date();
      const repairedPickDeadlineAt = new Date(
        pickStartedAt.getTime() + schedule.pickSeconds * 1000
      );
      const updated = await draftRepository.transaction((tx) =>
        draftRepository.repairMissingLiveDraftPickDeadline(tx, {
          draftId: schedule.draftId,
          currentSchedulingVersion: schedule.schedulingVersion,
          pickStartedAt,
          pickDeadlineAt: repairedPickDeadlineAt,
        })
      );

      if (updated.count !== 1) {
        skippedCount++;
        logger.warn('Skipped live draft timer repair because draft state changed', {
          draftId: schedule.draftId,
        });
        continue;
      }

      repairedCount++;
      schedulingVersion += 1;
      pickDeadlineAt = repairedPickDeadlineAt;
    }

    if (!pickDeadlineAt) {
      skippedCount++;
      logger.warn('Skipped live draft timer reconciliation without a deadline', {
        draftId: schedule.draftId,
      });
      continue;
    }

    await draftScheduler.schedulePickExpiry({
      draftId: schedule.draftId,
      leagueId: schedule.leagueId,
      schedulingVersion,
      pickDeadlineAt,
    });
    scheduledCount++;
  }

  logger.info('Reconciled live draft pick expiry jobs', {
    scheduledCount,
    repairedCount,
    skippedCount,
  });
  return scheduledCount;
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
      startedAt: new Date(),
      lastActivity: new Date(),
      ready: false,
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
    await Promise.all([this.worker.waitUntilReady(), this.queueEvents.waitUntilReady()]);
    this.metrics.ready = true;
    this.metrics.runtimeError = undefined;
    this.metrics.lastErrorAt = undefined;
    await reconcileLiveDraftPickExpiryJobs();
    this.startCleanupJob();
    logger.info('Enhanced Draft Worker started', {
      workerId: this.metrics.workerId,
      concurrency: Number(process.env.DRAFT_WORKER_CONCURRENCY) || 5,
    });
  }

  public getMetrics(): WorkerMetrics {
    return { ...this.metrics };
  }

  private inferJobKind(job: Job<DraftJobData>): DraftJobData['kind'] | undefined {
    return (
      job.data.kind ??
      (job.name === 'start'
        ? 'draft:start-lobby'
        : job.name === 'start-draft'
          ? 'draft:start'
          : job.name === 'draft:pick-expiry'
            ? 'draft:pick-expiry'
            : undefined)
    );
  }

  private getStartJobData(
    job: Job<DraftJobData>,
    inferredKind: 'draft:start-lobby' | 'draft:start'
  ) {
    if ('leagueId' in job.data && 'pickClock' in job.data) {
      return job.data as DraftStartJobData;
    }

    throw new Error(`Invalid ${inferredKind} job payload`);
  }

  private getPickExpiryJobData(job: Job<DraftJobData>): DraftPickExpiryJobData {
    if ('draftId' in job.data && 'leagueId' in job.data && 'schedulingVersion' in job.data) {
      return job.data as DraftPickExpiryJobData;
    }

    throw new Error('Invalid draft:pick-expiry job payload');
  }

  private async processJob(job: Job<DraftJobData>): Promise<void> {
    const start = Date.now();
    try {
      logger.info('Processing draft job', { jobId: job.id, jobName: job.name });
      const inferredKind = this.inferJobKind(job);

      switch (inferredKind) {
        case 'draft:pick-expiry': {
          const { draftId, schedulingVersion } = this.getPickExpiryJobData(job);
          const aggregate = await draftRepository.transaction((tx) =>
            draftRepository.getDraftAggregate(tx, draftId)
          );

          if (!aggregate) {
            logger.warn('Skipping pick expiry for missing draft', { draftId });
            break;
          }

          if (aggregate.status !== 'LIVE') {
            logger.info('Skipping pick expiry for non-live draft', {
              draftId,
              status: aggregate.status,
            });
            break;
          }

          if (aggregate.schedulingVersion !== schedulingVersion) {
            logger.info('Skipping stale pick expiry job', {
              draftId,
              expectedSchedulingVersion: aggregate.schedulingVersion,
              jobSchedulingVersion: schedulingVersion,
            });
            break;
          }

          if (aggregate.pickDeadlineAt && aggregate.pickDeadlineAt.getTime() > Date.now()) {
            logger.info('Skipping early pick expiry job', {
              draftId,
              pickDeadlineAt: aggregate.pickDeadlineAt.toISOString(),
            });
            break;
          }

          const result = await draftApplicationService.autoPick({ draftId });
          await draftRealtimePublisher.publishCommandResult(result);
          break;
        }
        case 'draft:start-lobby': {
          const { leagueId, pickClock } = this.getStartJobData(job, inferredKind);
          const result = await draftApplicationService.openScheduledLobby({
            leagueId,
          });

          await draftRealtimePublisher.publishDraftState(result.draftId);

          if (result.data.scheduledStartAt) {
            const runAt = new Date(result.data.scheduledStartAt);
            const delay = Math.max(0, runAt.getTime() - Date.now());
            const jobId = getDraftStartJobId(leagueId);

            await draftQueue.remove(jobId).catch(() => 0);
            await draftQueue.add(
              'start-draft',
              {
                kind: 'draft:start',
                leagueId,
                pickClock,
                draftId: result.draftId,
              },
              {
                delay,
                jobId,
              }
            );
          }
          break;
        }
        case 'draft:start': {
          const { draftId, leagueId } = this.getStartJobData(job, inferredKind);
          const scheduledDraft =
            draftId ||
            (await draftRepository.transaction(async (tx) => {
              const draft = await draftRepository.findDraftScheduleByLeagueId(tx, leagueId);
              return draft?.id ?? null;
            }));

          if (!scheduledDraft) {
            logger.warn('Skipping scheduled draft start for missing draft', {
              leagueId,
              jobId: job.id,
            });
            break;
          }

          const aggregate = await draftRepository.transaction((tx) =>
            draftRepository.getDraftAggregate(tx, scheduledDraft)
          );

          if (!aggregate) {
            logger.warn('Skipping scheduled draft start for missing aggregate', {
              draftId: scheduledDraft,
              leagueId,
              jobId: job.id,
            });
            break;
          }

          if (aggregate.status !== 'SCHEDULED') {
            logger.info('Skipping scheduled draft start for non-scheduled draft', {
              draftId: scheduledDraft,
              leagueId,
              status: aggregate.status,
              jobId: job.id,
            });
            break;
          }

          const result = await draftApplicationService.startDraft({ draftId: scheduledDraft });
          await draftRealtimePublisher.publishCommandResult(result);
          break;
        }
        default:
          logger.warn('Unhandled draft job kind', {
            jobId: job.id,
            jobName: job.name,
            inferredKind,
            data: job.data,
          });
      }
    } catch (error) {
      this.updateMetrics(Date.now() - start, true);
      logger.error('Draft job failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.updateMetrics(Date.now() - start, false);
  }

  private setupEventHandlers(): void {
    this.worker.on('ready', () => {
      this.metrics.ready = true;
      this.metrics.runtimeError = undefined;
      this.metrics.lastErrorAt = undefined;
      logger.info('Worker connection ready', { workerId: this.metrics.workerId });
    });

    this.worker.on('error', (err: Error) => {
      this.metrics.ready = false;
      this.metrics.runtimeError = err.message;
      this.metrics.lastErrorAt = new Date();
      logger.error('Worker runtime error', {
        workerId: this.metrics.workerId,
        error: err.message,
        stack: err.stack,
      });
    });

    this.queueEvents.on('error', (err: Error) => {
      this.metrics.runtimeError = err.message;
      this.metrics.lastErrorAt = new Date();
      logger.error('Queue events runtime error', {
        workerId: this.metrics.workerId,
        error: err.message,
        stack: err.stack,
      });
    });

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
        n === 1
          ? processingTime
          : (this.metrics.averageProcessingTime * (n - 1) + processingTime) / n;
    }
  }

  private startCleanupJob(): void {
    this.cleanupInterval = setInterval(
      () => {
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
      },
      60 * 60 * 1000
    );
  }

  public async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    await Promise.all([this.worker.close(), this.queueEvents.close()]).catch((err) => {
      logger.warn('Error during worker shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    this.started = false;
    this.metrics.ready = false;
    logger.info('Enhanced Draft Worker shutdown complete', { workerId: this.metrics.workerId });
  }
}

function isDirectWorkerEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(entrypoint).href === import.meta.url);
}

async function shutdownDirectWorker(
  signal: NodeJS.Signals,
  worker: EnhancedDraftWorker
): Promise<void> {
  logger.info('Enhanced Draft Worker received shutdown signal', { signal });
  await worker.shutdown();
  process.exit(0);
}

if (isDirectWorkerEntrypoint()) {
  const directWorker = new EnhancedDraftWorker(`draft-worker-${process.pid}-${Date.now()}`);

  directWorker.start().catch((error) => {
    logger.error('Failed to start Enhanced Draft Worker process', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });

  process.once('SIGINT', () => {
    void shutdownDirectWorker('SIGINT', directWorker);
  });
  process.once('SIGTERM', () => {
    void shutdownDirectWorker('SIGTERM', directWorker);
  });
}

export { EnhancedDraftWorker };
