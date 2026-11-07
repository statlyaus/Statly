import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({
  redisClient: { isConnected: () => false },
}));

import { metricsCollector, withMetrics } from '@/lib/metrics';

describe('withMetrics error counting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts a returned 5xx response as an error', async () => {
    const record = vi.spyOn(metricsCollector, 'recordRequest').mockResolvedValue();
    const handler = withMetrics(async () => new Response(null, { status: 500 }));

    const response = await handler();

    expect(response.status).toBe(500);
    expect(record).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it('does not count a 4xx response as an error', async () => {
    const record = vi.spyOn(metricsCollector, 'recordRequest').mockResolvedValue();
    const handler = withMetrics(async () => new Response(null, { status: 404 }));

    await handler();

    expect(record).toHaveBeenCalledWith(expect.any(Number), false);
  });

  it('counts a thrown handler error', async () => {
    const record = vi.spyOn(metricsCollector, 'recordRequest').mockResolvedValue();
    const handler = withMetrics(async () => {
      throw new Error('boom');
    });

    await expect(handler()).rejects.toThrow('boom');
    expect(record).toHaveBeenCalledWith(expect.any(Number), true);
  });
});
