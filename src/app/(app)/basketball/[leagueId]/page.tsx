import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BasketballOverviewView } from '@/components/basketball/overview/BasketballOverviewView';
import { BasketballPageHeading } from '@/components/basketball/shell/BasketballPageHeading';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadOwnedBasketballLeague } from '@/server/basketball/leagues/basketballLeagueQueries';
import { loadBasketballOverview } from '@/server/basketball/readModels/overview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Overview | Statly basketball' };

export default async function BasketballOverviewPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) notFound();
  const league = await loadOwnedBasketballLeague(userId, leagueId);
  if (!league) notFound();
  const now = new Date();
  const overview = await loadBasketballOverview(league, { now });

  return (
    <div>
      <BasketballPageHeading
        title="Overview"
        description="Your week at a glance: opponent, games left and injuries."
      />
      <BasketballOverviewView overview={overview} leagueId={league.id} now={now} />
    </div>
  );
}
