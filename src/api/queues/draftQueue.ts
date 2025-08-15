import { Queue } from 'bullmq';
import redisConnection from './connection';

export interface DraftJobData {
  leagueId: string;
  pickClock: number; // milliseconds
}

const noopQueue = {
  pause: async () => {},
  resume: async () => {},
  remove: async () => {},
  add: async () => {},
} as unknown as Queue<DraftJobData>;

export const draftQueue =
  process.env.NODE_ENV === 'test'
    ? noopQueue
    : new Queue<DraftJobData>('draftQueue', { connection: redisConnection });

export async function scheduleDraftStart(
  leagueId: string,
  startAt: Date,
  pickClock: number
): Promise<void> {
  const delay = Math.max(0, startAt.getTime() - Date.now());
  // Remove any existing job for this league before scheduling a new one
  await draftQueue.remove(leagueId).catch(() => undefined);
  await draftQueue.add('start', { leagueId, pickClock }, { delay, jobId: leagueId });
}
