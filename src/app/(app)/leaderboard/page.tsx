import type { Metadata } from 'next';

import { LeagueStandingsPanel } from '@/components/league/matchups/LeagueStandingsPanel';
import { LeagueToolPage } from '@/components/league/tools/LeagueToolPage';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ladder | Statly' };

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string }>;
}) {
  const { league: requestedLeagueId } = (await searchParams) ?? {};

  return (
    <LeagueToolPage
      path="/leaderboard"
      title="Ladder"
      description="Standings, form and results"
      requestedLeagueId={requestedLeagueId}
    >
      {({ league, userId }) => (
        <LeagueStandingsPanel key={league.id} leagueId={league.id} currentUserId={userId} />
      )}
    </LeagueToolPage>
  );
}
