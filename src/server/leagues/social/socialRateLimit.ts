import 'server-only';

import { logger } from '@/lib/logger';
import { redisClient } from '@/lib/redis';

import { SocialError } from './socialErrors';

const fallbackCounters = new Map<string, { count: number; expiresAt: number }>();

export async function enforceSocialRateLimit({
  leagueId,
  userId,
  action,
  maxRequests,
  windowSeconds,
}: {
  leagueId: string;
  userId: string;
  action: string;
  maxRequests: number;
  windowSeconds: number;
}): Promise<void> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = `social-rate:${leagueId}:${userId}:${action}:${bucket}`;
  const redis = redisClient.getClient();

  if (redis) {
    try {
      const results = await redis
        .multi()
        .incr(key)
        .expire(key, windowSeconds + 1)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (count > maxRequests) {
        throw new SocialError('RATE_LIMITED', 'You are posting too quickly');
      }
      return;
    } catch (error) {
      if (error instanceof SocialError) throw error;
      logger.warn('Social Redis rate limit failed; using process fallback', {
        leagueId,
        userId,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const now = Date.now();
  const current = fallbackCounters.get(key);
  const counter =
    current && current.expiresAt > now
      ? { count: current.count + 1, expiresAt: current.expiresAt }
      : { count: 1, expiresAt: now + windowSeconds * 1_000 };
  fallbackCounters.set(key, counter);
  if (counter.count > maxRequests) {
    throw new SocialError('RATE_LIMITED', 'You are posting too quickly');
  }

  if (fallbackCounters.size > 10_000) {
    for (const [counterKey, value] of fallbackCounters) {
      if (value.expiresAt <= now) fallbackCounters.delete(counterKey);
    }
  }
}
