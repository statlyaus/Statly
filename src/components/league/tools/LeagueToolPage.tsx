import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import {
  loadMemberLeagueOptions,
  type MemberLeagueOption,
} from '@/server/leagues/memberLeagueOptions';

import { LeagueToolSwitcher } from './LeagueToolSwitcher';

interface LeagueToolPageProps {
  path: string;
  title: string;
  description: string;
  requestedLeagueId?: string;
  children: (context: { league: MemberLeagueOption; userId: string }) => ReactNode;
}

/**
 * Shell for the Tools pages that show one league's data. It only offers leagues the viewer has an
 * active team in, and defaults to the most recently joined one; the league-scoped panels and APIs
 * rendered as children still authorize every read themselves.
 */
export async function LeagueToolPage({
  path,
  title,
  description,
  requestedLeagueId,
  children,
}: LeagueToolPageProps) {
  const userId = await getAuthenticatedUserIdFromServerContext();
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);

  const leagues = await loadMemberLeagueOptions(userId);
  const league = leagues.find((option) => option.id === requestedLeagueId) ?? leagues[0];

  return (
    <div className="mx-auto w-full max-w-[var(--app-shell-max-width)] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {league ? `${description} · ${league.name}` : description}
          </p>
        </div>
        {leagues.length > 1 && league ? (
          <LeagueToolSwitcher path={path} leagues={leagues} selectedLeagueId={league.id} />
        ) : null}
      </header>

      {league ? (
        children({ league, userId })
      ) : (
        <section className="rounded-lg border border-border bg-background p-6">
          <h2 className="text-base font-semibold text-foreground">You are not in a league yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Join a league with an invite code or create your own to see this page.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/leagues/join"
              className="inline-flex h-11 items-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground hover:bg-brand-bar/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Join a league
            </Link>
            <Link
              href="/leagues/new"
              className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Create a league
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
