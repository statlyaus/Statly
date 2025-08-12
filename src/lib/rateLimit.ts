import type { NextRequest } from 'next/server';
import { logger } from './logger';

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

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, RateLimitInfo>();

// Cleanup interval to remove expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, info] of rateLimitStore.entries()) {
    if (now - info.windowStart > 60 * 60 * 1000) { // Clean up entries older than 1 hour
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

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
    check: (req: NextRequest): { allowed: boolean; resetTime: number; remaining: number } => {
      const key = keyGenerator(req);
      const now = Date.now();
      
      let info = rateLimitStore.get(key);
      
      // Initialize or reset window if expired
      if (!info || (now - info.windowStart) >= windowMs) {
        info = {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          lastRequest: now,
          windowStart: now,
        };
        rateLimitStore.set(key, info);
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
        rateLimitStore.set(key, info);
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

    recordResult: (req: NextRequest, success: boolean): void => {
      if (skipSuccessfulRequests && success) return;
      if (skipFailedRequests && !success) return;

      const key = keyGenerator(req);
      const info = rateLimitStore.get(key);
      
      if (info) {
        if (success) {
          info.successfulRequests++;
        } else {
          info.failedRequests++;
        }
        rateLimitStore.set(key, info);
      }
    },

    // Get current status for a request
    getStatus: (req: NextRequest): RateLimitInfo | null => {
      const key = keyGenerator(req);
      return rateLimitStore.get(key) || null;
    },

    // Reset rate limit for a specific key (admin function)
    reset: (req: NextRequest): void => {
      const key = keyGenerator(req);
      rateLimitStore.delete(key);
      logger.info('Rate limit reset', { key });
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
  return (req: NextRequest) => {
    const result = limiter.check(req);
    
    if (!result.allowed) {
      return {
        success: false,
        status: 429,
        headers: {
          'X-RateLimit-Limit': limiter.getStatus(req)?.totalRequests.toString() || '0',
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
              limit: limiter.getStatus(req)?.totalRequests || 0,
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
