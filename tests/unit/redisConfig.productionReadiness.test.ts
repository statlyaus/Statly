import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasPlaceholderRedisConfig,
  isPlaceholderRedisValue,
  shouldDisableRedisClients,
} from '@/lib/redisConfig';

const placeholderHost = ['your', 'production', 'redis', 'host'].join('-');
const placeholderPassword = ['YOUR', 'PRODUCTION', 'REDIS', 'PASSWORD'].join('_');
const configuredPassword = ['configured', 'runtime', 'value'].join('-');

describe('Redis production readiness config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('recognizes checked-in Redis placeholders as disabled config', () => {
    expect(isPlaceholderRedisValue(placeholderHost)).toBe(true);
    expect(isPlaceholderRedisValue(placeholderPassword)).toBe(true);
    expect(
      hasPlaceholderRedisConfig({
        REDIS_HOST: placeholderHost,
        REDIS_PASSWORD: placeholderPassword,
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      shouldDisableRedisClients({
        REDIS_HOST: placeholderHost,
        REDIS_PASSWORD: placeholderPassword,
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it('preserves concrete Redis hosts for real runtime configuration', () => {
    expect(
      shouldDisableRedisClients({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: '6379',
        REDIS_PASSWORD: configuredPassword,
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it('returns disabled realtime clients for placeholder Redis config', async () => {
    vi.stubEnv('REDIS_HOST', placeholderHost);
    vi.stubEnv('REDIS_PASSWORD', placeholderPassword);
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
