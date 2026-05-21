import { describe, expect, it, vi } from 'vitest';

import { createSocketAllowRequestLimiter } from './socketioRateLimit';

function req(ip = '203.0.113.10') {
  return {
    headers: {
      'x-forwarded-for': `${ip}, 10.0.0.1`,
    },
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

function runAllowRequest(limiter: ReturnType<typeof createSocketAllowRequestLimiter>) {
  return new Promise<{ error: string | null; allowed: boolean }>((resolve) => {
    limiter(req(), (error, allowed) => {
      resolve({ error: error ?? null, allowed });
    });
  });
}

describe('createSocketAllowRequestLimiter', () => {
  it('uses Redis bucket totals when Redis is available', async () => {
    const redis = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      mget: vi.fn().mockResolvedValue(['1', '1']),
    };
    const limiter = createSocketAllowRequestLimiter({
      getRedisClient: () => redis,
      now: () => 20_000,
      env: {
        SOCKET_RATE_LIMIT_WINDOW_SEC: '20',
        SOCKET_RATE_LIMIT_SUB_BUCKET_SEC: '10',
        SOCKET_RATE_LIMIT_MAX: '2',
      },
    });

    await expect(runAllowRequest(limiter)).resolves.toEqual({
      error: null,
      allowed: true,
    });
    expect(redis.incr).toHaveBeenCalledWith('ratelimit:socketio:203.0.113.10:2');
    expect(redis.expire).toHaveBeenCalledWith('ratelimit:socketio:203.0.113.10:2', 20);
    expect(redis.mget).toHaveBeenCalledWith([
      'ratelimit:socketio:203.0.113.10:2',
      'ratelimit:socketio:203.0.113.10:1',
    ]);
  });

  it('falls back to an in-memory limiter when Redis is unavailable', async () => {
    const onRedisFallback = vi.fn();
    const onRateLimited = vi.fn();
    const limiter = createSocketAllowRequestLimiter({
      getRedisClient: () => null,
      now: vi
        .fn()
        .mockReturnValueOnce(10_000)
        .mockReturnValueOnce(10_001)
        .mockReturnValueOnce(10_002),
      env: {
        SOCKET_RATE_LIMIT_WINDOW_SEC: '60',
        SOCKET_RATE_LIMIT_SUB_BUCKET_SEC: '10',
        SOCKET_RATE_LIMIT_MAX: '2',
      },
      onRedisFallback,
      onRateLimited,
    });

    await expect(runAllowRequest(limiter)).resolves.toEqual({
      error: null,
      allowed: true,
    });
    await expect(runAllowRequest(limiter)).resolves.toEqual({
      error: null,
      allowed: true,
    });
    await expect(runAllowRequest(limiter)).resolves.toEqual({
      error: 'Rate limit exceeded',
      allowed: false,
    });
    expect(onRedisFallback).toHaveBeenCalledTimes(3);
    expect(onRateLimited).toHaveBeenCalledTimes(1);
  });
});
