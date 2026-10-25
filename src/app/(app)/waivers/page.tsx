import { redirect } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadMemberLeagueOptions } from '@/server/leagues/memberLeagueOptions';

export const dynamic = 'force-dynamic';

/**
 * Waivers are league-scoped: claims, FAAB balances and free agents exist only inside a league, in its
 * Waivers tab. The main navigation and the dashboard link here, so this lands on that tab for the
 * requested league, or the viewer's most recently joined one, choosing only among leagues the viewer
 * has an active team in (as /leaderboard does for Standings).
 */
export default async function WaiversPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string }>;
}): Promise<never> {
  const { league: requestedLeagueId } = (await searchParams) ?? {};

  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) redirect(`/login?next=${encodeURIComponent('/waivers')}`);

  const leagues = await loadMemberLeagueOptions(userId);
  const league = leagues.find((option) => option.id === requestedLeagueId) ?? leagues[0];

  redirect(league ? `/leagues/${encodeURIComponent(league.id)}?tab=waivers` : '/dashboard');
}
