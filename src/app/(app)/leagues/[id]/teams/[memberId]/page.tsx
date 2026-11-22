import type React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { NotLeagueMember } from '@/components/league/NotLeagueMember';
import { loadMemberLeagueOptions } from '@/server/leagues/memberLeagueOptions';
import { loadAuthorizedLeagueTeamRoster } from '@/server/leagues/teamRosterReadModel';

export const dynamic = 'force-dynamic';

export default async function LeagueTeamRosterPage({
  params,
}: {
  params: Promise<{ id: string; memberId: string }>;
}): Promise<React.ReactElement> {
  const { id: leagueId, memberId } = await params;
  const viewerUserId = await getAuthenticatedUserIdFromServerContext();
  const result = await loadAuthorizedLeagueTeamRoster({ leagueId, memberId, viewerUserId });

  if (!result.ok && result.status === 'forbidden' && viewerUserId) {
    return <NotLeagueMember leagues={await loadMemberLeagueOptions(viewerUserId)} />;
  }
  if (!result.ok) notFound();

  const { roster } = result;
  const standingsHref = `/leagues/${encodeURIComponent(leagueId)}?tab=standings`;

  return (
    <div className="min-h-screen bg-muted px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[var(--app-shell-max-width)]">
        <Link
          href={standingsHref}
          className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-bar underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-brand-bar"
        >
          Back to standings
        </Link>

        <header className="mt-5 border-b border-border pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Team roster
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">{roster.teamName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {roster.players.length} rostered {roster.players.length === 1 ? 'player' : 'players'}
          </p>
        </header>

        <section className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
          {roster.players.length > 0 ? (
            <table className="min-w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Player
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Club
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Position
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {roster.players.map((player) => (
                  <tr key={player.id}>
                    <td className="px-4 py-3 font-medium text-foreground">{player.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{player.club}</td>
                    <td className="px-4 py-3 text-muted-foreground">{player.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              This team has no rostered players yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
