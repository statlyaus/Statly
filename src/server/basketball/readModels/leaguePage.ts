import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import { loadOwnedBasketballLeague } from '@/server/basketball/leagues/basketballLeagueQueries';

/**
 * For a basketball page: the signed-in user and the league they own, or the 404 page for a missing
 * or someone else's league (the same response, so nothing leaks). Cached per request.
 */
export const loadLeagueForPage = cache(
  async (
    leagueId: string,
    path: string
  ): Promise<{ userId: string; league: BasketballLeagueDetail }> => {
    const userId = await getAuthenticatedUserIdFromServerContext();
    if (!userId) redirect(`/login?next=${encodeURIComponent(path)}`);
    const league = await loadOwnedBasketballLeague(userId, leagueId);
    if (!league) notFound();
    return { userId, league };
  }
);
