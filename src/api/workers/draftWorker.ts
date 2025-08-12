import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { draftQueue, type DraftJobData } from '../queues/draftQueue';
import redisConnection from '../queues/connection';
import { logger } from '@/lib/logger';

async function advancePick(job: Job<DraftJobData>): Promise<void> {
  const { leagueId, pickClock } = job.data;
  // In a real implementation we would update league state and select player
  // for now simply log and enqueue an auto-pick for the next selection
  logger.info(`Advancing pick for league ${leagueId} via job ${job.name}`, {
    leagueId,
    jobId: job.id,
    jobName: job.name,
    pickClock
  });
  await draftQueue.add('auto-pick', { leagueId, pickClock }, { delay: pickClock });
}

export const draftWorker = new Worker<DraftJobData>(
  'draftQueue',
  async (job: Job<DraftJobData>) => {
    if (job.name === 'start') {
      await advancePick(job);
    } else if (job.name === 'auto-pick') {
      logger.info(`Auto-picking for league ${job.data.leagueId}`, {
        leagueId: job.data.leagueId,
        jobId: job.id
      });
      await advancePick(job);
    }
  },
  { connection: redisConnection },
);

draftWorker.on('failed', (job: Job<DraftJobData> | undefined, err: Error) => {
  logger.error(`Job ${job?.id ?? 'unknown'} failed`, err, {
    jobId: job?.id,
    jobName: job?.name,
    leagueId: job?.data?.leagueId
  });
});
