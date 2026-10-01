import type { Metadata } from 'next';

import { LeagueMatchupsPanel } from '@/components/league/matchups/LeagueMatchupsPanel';
import { LeagueToolPage } from '@/components/league/tools/LeagueToolPage';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Live Scoring | Statly' };

export default async function LiveScoringPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string }>;
}) {
  const { league: requestedLeagueId } = (await searchParams) ?? {};

  return (
    <LeagueToolPage
      path="/live-scoring"
      title="Live Scoring"
      description="This round's category head-to-head matchups"
      requestedLeagueId={requestedLeagueId}
    >
      {({ league, userId }) => (
        <LeagueMatchupsPanel key={league.id} leagueId={league.id} currentUserId={userId} />
      )}
    </LeagueToolPage>
  );
}
