import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One fake Redis shared by every module instance, standing in for the shared production Redis.
const sharedRedis = vi.hoisted(() => {
  const counters = new Map<string, number>();
  const state: { mode: 'up' | 'missing' | 'error' | 'reconnecting' } = { mode: 'up' };
  const client = {
    multi() {
      const commands: Array<() => [null, number]> = [];
      const chain = {
        incr(key: string) {
          commands.push(() => {
            const next = (counters.get(key) ?? 0) + 1;
            counters.set(key, next);
            return [null, next];
          });
          return chain;
        },
        expire() {
          commands.push(() => [null, 1]);
          return chain;
        },
        async exec() {
          if (state.mode === 'error') throw new Error('connect ECONNREFUSED');
          return commands.map((command) => command());
        },
      };
      return chain;
    },
  };
  const reconnectingMulti = vi.fn();
  return { counters, state, client, reconnectingMulti };
});

vi.mock('./redis', () => ({
  redisClient: {
    getClient: () => {
      if (sharedRedis.state.mode === 'missing') return null;
      if (sharedRedis.state.mode === 'reconnecting') {
        // A queued command would wait for the reconnect; the limiter must not send it.
        return { status: 'reconnecting', multi: sharedRedis.reconnectingMulti };
      }
      return sharedRedis.client;
    },
  },
}));
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

type RateLimitModule = typeof import('./rateLimit');

/** A fresh copy of the module: its own process memory, like a second web instance. */
async function loadInstance(): Promise<RateLimitModule> {
  vi.resetModules();
  return import('./rateLimit');
}

function request(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

beforeEach(() => {
  // Pin the clock mid-window so a test never straddles a fixed-window boundary.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T00:00:30Z'));
  sharedRedis.counters.clear();
  sharedRedis.state.mode = 'up';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getTrustedClientIp', () => {
  let getTrustedClientIp: RateLimitModule['getTrustedClientIp'];

  beforeEach(async () => {
    ({ getTrustedClientIp } = await loadInstance());
  });

  it('takes the right-most hop for one trusted proxy, never the client-written left-most', () => {
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    expect(getTrustedClientIp(headers, {})).toBe('203.0.113.9');
  });

  it('counts back by the configured number of trusted proxies', () => {
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 10.0.0.2' });
    expect(getTrustedClientIp(headers, { RATE_LIMIT_TRUSTED_PROXY_COUNT: '2' })).toBe(
      '203.0.113.9'
    );
  });

  it('returns null when there are fewer hops than trusted proxies, or none are trusted', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9' });
    expect(getTrustedClientIp(headers, { RATE_LIMIT_TRUSTED_PROXY_COUNT: '2' })).toBeNull();
    expect(getTrustedClientIp(headers, { RATE_LIMIT_TRUSTED_PROXY_COUNT: '0' })).toBeNull();
    expect(getTrustedClientIp(new Headers(), {})).toBeNull();
  });

  it('rejects a hop that is not an IP address', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, not-an-ip' });
    expect(getTrustedClientIp(headers, {})).toBeNull();
  });

  it('uses the Netlify connection IP only when running on Netlify', () => {
    const headers = new Headers({
      'x-nf-client-connection-ip': '198.51.100.7',
      'x-forwarded-for': '6.6.6.6, 203.0.113.9',
    });
    expect(getTrustedClientIp(headers, { NETLIFY: 'true' })).toBe('198.51.100.7');
    expect(getTrustedClientIp(headers, {})).toBe('203.0.113.9');
  });
});

describe('rate limit counters', () => {
  it('shares one counter between two instances on the same Redis', async () => {
    const instanceA = await loadInstance();
    const instanceB = await loadInstance();
    const options = { name: 'shared-test', windowMs: 60_000, maxRequests: 2 };
    const limiterA = instanceA.createRateLimit(options);
    const limiterB = instanceB.createRateLimit(options);
    const caller = request({ 'x-forwarded-for': '203.0.113.9' });

    await expect(limiterA.check(caller)).resolves.toMatchObject({ allowed: true });
    await expect(limiterB.check(caller)).resolves.toMatchObject({ allowed: true });
    await expect(limiterA.check(caller)).resolves.toMatchObject({ allowed: false });
    await expect(limiterB.check(caller)).resolves.toMatchObject({ allowed: false });
  });

  it('keeps a spoofed left-most x-forwarded-for value in the real caller bucket', async () => {
    const { createRateLimit } = await loadInstance();
    const limiter = createRateLimit({ name: 'spoof-test', windowMs: 60_000, maxRequests: 1 });

    await expect(
      limiter.check(request({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      limiter.check(request({ 'x-forwarded-for': '9.9.9.9, 203.0.113.9' }))
    ).resolves.toMatchObject({ allowed: false });
    // A different real caller has its own budget.
    await expect(
      limiter.check(request({ 'x-forwarded-for': '1.1.1.1, 203.0.113.10' }))
    ).resolves.toMatchObject({ allowed: true });
  });

  it('keys authenticated callers by user id rather than address', async () => {
    const { createRateLimit } = await loadInstance();
    const limiter = createRateLimit({ name: 'user-test', windowMs: 60_000, maxRequests: 1 });
    const sameNetwork = request({ 'x-forwarded-for': '203.0.113.9' });

    await expect(limiter.check(sameNetwork, { userId: 'user-a' })).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.check(sameNetwork, { userId: 'user-b' })).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.check(sameNetwork, { userId: 'user-a' })).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('returns 429 with the configured limit once the budget is spent', async () => {
    const { createRateLimit, withRateLimit } = await loadInstance();
    const guard = withRateLimit(
      createRateLimit({ name: 'guard-test', windowMs: 60_000, maxRequests: 1 })
    );
    const caller = request({ 'x-forwarded-for': '203.0.113.9' });

    await expect(guard(caller)).resolves.toMatchObject({ success: true });
    const rejected = await guard(caller);
    expect(rejected).toMatchObject({
      success: false,
      status: 429,
      headers: { 'X-RateLimit-Limit': '1', 'X-RateLimit-Remaining': '0' },
    });
  });
});

describe.each(['missing', 'error', 'reconnecting'] as const)('when Redis is %s', (mode) => {
  beforeEach(() => {
    sharedRedis.state.mode = mode;
  });

  it('fails closed with 503 for the sensitive configs', async () => {
    const { rateLimitConfigs, withRateLimit } = await loadInstance();
    const caller = request({ 'x-forwarded-for': '203.0.113.9' });

    for (const limiter of [rateLimitConfigs.auth, rateLimitConfigs.api, rateLimitConfigs.heavy]) {
      await expect(withRateLimit(limiter)(caller)).resolves.toMatchObject({
        success: false,
        status: 503,
        body: { error: { code: 'RATE_LIMIT_UNAVAILABLE' } },
      });
    }
  });

  it('falls back to a per-process counter for the public config', async () => {
    const { rateLimitConfigs, withRateLimit } = await loadInstance();
    const guard = withRateLimit(rateLimitConfigs.public);
    const caller = request({ 'x-forwarded-for': '203.0.113.9' });

    for (let i = 0; i < 100; i += 1) {
      await expect(guard(caller)).resolves.toMatchObject({ success: true });
    }
    await expect(guard(caller)).resolves.toMatchObject({ success: false, status: 429 });
    expect(sharedRedis.reconnectingMulti).not.toHaveBeenCalled();
  });
});
