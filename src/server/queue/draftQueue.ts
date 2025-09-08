import 'server-only';
import { Queue } from 'bullmq';

import { PRE_START_DELAY_MS, DRAFT_JOB_OPTIONS } from '@/lib/constants/draft';
import { ScalableRedisConnection, getPublisherClient } from '@/server/realtime/scalableConnection';

export const DRAFT_QUEUE_NAME = 'draftQueue';

export interface DraftJobData {
  leagueId: string;
  pickClock: number; // milliseconds per pick
  draftId?: string;
}

// Sanitize job IDs by replacing ':' to meet BullMQ constraints
const sanitizeJobId = (id: string): string => id.replace(/:/g, '_');

// Lightweight noop queue for tests to avoid Redis usage
const testNoopQueue = {
  pause: async () => {},
  resume: async () => {},
  remove: async (_jobId: string) => 0,
  add: async () => ({ id: 'noop', name: 'noop' }),
} as unknown as Queue<DraftJobData>;

export const draftQueue: Queue<DraftJobData> =
  process.env.NODE_ENV === 'test'
    ? testNoopQueue
    : new Queue<DraftJobData>(DRAFT_QUEUE_NAME, {
        connection: getPublisherClient() ?? ScalableRedisConnection.getInstance().getPublisherClient(),
        defaultJobOptions: {
          removeOnComplete: { count: 0 },
          removeOnFail: { age: 24 * 3600, count: 1000 },
        },
      });

export async function scheduleDraftStart(
  leagueId: string,
  startAt: Date,
  pickClock: number,
  immediateStart = false
): Promise<void> {
  // Remove any existing jobs for this league before scheduling a new one
  const lobbyJobId = sanitizeJobId(leagueId);
  const startJobId = sanitizeJobId(`${leagueId}-start`);
  await Promise.allSettled([
    draftQueue.remove(lobbyJobId),
    draftQueue.remove(startJobId),
  ]);

  const now = Date.now();
  const startTs = startAt.getTime();
  if (startTs < now) {
    throw new Error(`Cannot schedule draft start in the past: ${startAt.toISOString()}`);
  }

  if (immediateStart) {
    // Lobby is already open; schedule the actual draft start at startAt
    const startDelay = Math.max(0, startTs - now);
    await draftQueue.add(
      'start-draft',
      { leagueId, pickClock },
      {
        delay: startDelay,
        jobId: startJobId,
        ...DRAFT_JOB_OPTIONS,
      }
    );
    return;
  }

  // Otherwise schedule lobby to open PRE_START_DELAY_MS before draft start
  const lobbyOpenTime = new Date(startTs - PRE_START_DELAY_MS);
  if (lobbyOpenTime.getTime() < now) {
    throw new Error(
      `Draft start time ${startAt.toISOString()} is too soon. Lobby would need to open in the past.`
    );
  }
  const lobbyDelay = Math.max(0, lobbyOpenTime.getTime() - now);

  await draftQueue.add(
    'start',
    { leagueId, pickClock },
    {
      delay: lobbyDelay,
      jobId: lobbyJobId,
      ...DRAFT_JOB_OPTIONS,
    }
  );
}
