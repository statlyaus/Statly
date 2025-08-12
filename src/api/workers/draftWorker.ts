import { Job, Worker } from 'bullmq';
import { draftQueue, type DraftJobData } from '../queues/draftQueue';
import redisConnection from '../queues/connection';

async function advancePick(job: Job<DraftJobData>): Promise<void> {
  const { leagueId, pickClock } = job.data;
  // In a real implementation we would update league state and select player
  // for now simply log and enqueue an auto-pick for the next selection
  console.log(`Advancing pick for league ${leagueId} via job ${job.name}`);
  await draftQueue.add('auto-pick', { leagueId, pickClock }, { delay: pickClock });
}

export const draftWorker = new Worker<DraftJobData>(
  'draftQueue',
  async (job) => {
    if (job.name === 'start') {
      await advancePick(job);
    } else if (job.name === 'auto-pick') {
      console.log(`Auto-picking for league ${job.data.leagueId}`);
      await advancePick(job);
    }
  },
  { connection: redisConnection },
);

draftWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id ?? 'unknown'} failed`, err);
});
