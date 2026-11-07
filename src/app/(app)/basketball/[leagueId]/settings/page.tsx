import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BasketballLeagueForm } from '@/components/basketball/setup/BasketballLeagueForm';
import { BasketballTeamsEditor } from '@/components/basketball/setup/BasketballTeamsEditor';
import { DeleteBasketballLeague } from '@/components/basketball/setup/DeleteBasketballLeague';
import { BasketballPageHeading } from '@/components/basketball/shell/BasketballPageHeading';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadOwnedBasketballLeague } from '@/server/basketball/leagues/basketballLeagueQueries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'League settings | Statly basketball' };

export default async function BasketballSettingsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) notFound();
  const league = await loadOwnedBasketballLeague(userId, leagueId);
  if (!league) notFound();

  return (
    <div className="max-w-4xl">
      <BasketballPageHeading
        title="Settings"
        description="Change how Statly scores this league, rename its teams, or delete it."
      />
      <BasketballLeagueForm mode="edit" league={league} />
      <BasketballTeamsEditor league={league} />
      <DeleteBasketballLeague leagueId={league.id} name={league.name} />
    </div>
  );
}
