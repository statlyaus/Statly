import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const countRateLimitHitMock = vi.hoisted(() => vi.fn());
const collectAllMetricsMock = vi.hoisted(() => vi.fn());

// The route reads its secret at import time.
vi.hoisted(() => {
  process.env.METRICS_API_KEY = 'test-metrics-key'; // skipcq: SCT-A000 test value, not a credential
});

vi.mock('@/lib/metrics', () => ({
  metricsCollector: { collectAllMetrics: collectAllMetricsMock },
}));
vi.mock('@/lib/redis', () => ({ redisClient: { getClient: () => null } }));
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  countRateLimitHit: countRateLimitHitMock,
}));

import { GET } from '@/app/api/metrics/route';

function metricsRequest(headers: Record<string, string>) {
  return new NextRequest('http://localhost:3000/api/metrics', { headers });
}

const apiKeyFingerprint = crypto
  .createHash('sha256')
  .update('test-metrics-key')
  .digest('hex')
  .slice(0, 16);

describe('GET /api/metrics rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collectAllMetricsMock.mockResolvedValue({ uptime: 1 });
  });

  it('counts each authenticated request on the shared limiter, 10 per minute per credential', async () => {
    const resetAt = Date.now() + 45_000;
    countRateLimitHitMock.mockResolvedValue({ count: 3, resetAt });

    const response = await GET(metricsRequest({ 'x-api-key': 'test-metrics-key' }));

    expect(response.status).toBe(200);
    expect(countRateLimitHitMock).toHaveBeenCalledWith({
      key: `rate-limit:metrics:apikey:${apiKeyFingerprint}`,
      windowSeconds: 60,
      whenRedisUnavailable: 'memory',
    });
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('7');
    expect(response.headers.get('X-RateLimit-Reset')).toBe(`${Math.ceil(resetAt / 1000)}`);
  });

  it('returns 429 with Retry-After and skips collection past the limit', async () => {
    const resetAt = Date.now() + 20_000;
    countRateLimitHitMock.mockResolvedValue({ count: 11, resetAt });

    const response = await GET(metricsRequest({ 'x-api-key': 'test-metrics-key' }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Try again later.',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(collectAllMetricsMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request before spending any budget', async () => {
    const response = await GET(
      metricsRequest({ 'x-api-key': 'wrong-key', 'x-forwarded-for': '203.0.113.9' })
    );

    expect(response.status).toBe(401);
    expect(countRateLimitHitMock).not.toHaveBeenCalled();
  });
});
