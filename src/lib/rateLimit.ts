import type { NextRequest } from 'next/server';

import { logger } from './logger';
import { getRedis } from '@/server/redis';

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (req: NextRequest) => string; // Custom key generator
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
}

interface RateLimitInfo {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastRequest: number;
  windowStart: number;
}

// In-memory store for rate limiting (fallback when Redis is unavailable)
const rateLimitStore = new Map<string, RateLimitInfo>();

// Check if Redis is available
async function isRedisAvailable(): Promise<boolean> {
  try {
    const redis = await getRedis();
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

// Get rate limit info from Redis or fallback to memory
async function getRateLimitInfo(key: string): Promise<RateLimitInfo | null> {
  if (await isRedisAvailable()) {
    try {
      const redis = await getRedis();
      const data = await redis.get(`rate_limit:${key}`);
      if (data) {
        return JSON.parse(data) as RateLimitInfo;
      }
      return null;
    } catch (error) {
      logger.warn('Redis rate limit read failed, falling back to memory', { error });
      // Fallback to memory
      return rateLimitStore.get(key) || null;
    }
  }
  // Fallback to memory
  return rateLimitStore.get(key) || null;
}

// Set rate limit info in Redis or fallback to memory
async function setRateLimitInfo(key: string, info: RateLimitInfo, windowMs: number): Promise<void> {
  if (await isRedisAvailable()) {
    try {
      const redis = await getRedis();
      // Store with expiration slightly longer than window to handle edge cases
      await redis.setEx(`rate_limit:${key}`, Math.ceil(windowMs / 1000) + 60, JSON.stringify(info));
      return;
    } catch (error) {
      logger.warn('Redis rate limit write failed, falling back to memory', { error });
      // Fallback to memory
      rateLimitStore.set(key, info);
      return;
    }
  }
  // Fallback to memory
  rateLimitStore.set(key, info);
}

// Cleanup interval to remove expired entries (memory only)
setInterval(
  () => {
    const now = Date.now();
    for (const [key, info] of rateLimitStore.entries()) {
      if (now - info.windowStart > 60 * 60 * 1000) {
        // Clean up entries older than 1 hour
        rateLimitStore.delete(key);
      }
    }
  },
  5 * 60 * 1000
); // Run cleanup every 5 minutes

/**
 * Default key generator based on IP address
 */
function defaultKeyGenerator(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : 'unknown';
  return `rate_limit:${ip}`;
}

/**
 * Rate limiter implementation
 */
export function createRateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = defaultKeyGenerator,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  return {
    check: async (req: NextRequest): Promise<{ allowed: boolean; resetTime: number; remaining: number }> => {
      const key = keyGenerator(req);
      const now = Date.now();

      let info = await getRateLimitInfo(key);

      // Initialize or reset window if expired
      if (!info || now - info.windowStart >= windowMs) {
        info = {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          lastRequest: now,
          windowStart: now,
        };
        await setRateLimitInfo(key, info, windowMs);
      }

      // Count requests based on configuration
      let requestsToCount = info.totalRequests;
      if (skipSuccessfulRequests && skipFailedRequests) {
        requestsToCount = 0; // Skip all requests (unusual case)
      } else if (skipSuccessfulRequests) {
        requestsToCount = info.failedRequests;
      } else if (skipFailedRequests) {
        requestsToCount = info.successfulRequests;
      }

      const allowed = requestsToCount < maxRequests;
      const resetTime = info.windowStart + windowMs;
      const remaining = Math.max(0, maxRequests - requestsToCount);

      if (allowed) {
        info.totalRequests++;
        info.lastRequest = now;
        await setRateLimitInfo(key, info, windowMs);
      } else {
        logger.warn('Rate limit exceeded', {
          key,
          requestsToCount,
          maxRequests,
          windowMs,
          ip: req.headers.get('x-forwarded-for') || 'unknown',
          userAgent: req.headers.get('user-agent'),
        });
      }

      return { allowed, resetTime, remaining };
    },

    recordResult: async (req: NextRequest, success: boolean): Promise<void> => {
      if (skipSuccessfulRequests && success) return;
      if (skipFailedRequests && !success) return;

      const key = keyGenerator(req);
      const info = await getRateLimitInfo(key);

      if (info) {
        if (success) {
          info.successfulRequests++;
        } else {
          info.failedRequests++;
        }
        await setRateLimitInfo(key, info, windowMs);
      }
    },

    // Get current status for a request
    getStatus: async (req: NextRequest): Promise<RateLimitInfo | null> => {
      const key = keyGenerator(req);
      return await getRateLimitInfo(key);
    },

    // Reset rate limit for a specific key (admin function)
    reset: async (req: NextRequest): Promise<void> => {
      const key = keyGenerator(req);
      if (await isRedisAvailable()) {
        try {
          const redis = await getRedis();
          await redis.del(`rate_limit:${key}`);
          logger.info('Rate limit reset (Redis)', { key });
          return;
        } catch (error) {
          logger.warn('Redis rate limit reset failed, falling back to memory', { error });
        }
      }
      rateLimitStore.delete(key);
      logger.info('Rate limit reset (memory)', { key });
    },
  };
}

/**
 * Common rate limit configurations
 */
export const rateLimitConfigs = {
  // Strict rate limiting for authentication endpoints
  auth: createRateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // 5 attempts per 15 minutes
  }),

  // Moderate rate limiting for API endpoints
  api: createRateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 60, // 60 requests per minute
  }),

  // Generous rate limiting for public data
  public: createRateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 100, // 100 requests per minute
  }),

  // Very strict for heavy operations
  heavy: createRateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 10, // 10 requests per 5 minutes
  }),
};

/**
 * Rate limit middleware factory
 */
export function withRateLimit(limiter: ReturnType<typeof createRateLimit>) {
  return async (req: NextRequest) => {
    const result = await limiter.check(req);

    if (!result.allowed) {
      const status = await limiter.getStatus(req);
      return {
        success: false,
        status: 429,
        headers: {
          'X-RateLimit-Limit': status?.totalRequests.toString() || '0',
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
          'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
        },
        body: {
          success: false,
          error: {
            message: 'Too Many Requests',
            code: 'RATE_LIMIT_EXCEEDED',
            details: {
              limit: status?.totalRequests || 0,
              remaining: result.remaining,
              resetTime: new Date(result.resetTime).toISOString(),
            },
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    return {
      success: true,
      limiter, // Return limiter for recordResult later
    };
  };
}
