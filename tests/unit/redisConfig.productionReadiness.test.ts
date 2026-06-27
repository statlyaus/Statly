import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasPlaceholderRedisConfig,
  isPlaceholderRedisValue,
  shouldDisableRedisClients,
} from '@/lib/redisConfig';

describe('Redis production readiness config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('recognizes checked-in Redis placeholders as disabled config', () => {
    expect(isPlaceholderRedisValue('your-production-redis-host')).toBe(true);
    expect(isPlaceholderRedisValue('YOUR_PRODUCTION_REDIS_PASSWORD')).toBe(true);
    expect(
      hasPlaceholderRedisConfig({
        REDIS_HOST: 'your-production-redis-host',
        REDIS_PASSWORD: 'YOUR_PRODUCTION_REDIS_PASSWORD',
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      shouldDisableRedisClients({
        REDIS_HOST: 'your-production-redis-host',
        REDIS_PASSWORD: 'YOUR_PRODUCTION_REDIS_PASSWORD',
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it('preserves concrete Redis hosts for real runtime configuration', () => {
    expect(
      shouldDisableRedisClients({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: '6379',
        REDIS_PASSWORD: 'configured-secret',
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it('returns disabled realtime clients for placeholder Redis config', async () => {
    vi.stubEnv('REDIS_HOST', 'your-production-redis-host');
    vi.stubEnv('REDIS_PASSWORD', 'YOUR_PRODUCTION_REDIS_PASSWORD');
    vi.stubEnv('REDIS_DISABLED', '');
    vi.stubEnv('NEXT_PHASE', '');

    const { getPublisherClient } = await import('@/server/realtime/scalableConnection');
    const client = getPublisherClient() as unknown as {
      status: string;
      ping: () => Promise<string>;
    };

    expect(client.status).toBe('end');
    await expect(client.ping()).resolves.toBe('PONG');
  });
});
