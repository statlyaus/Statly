import { Queue } from 'bullmq';

import { PRE_START_DELAY_MS, DRAFT_JOB_OPTIONS } from '@/lib/constants/draft';
import { ScalableRedisConnection, getPublisherClient } from '@/server/realtime/scalableConnection';

export const DRAFT_QUEUE_NAME = 'draftQueue';

export interface DraftStartJobData {
  kind: 'draft:start-lobby' | 'draft:start';
  // The draft is the job's identity. A league's next-season draft is a different draft, so its
  // start jobs never share an id with, or get removed by, an earlier draft's jobs.
  draftId: string;
  leagueId: string;
  pickClock: number; // milliseconds per pick
}

export interface DraftStartTarget {
  draftId: string;
  leagueId: string;
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

export function getDraftStartJobId(draftId: string) {
  return sanitizeJobId(`draft-${draftId}-start`);
}

export function getDraftLobbyJobId(draftId: string) {
  return sanitizeJobId(`draft-${draftId}-lobby`);
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
  { draftId, leagueId }: DraftStartTarget,
  startAt: Date,
  pickClock: number,
  immediateStart = false
): Promise<void> {
  // Replace this draft's own start jobs; another draft's jobs (even in the same league) are untouched
  const lobbyJobId = getDraftLobbyJobId(draftId);
  const startJobId = getDraftStartJobId(draftId);
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
      { kind: 'draft:start', draftId, leagueId, pickClock },
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
    { kind: 'draft:start-lobby', draftId, leagueId, pickClock },
    {
      delay: lobbyDelay,
      jobId: lobbyJobId,
      ...DRAFT_JOB_OPTIONS,
    }
  );
}

export async function cancelDraftStart(draftId: string): Promise<void> {
  await Promise.all([
    draftQueue.remove(getDraftLobbyJobId(draftId)),
    draftQueue.remove(getDraftStartJobId(draftId)),
  ]);
}

export async function scheduleDraftPickExpiry(
  input: DraftPickExpiryJobData,
  runAt: Date
): Promise<void> {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  await draftQueue.add('draft:pick-expiry', input, {
    delay,
    // Every persisted clock revision owns an immutable job identity. Older jobs are allowed to
    // wake and will fail the worker's persisted-version guard; they must never delete a newer job.
    jobId: getDraftPickExpiryVersionedJobId(input.draftId, input.schedulingVersion),
    ...DRAFT_JOB_OPTIONS,
  });
}

export async function cancelDraftPickExpiry(draftId: string): Promise<void> {
  await removeDraftPickExpiryJobs(draftId);
}
