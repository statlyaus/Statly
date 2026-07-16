'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface LeagueStandingsPanelProps {
  leagueId: string;
  currentUserId?: string;
}

interface StandingRow {
  id?: string;
  memberId: string;
  teamName: string;
  wins: number;
  losses: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
  pointsFor: number;
  pointsAgainst: number;
}

export function LeagueStandingsPanel({ leagueId, currentUserId }: LeagueStandingsPanelProps) {
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadStandings() {
      try {
        const response = await authenticatedFetch(
          `/api/leagues/${leagueId}/matchups`,
          {},
          currentUserId
        );
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? 'Failed to load standings.');
        }
        if (mounted) setRows(payload.data?.standings ?? []);
      } catch (error) {
        if (mounted)
          setMessage(error instanceof Error ? error.message : 'Failed to load standings.');
      }
    }
    void loadStandings();
    return () => {
      mounted = false;
    };
  }, [leagueId, currentUserId]);

  return (
    <section className="space-y-4" aria-labelledby="league-standings-heading">
      <div>
        <h2
          id="league-standings-heading"
          className="text-xl font-semibold text-[color:var(--league-text)]"
        >
          Standings
        </h2>
        <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
          Weekly record and category record for league matchups.
        </p>
      </div>
      {message && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}
      {rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-[color:var(--league-border)]">
          <table className="min-w-full divide-y divide-[color:var(--league-border)] text-sm">
            <thead className="bg-[color:var(--league-surface-muted)] text-left text-[color:var(--league-text-muted)]">
              <tr>
                <th className="px-3 py-2">Rank</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Record</th>
                <th className="px-3 py-2">Category record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--league-border)]">
              {rows.map((row, index) => (
                <tr
                  key={row.id ?? row.memberId}
                  className="transition-colors hover:bg-[color:var(--league-surface-muted)]"
                >
                  <td className="px-3 py-2">{index + 1}</td>
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(row.memberId)}`}
                      aria-label={`View ${row.teamName} roster`}
                      className="text-[color:var(--league-primary)] underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                    >
                      {row.teamName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{`${row.wins}-${row.losses}-${row.draws}`}</td>
                  <td className="px-3 py-2">{`${row.categoryWins}-${row.categoryLosses}-${row.categoryDraws}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          Standings will appear after matchups are finalized.
        </div>
      )}
    </section>
  );
}
