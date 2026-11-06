import { redirect } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadMemberLeagueOptions } from '@/server/leagues/memberLeagueOptions';

export const dynamic = 'force-dynamic';

/**
 * Rosters are league-scoped: a team's players, claims and free agents live in the league's Roster
 * and Waivers tabs, which read Prisma. This page used to read Firestore and its Claim and Add FA
 * buttons did nothing, so it now lands on the Roster tab for the requested league, or the viewer's
 * most recently joined one, choosing only among leagues the viewer has an active team in.
 */
export default async function RostersPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string }>;
}): Promise<never> {
  const { league: requestedLeagueId } = (await searchParams) ?? {};

  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent('/rosters')}`);

  const leagues = await loadMemberLeagueOptions(userId);
  const league = leagues.find((option) => option.id === requestedLeagueId) ?? leagues[0];

  redirect(league ? `/leagues/${encodeURIComponent(league.id)}?tab=roster` : '/dashboard');
}
