'use client';

import { useEffect, useState } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';

interface LeagueMatchupsPanelProps {
  leagueId: string;
  currentUserId?: string;
}

interface MatchupModel {
  id?: string;
  round?: number;
  status?: string;
  homeMember?: { teamName?: string } | null;
  awayMember?: { teamName?: string } | null;
  byeMember?: { teamName?: string } | null;
  homeCategoryWins?: number;
  awayCategoryWins?: number;
  drawnCategories?: number;
}

interface MatchupReadModel {
  round: number;
  matchups: MatchupModel[];
  permissions?: { canManage?: boolean };
}

export function LeagueMatchupsPanel({ leagueId, currentUserId }: LeagueMatchupsPanelProps) {
  const [data, setData] = useState<MatchupReadModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  async function loadMatchups() {
    setStatus('loading');
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/matchups`,
        {},
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to load matchups.');
      }
      setData(payload.data);
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load matchups.');
      setStatus('error');
    }
  }

  useEffect(() => {
    void loadMatchups();
  }, [leagueId, currentUserId]);

  async function recalculate(finalize = false) {
    if (!data) return;
    setMessage(null);
    try {
      const response = await authenticatedFetch(
        `/api/leagues/${leagueId}/matchups/${data.round}/recalculate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalize }),
        },
        currentUserId
      );
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to recalculate matchups.');
      }
      await loadMatchups();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to recalculate matchups.');
    }
  }

  if (status === 'loading') {
    return (
      <div className="rounded-lg border border-[color:var(--league-border)] p-4">
        Loading matchups
      </div>
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="league-matchups-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="league-matchups-heading"
            className="text-xl font-semibold text-[color:var(--league-text)]"
          >
            Matchups
          </h2>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            Live league head-to-head category scoreboard.
          </p>
        </div>
        {data?.permissions?.canManage && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void recalculate(false)}
              className="rounded-md border border-[color:var(--league-border)] px-3 py-2 text-sm font-medium text-[color:var(--league-text)]"
            >
              Recalculate
            </button>
            <button
              type="button"
              onClick={() => void recalculate(true)}
              className="rounded-md bg-[color:var(--league-primary)] px-3 py-2 text-sm font-semibold text-[color:var(--league-primary-foreground)]"
            >
              Finalize
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {message}
        </div>
      )}
      {status === 'error' && !data ? null : data?.matchups.length ? (
        <div className="grid gap-3">
          {data.matchups.map((matchup, index) => (
            <article
              key={matchup.id ?? `matchup-${index}`}
              className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4"
            >
              {matchup.byeMember ? (
                <div className="text-sm font-medium text-[color:var(--league-text)]">
                  {matchup.byeMember.teamName ?? 'Team'} has a bye
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div className="font-semibold text-[color:var(--league-text)]">
                    {matchup.homeMember?.teamName ?? 'Home'}
                  </div>
                  <div className="text-center text-sm text-[color:var(--league-text-muted)]">
                    {matchup.homeCategoryWins ?? 0}-{matchup.awayCategoryWins ?? 0}
                    {matchup.drawnCategories ? `-${matchup.drawnCategories}` : ''}
                    <div className="mt-1 text-xs uppercase">{matchup.status ?? 'SCHEDULED'}</div>
                  </div>
                  <div className="font-semibold text-[color:var(--league-text)] sm:text-right">
                    {matchup.awayMember?.teamName ?? 'Away'}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 text-sm text-[color:var(--league-text-muted)]">
          No fixtures have been generated for this league yet.
        </div>
      )}
    </section>
  );
}
