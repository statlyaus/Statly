import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  enforceSocialRateLimit: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/server/leagues/social/socialRateLimit', () => ({
  enforceSocialRateLimit: mocks.enforceSocialRateLimit,
}));

import { SocialError } from '@/server/leagues/social/socialErrors';

import { SOCIAL_WRITE_LIMIT, withLeagueSocialRoute } from './socialRoute';

function request(method: string): NextRequest {
  return { method, nextUrl: { pathname: '/api/leagues/league-1/social/x' } } as NextRequest;
}

const params = Promise.resolve({ id: 'league-1' });

describe('withLeagueSocialRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.enforceSocialRateLimit.mockResolvedValue(undefined);
  });

  it('rate limits every write for the signed-in member before running the handler', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });

    for (const method of ['POST', 'PATCH', 'DELETE']) {
      await withLeagueSocialRoute(request(method), params, handler);
    }

    expect(mocks.enforceSocialRateLimit).toHaveBeenCalledTimes(3);
    expect(mocks.enforceSocialRateLimit).toHaveBeenCalledWith({
      leagueId: 'league-1',
      userId: 'user-1',
      action: 'write',
      ...SOCIAL_WRITE_LIMIT,
    });
  });

  it('does not rate limit reads', async () => {
    await withLeagueSocialRoute(request('GET'), params, vi.fn().mockResolvedValue([]));

    expect(mocks.enforceSocialRateLimit).not.toHaveBeenCalled();
  });

  it('answers 429 without running the handler when the write limit is exceeded', async () => {
    mocks.enforceSocialRateLimit.mockRejectedValue(
      new SocialError('RATE_LIMITED', 'You are posting too quickly')
    );
    const handler = vi.fn();

    const response = await withLeagueSocialRoute(request('PATCH'), params, handler);

    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated write before counting it', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValue(null);

    const response = await withLeagueSocialRoute(request('POST'), params, vi.fn());

    expect(response.status).toBe(401);
    expect(mocks.enforceSocialRateLimit).not.toHaveBeenCalled();
  });
});
