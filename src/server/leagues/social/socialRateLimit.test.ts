import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/redis', () => ({
  redisClient: { getClient: () => null },
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

import { enforceSocialRateLimit } from './socialRateLimit';

describe('social rate limiting', () => {
  it('rejects requests above the configured process-fallback limit', async () => {
    const input = {
      leagueId: 'league-rate-test',
      userId: 'user-rate-test',
      action: 'message-rate-test',
      maxRequests: 2,
      windowSeconds: 60,
    };

    await expect(enforceSocialRateLimit(input)).resolves.toBeUndefined();
    await expect(enforceSocialRateLimit(input)).resolves.toBeUndefined();
    await expect(enforceSocialRateLimit(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
  });
});
