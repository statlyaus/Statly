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
  pickClock: number,
  immediateStart: boolean = false
): Promise<void> {
  // Remove any existing job for this league before scheduling a new one
  await draftQueue.remove(leagueId).catch(() => undefined);

  if (immediateStart) {
    // Lobby is already open, schedule the actual draft start
    const delay = Math.max(0, startAt.getTime() - Date.now());
    await draftQueue.add('start-draft', { leagueId, pickClock }, { delay, jobId: `${leagueId}-start` });
  } else {
    // Schedule lobby to open 5 minutes before draft start
    const lobbyOpenTime = new Date(startAt.getTime() - 5 * 60 * 1000); // 5 minutes before
    const delay = Math.max(0, lobbyOpenTime.getTime() - Date.now());

    // Schedule the lobby opening (which will then schedule the actual draft start)
    await draftQueue.add('start', { leagueId, pickClock }, { delay, jobId: leagueId });
  }
}
