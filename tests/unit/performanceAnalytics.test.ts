import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queueAddMock = vi.hoisted(() => vi.fn());
const redisSetMock = vi.hoisted(() => vi.fn());
const redisEvalMock = vi.hoisted(() => vi.fn());

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: queueAddMock })),
}));
vi.mock('@/server/realtime/scalableConnection', () => ({
  getPublisherClient: () => ({
    set: redisSetMock,
    eval: redisEvalMock,
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  }),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST } from '@/app/api/analytics/performance/route';
import { isWebVitalMetricName } from '@/lib/performance';

function metricRequest(name: 'FCP' | 'TTFB', suffix: string) {
  return new NextRequest('http://localhost:3000/api/analytics/performance', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({
      name,
      value: 123.4,
      rating: 'good',
      delta: 123.4,
      id: `v5-${suffix}`,
      navigationType: 'navigate',
      sessionId: `session-${suffix}`,
      timestamp: Date.now(),
      url: 'http://localhost:3000/dashboard?private=value',
    }),
  });
}

describe('performance analytics contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueAddMock.mockResolvedValue({ id: 'queued-job' });
    redisSetMock.mockResolvedValue('OK');
    redisEvalMock.mockResolvedValue(1);
  });

  it.each(['FCP', 'TTFB'] as const)(
    'queues valid %s metrics with a BullMQ-safe job ID',
    async (name) => {
      const suffix = `${name.toLowerCase()}-${Date.now()}`;
      const response = await POST(metricRequest(name, suffix));

      expect(response.status).toBe(200);
      expect(queueAddMock).toHaveBeenCalledOnce();
      const [, payload, options] = queueAddMock.mock.calls[0] as [
        string,
        { url: string },
        { jobId: string },
      ];
      expect(payload.url).toBe('http://localhost:3000/dashboard');
      expect(options.jobId).toMatch(/^[a-f0-9]{64}$/);
      expect(options.jobId).not.toContain(':');
      const expectedRateLimitHash = crypto
        .createHash('sha256')
        .update(`session-${suffix}`)
        .digest('hex')
        .slice(0, 16);
      expect(redisEvalMock).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.stringMatching(new RegExp(`^metrics:rl:${expectedRateLimitHash}:\\d+$`)),
        '60'
      );
    }
  );

  it('returns 400 for an invalid metric without touching the queue', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/analytics/performance', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ name: 'custom_fetch', value: 12 }),
      })
    );

    expect(response.status).toBe(400);
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('reports enqueue failures as retryable and releases the de-duplication claim', async () => {
    const suffix = `retry-${Date.now()}`;
    queueAddMock.mockRejectedValueOnce(new Error('queue unavailable'));

    const failedResponse = await POST(metricRequest('FCP', suffix));

    expect(failedResponse.status).toBe(503);
    await expect(failedResponse.json()).resolves.toEqual({
      success: false,
      error: 'Performance metric service unavailable',
    });
    const [, claimToken] = redisSetMock.mock.calls[0] as [string, string];
    expect(claimToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1]) == ARGV[1]"),
      1,
      `metrics:dedup:session-${suffix}:v5-${suffix}`,
      claimToken
    );

    const retryResponse = await POST(metricRequest('FCP', suffix));
    expect(retryResponse.status).toBe(200);
    expect(queueAddMock).toHaveBeenCalledTimes(2);
  });

  it('distinguishes Web Vitals from custom application timings', () => {
    expect(isWebVitalMetricName('INP')).toBe(true);
    expect(isWebVitalMetricName('custom_fetch_user_leagues')).toBe(false);
    expect(isWebVitalMetricName('player_image_load_error')).toBe(false);
  });
});
