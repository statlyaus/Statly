import { redirect } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadMemberLeagueOptions } from '@/server/leagues/memberLeagueOptions';

export const dynamic = 'force-dynamic';

/**
 * Retired route: the Ladder tool showed the same panel as a league's Standings tab. Old bookmarks
 * land on that tab for the requested league, or the viewer's most recently joined one, choosing only
 * among leagues the viewer has an active team in, as the Tools pages did.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string }>;
}): Promise<never> {
  const { league: requestedLeagueId } = (await searchParams) ?? {};

  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent('/leaderboard')}`);

  const leagues = await loadMemberLeagueOptions(userId);
  const league = leagues.find((option) => option.id === requestedLeagueId) ?? leagues[0];

  redirect(league ? `/leagues/${encodeURIComponent(league.id)}?tab=standings` : '/dashboard');
}
