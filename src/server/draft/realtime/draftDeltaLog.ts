import { logger } from '@/lib/logger';
import { getRedis } from '@/server/redis';
import type { DraftRealtimeDelta } from '@/server/draft/domain/draftTypes';

export const DRAFT_DELTA_LOG_CAP = 500;
export const DRAFT_DELTA_LOG_TTL_SECONDS = 60 * 60;

type RedisSortedSetClient = {
  zAdd: (key: string, value: { score: number; value: string }) => Promise<unknown>;
  zRemRangeByRank: (key: string, start: number, stop: number) => Promise<unknown>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  zRangeByScore: (key: string, min: number, max: number | string) => Promise<string[]>;
};

export function draftDeltaLogKey(draftId: string): string {
  return `draft:${draftId}:events`;
}

export async function appendDraftDelta(draftId: string, delta: DraftRealtimeDelta): Promise<void> {
  try {
    const redis = (await getRedis()) as RedisSortedSetClient | null;
    if (!redis) return;

    const key = draftDeltaLogKey(draftId);
    await redis.zAdd(key, {
      score: delta.ts,
      value: JSON.stringify(delta),
    });
    await redis.zRemRangeByRank(key, 0, -(DRAFT_DELTA_LOG_CAP + 1));
    await redis.expire(key, DRAFT_DELTA_LOG_TTL_SECONDS);
  } catch (error) {
    logger.warn('Failed to append draft realtime delta for backfill', {
      draftId,
      eventId: delta.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getDraftDeltasSince(
  draftId: string,
  since: number
): Promise<DraftRealtimeDelta[]> {
  const redis = (await getRedis()) as RedisSortedSetClient | null;
  if (!redis) return [];

  const values = await redis.zRangeByScore(draftDeltaLogKey(draftId), since + 1, '+inf');
  return values
    .map((value) => {
      try {
        return JSON.parse(value) as DraftRealtimeDelta;
      } catch {
        return null;
      }
    })
    .filter((value): value is DraftRealtimeDelta => Boolean(value));
}
