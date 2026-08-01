import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({
  subscriber: {
    psubscribe: vi.fn(),
    on: vi.fn(),
  },
  publisher: {
    publish: vi.fn(),
  },
}));

vi.mock('@/server/realtime/scalableConnection', () => ({
  getSubscriberClient: () => redis.subscriber,
  getPublisherClient: () => redis.publisher,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { DraftPubSub } from '@/services/realtime/pubsub';

describe('DraftPubSub subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PHASE', '');
    vi.stubEnv('REDIS_DISABLED', '0');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('can retry after pattern subscription fails', async () => {
    redis.subscriber.psubscribe
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockResolvedValueOnce(1);
    const pubSub = new DraftPubSub();

    await expect(pubSub.start(() => undefined)).rejects.toThrow('redis unavailable');
    await expect(pubSub.start(() => undefined)).resolves.toBeUndefined();
    await pubSub.start(() => undefined);

    expect(redis.subscriber.psubscribe).toHaveBeenCalledTimes(2);
    expect(redis.subscriber.on).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight subscription attempt between concurrent callers', async () => {
    let release!: () => void;
    redis.subscriber.psubscribe.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(1);
        })
    );
    const pubSub = new DraftPubSub();

    const first = pubSub.start(() => undefined);
    const second = pubSub.start(() => undefined);
    release();
    await Promise.all([first, second]);

    expect(redis.subscriber.psubscribe).toHaveBeenCalledTimes(1);
    expect(redis.subscriber.on).toHaveBeenCalledTimes(1);
  });
});
