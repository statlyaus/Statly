import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import { logger } from './logger';
import { redisClient } from './redis';

/**
 * Fixed-window rate limiting with the counters in Redis, so every web instance shares one budget and
 * a restart does not reset it. See "Rate limits" in docs/architecture/data-platform.md.
 */

/** What a limiter does when Redis cannot count the request. */
export type RedisUnavailableBehaviour = 'fail-closed' | 'memory';

const REDIS_TIMEOUT_MS = 500;
const fallbackCounters = new Map<string, { count: number; expiresAt: number }>();
const lastUnavailableLogAt = new Map<RedisUnavailableBehaviour, number>();

class RateLimitStoreUnavailableError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function countInMemory(key: string, expiresAt: number, now: number): number {
  const current = fallbackCounters.get(key);
  const count = current && current.expiresAt > now ? current.count + 1 : 1;
  fallbackCounters.set(key, { count, expiresAt });
  if (fallbackCounters.size > 10_000) {
    for (const [counterKey, value] of fallbackCounters) {
      if (value.expiresAt <= now) fallbackCounters.delete(counterKey);
    }
  }
  return count;
}

/**
 * Counts one hit against `key` in the current fixed window and returns the count including this hit.
 * Redis INCR + EXPIRE in one MULTI is the shared counter. When Redis is missing, reconnecting,
 * errors, or takes longer than 500 ms, `'memory'` counts in this process instead and `'fail-closed'`
 * throws {@link RateLimitStoreUnavailableError}.
 */
export async function countRateLimitHit({
  key,
  windowSeconds,
  whenRedisUnavailable,
}: {
  key: string;
  windowSeconds: number;
  whenRedisUnavailable: RedisUnavailableBehaviour;
}): Promise<{ count: number; resetAt: number }> {
  const now = Date.now();
  const windowMs = windowSeconds * 1_000;
  const bucket = Math.floor(now / windowMs);
  const bucketKey = `${key}:${bucket}`;
  const resetAt = (bucket + 1) * windowMs;
  const redis = redisClient.getClient();

  let failure = 'Redis client is not configured';
  // A client that is reconnecting or closed would only queue the command until the timeout.
  if (redis?.status === 'reconnecting' || redis?.status === 'end') {
    failure = `Redis client is ${redis.status}`;
  } else if (redis) {
    try {
      const results = await withTimeout(
        redis
          .multi()
          .incr(bucketKey)
          .expire(bucketKey, windowSeconds + 1)
          .exec(),
        REDIS_TIMEOUT_MS
      );
      const [incrError, count] = results?.[0] ?? [new Error('MULTI returned no result'), 0];
      if (incrError) throw incrError;
      return { count: Number(count), resetAt };
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }

  // One log line per behaviour per minute, so an outage does not log every request.
  if (now - (lastUnavailableLogAt.get(whenRedisUnavailable) ?? 0) >= 60_000) {
    lastUnavailableLogAt.set(whenRedisUnavailable, now);
    const message =
      whenRedisUnavailable === 'fail-closed'
        ? 'Rate limit store unavailable; rejecting requests'
        : 'Rate limit store unavailable; counting in this process only';
    logger.warn(message, { key, error: failure });
  }
  if (whenRedisUnavailable === 'fail-closed') {
    throw new RateLimitStoreUnavailableError(failure);
  }
  return { count: countInMemory(bucketKey, resetAt, now), resetAt };
}

/**
 * The caller's IP, read only from headers a trusted proxy wrote.
 *
 * On Netlify (`NETLIFY=true`) the edge sets `x-nf-client-connection-ip` and overwrites any client
 * value. Elsewhere each proxy appends the address it received the request from to
 * `x-forwarded-for`, so with `RATE_LIMIT_TRUSTED_PROXY_COUNT` (default 1) trusted proxies the
 * client is that many entries from the right. Everything to the left of it is client-written and
 * ignored. Returns null when no trustworthy, well-formed IP is present.
 */
export function getTrustedClientIp(
  headers: Pick<Headers, 'get'>,
  env: Readonly<Record<string, string | undefined>> = process.env
): string | null {
  if (env.NETLIFY === 'true') {
    const netlifyIp = headers.get('x-nf-client-connection-ip')?.trim();
    if (netlifyIp && isIP(netlifyIp)) return netlifyIp;
  }

  const configured = Number.parseInt(env.RATE_LIMIT_TRUSTED_PROXY_COUNT ?? '', 10);
  const trustedProxyCount = Number.isInteger(configured) && configured >= 0 ? configured : 1;
  if (trustedProxyCount === 0) return null;

  const hops = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  // Fewer hops than trusted proxies means the request skipped a proxy; nothing in it is trustworthy.
  if (hops.length < trustedProxyCount) return null;
  const clientIp = hops[hops.length - trustedProxyCount];
  return isIP(clientIp) ? clientIp : null;
}

interface RateLimitOptions {
  /** Namespaces the counter so configs never share a budget. */
  name: string;
  windowMs: number;
  maxRequests: number;
  /** Defaults to fail-closed. */
  whenRedisUnavailable?: RedisUnavailableBehaviour;
}

export type RateLimitCheck =
  | { allowed: boolean; resetTime: number; remaining: number }
  | { allowed: false; unavailable: true };

export function createRateLimit(options: RateLimitOptions) {
  const { name, windowMs, maxRequests, whenRedisUnavailable = 'fail-closed' } = options;
  const windowSeconds = Math.ceil(windowMs / 1_000);

  return {
    maxRequests,
    /** Counts this request. Keys by `userId` when given, otherwise by the trusted client IP. */
    check: async (
      req: NextRequest,
      identity: { userId?: string } = {}
    ): Promise<RateLimitCheck> => {
      const subject = identity.userId
        ? `user:${identity.userId}`
        : `ip:${getTrustedClientIp(req.headers) ?? 'unknown'}`;
      const key = `rate-limit:${name}:${subject}`;

      let result;
      try {
        result = await countRateLimitHit({ key, windowSeconds, whenRedisUnavailable });
      } catch (error) {
        if (error instanceof RateLimitStoreUnavailableError) {
          return { allowed: false, unavailable: true };
        }
        throw error;
      }

      const allowed = result.count <= maxRequests;
      if (!allowed) {
        logger.warn('Rate limit exceeded', {
          key,
          count: result.count,
          maxRequests,
          windowMs,
          userAgent: req.headers.get('user-agent'),
        });
      }
      return {
        allowed,
        resetTime: result.resetAt,
        remaining: Math.max(0, maxRequests - result.count),
      };
    },
  };
}

/**
 * Common rate limit configurations. Only `public` falls back to a per-process counter when Redis is
 * down: it guards anonymous reads, where availability matters more than an exact shared budget.
 * The others fail closed with 503.
 */
export const rateLimitConfigs = {
  // Strict rate limiting for authentication endpoints
  auth: createRateLimit({ name: 'auth', windowMs: 15 * 60 * 1000, maxRequests: 5 }),

  // Moderate rate limiting for API endpoints
  api: createRateLimit({ name: 'api', windowMs: 1 * 60 * 1000, maxRequests: 60 }),

  // Generous rate limiting for public data
  public: createRateLimit({
    name: 'public',
    windowMs: 1 * 60 * 1000,
    maxRequests: 100,
    whenRedisUnavailable: 'memory',
  }),

  // Very strict for heavy operations
  heavy: createRateLimit({ name: 'heavy', windowMs: 5 * 60 * 1000, maxRequests: 10 }),
};

/**
 * Rate limit guard factory. Await the returned function; pass `{ userId }` on authenticated routes
 * so the budget follows the user rather than the network address.
 */
export function withRateLimit(limiter: ReturnType<typeof createRateLimit>) {
  return async (req: NextRequest, identity?: { userId?: string }) => {
    const result = await limiter.check(req, identity);

    if ('unavailable' in result) {
      return {
        success: false as const,
        status: 503,
        headers: { 'Retry-After': '5' } as Record<string, string>,
        body: {
          success: false,
          error: {
            message: 'Service Unavailable',
            code: 'RATE_LIMIT_UNAVAILABLE',
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    if (!result.allowed) {
      return {
        success: false as const,
        status: 429,
        headers: {
          'X-RateLimit-Limit': limiter.maxRequests.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
          'Retry-After': Math.max(1, Math.ceil((result.resetTime - Date.now()) / 1000)).toString(),
        } as Record<string, string>,
        body: {
          success: false,
          error: {
            message: 'Too Many Requests',
            code: 'RATE_LIMIT_EXCEEDED',
            details: {
              limit: limiter.maxRequests,
              remaining: result.remaining,
              resetTime: new Date(result.resetTime).toISOString(),
            },
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    return { success: true as const, limiter };
  };
}
