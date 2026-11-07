import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BasketballRosterManager } from '@/components/basketball/roster/BasketballRosterManager';
import { BasketballPageHeading } from '@/components/basketball/shell/BasketballPageHeading';
import { toEasternDate } from '@/lib/basketball/fantasyWeeks';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadOwnedBasketballLeague } from '@/server/basketball/leagues/basketballLeagueQueries';
import { currentFantasyWeek } from '@/server/basketball/readModels/overview';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Roster | Statly basketball' };

export default async function BasketballRosterPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) notFound();
  const league = await loadOwnedBasketballLeague(userId, leagueId);
  if (!league) notFound();
  const { week } = currentFantasyWeek(league, toEasternDate(new Date()));

  return (
    <div>
      <BasketballPageHeading
        title="Roster"
        description="Who is on each team. Statly only counts players entered here, so keep your team and this week's opponent up to date."
      />
      <BasketballRosterManager initialLeague={league} week={week} />
    </div>
  );
}
