import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import CommissionerWorkspace from '@/components/commissioner/CommissionerWorkspace';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadCommissionerLeagues } from '@/server/leagues/commissionerReadModel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Commissioner | Statly' };

export default async function CommissionerPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string }>;
}) {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) redirect('/login?next=%2Fcommissioner');

  const [leagues, query] = await Promise.all([
    loadCommissionerLeagues(userId),
    searchParams ?? Promise.resolve({ league: undefined }),
  ]);

  if (leagues.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold text-foreground">Commissioner</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Commissioner tools appear here for leagues you own. Create a league to manage its managers
          and settings.
        </p>
        <Link
          href="/leagues/new"
          className="mt-6 inline-flex h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Create a league
        </Link>
      </div>
    );
  }

  const selectedLeagueId = leagues.some((league) => league.id === query.league)
    ? query.league!
    : leagues[0].id;

  return <CommissionerWorkspace leagues={leagues} selectedLeagueId={selectedLeagueId} />;
}
