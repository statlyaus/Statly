import type React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppLayout } from '@/components/navigation';
import { getAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';
import { loadAuthorizedLeagueTeamRoster } from '@/server/leagues/teamRosterReadModel';

export const dynamic = 'force-dynamic';

export default async function LeagueTeamRosterPage({
  params,
}: {
  params: Promise<{ id: string; memberId: string }>;
}): Promise<React.ReactElement> {
  const { id: leagueId, memberId } = await params;
  const result = await loadAuthorizedLeagueTeamRoster({
    leagueId,
    memberId,
    viewerUserId: await getAuthenticatedUserIdFromServerContext(),
  });

  if (!result.ok) notFound();

  const { roster } = result;
  const standingsHref = `/leagues/${encodeURIComponent(leagueId)}?tab=standings`;

  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] px-4 py-6 text-[color:var(--league-text)] sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[var(--app-shell-max-width)]">
          <Link
            href={standingsHref}
            className="inline-flex min-h-10 items-center text-sm font-semibold text-[color:var(--league-primary)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
          >
            Back to standings
          </Link>

          <header className="mt-5 border-b border-[color:var(--league-border)] pb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
              Team roster
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[color:var(--league-text)]">
              {roster.teamName}
            </h1>
            <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
              {roster.players.length} rostered {roster.players.length === 1 ? 'player' : 'players'}
            </p>
          </header>

          <section className="mt-6 overflow-x-auto rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)]">
            {roster.players.length > 0 ? (
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)]">
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
                <tbody className="divide-y divide-[color:var(--league-border)]">
                  {roster.players.map((player) => (
                    <tr key={player.id}>
                      <td className="px-4 py-3 font-medium text-[color:var(--league-text)]">
                        {player.name}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--league-text-muted)]">
                        {player.club}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--league-text-muted)]">
                        {player.position}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-8 text-sm text-[color:var(--league-text-muted)]">
                This team has no rostered players yet.
              </p>
            )}
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
