import 'server-only';

import { countRateLimitHit } from '@/lib/rateLimit';

import { SocialError } from './socialErrors';

export async function enforceSocialRateLimit({
  leagueId,
  userId,
  action,
  maxRequests,
  windowSeconds,
}: {
  leagueId: string;
  userId: string;
  action: string;
  maxRequests: number;
  windowSeconds: number;
}): Promise<void> {
  const { count } = await countRateLimitHit({
    key: `social-rate:${leagueId}:${userId}:${action}`,
    windowSeconds,
    whenRedisUnavailable: 'memory',
  });
  if (count > maxRequests) {
    throw new SocialError('RATE_LIMITED', 'You are posting too quickly');
  }
}
