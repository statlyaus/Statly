import { Queue } from 'bullmq';

import { PRE_START_DELAY_MS, DRAFT_JOB_OPTIONS } from '@/lib/constants/draft';
import { ScalableRedisConnection, getPublisherClient } from '@/server/realtime/scalableConnection';

export const DRAFT_QUEUE_NAME = 'draftQueue';

export interface DraftStartJobData {
  kind: 'draft:start-lobby' | 'draft:start';
  leagueId: string;
  pickClock: number; // milliseconds per pick
  draftId?: string;
}

export interface DraftPickExpiryJobData {
  kind: 'draft:pick-expiry';
  draftId: string;
  leagueId: string;
  schedulingVersion: number;
}

export type DraftJobData = DraftStartJobData | DraftPickExpiryJobData;

// Sanitize job IDs by replacing ':' to meet BullMQ constraints
const sanitizeJobId = (id: string): string => id.replace(/:/g, '_');

export function getDraftStartJobId(leagueId: string) {
  return sanitizeJobId(`${leagueId}-start`);
}

export function getDraftLobbyJobId(leagueId: string) {
  return sanitizeJobId(leagueId);
}

export function getDraftPickExpiryJobId(draftId: string) {
  return sanitizeJobId(`${draftId}-pick-expiry`);
}

export function getDraftPickExpiryVersionedJobId(draftId: string, schedulingVersion: number) {
  return sanitizeJobId(`${draftId}-pick-expiry-v${schedulingVersion}`);
}

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
        connection:
          getPublisherClient() ?? ScalableRedisConnection.getInstance().getPublisherClient(),
        defaultJobOptions: {
          removeOnComplete: { count: 0 },
          removeOnFail: { age: 24 * 3600, count: 1000 },
        },
      });

async function removeDraftPickExpiryJobs(draftId: string): Promise<void> {
  const legacyJobId = getDraftPickExpiryJobId(draftId);
  await draftQueue.remove(legacyJobId).catch(() => 0);

  const jobs = await draftQueue.getJobs(
    ['delayed', 'waiting', 'active', 'prioritized'],
    0,
    200,
    true
  );
  const removals = jobs
    .filter((job) => {
      if (job.name !== 'draft:pick-expiry') {
        return false;
      }

      const data = job.data as Partial<DraftPickExpiryJobData> | undefined;
      return data?.draftId === draftId;
    })
    .map((job) => job.remove().catch(() => 0));

  if (removals.length > 0) {
    await Promise.allSettled(removals);
  }
}

export async function scheduleDraftStart(
  leagueId: string,
  startAt: Date,
  pickClock: number,
  immediateStart = false
): Promise<void> {
  // Remove any existing jobs for this league before scheduling a new one
  const lobbyJobId = sanitizeJobId(leagueId);
  const startJobId = getDraftStartJobId(leagueId);
  await Promise.allSettled([draftQueue.remove(lobbyJobId), draftQueue.remove(startJobId)]);

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
      { kind: 'draft:start', leagueId, pickClock },
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
    { kind: 'draft:start-lobby', leagueId, pickClock },
    {
      delay: lobbyDelay,
      jobId: lobbyJobId,
      ...DRAFT_JOB_OPTIONS,
    }
  );
}

export async function scheduleDraftPickExpiry(
  input: DraftPickExpiryJobData,
  runAt: Date
): Promise<void> {
  await removeDraftPickExpiryJobs(input.draftId);

  const delay = Math.max(0, runAt.getTime() - Date.now());
  await draftQueue.add('draft:pick-expiry', input, {
    delay,
    jobId: getDraftPickExpiryVersionedJobId(input.draftId, input.schedulingVersion),
    ...DRAFT_JOB_OPTIONS,
  });
}

export async function cancelDraftPickExpiry(draftId: string): Promise<void> {
  await removeDraftPickExpiryJobs(draftId);
}
