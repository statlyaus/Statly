'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import LeagueViewHeader from '@/components/league/LeagueViewHeader';

type SeasonStateResponse = {
  success?: boolean;
  data?: {
    leagueId: string;
    season: number;
    currentWeek: number | null;
    schedule: Array<{
      id: string;
      season: number;
      week: number;
      aflRound: number | null;
      roundLabel: string;
      status: 'scheduled' | 'in_progress' | 'final';
      matchupCount: number;
      current: boolean;
    }>;
    ladder: Array<{
      userId: string;
      teamName: string;
      ladderRank: number;
      record: { w: number; l: number; t: number };
      points: number;
      categoriesWon: number;
      categoriesLost: number;
      categoriesTied: number;
      scheduleWeek: number | null;
      currentOpponentUserId?: string | null;
      currentOpponentTeamName?: string | null;
      isCurrentUser: boolean;
    }>;
  };
  error?: { message?: string };
};

interface LeagueSeasonTabProps {
  leagueId: string;
  initialPanel?: 'ladder' | 'schedule';
  embedded?: boolean;
}

function formatRecord(record: { w: number; l: number; t: number }) {
  return `${record.w}-${record.l}${record.t > 0 ? `-${record.t}` : ''}`;
}

function getStatusStyles(status: 'scheduled' | 'in_progress' | 'final') {
  switch (status) {
    case 'in_progress':
      return 'bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)] border-[color:var(--league-warning-soft)]';
    case 'final':
      return 'bg-[color:var(--league-success-soft)] text-[color:var(--league-success)] border-[color:var(--league-success-soft)]';
    default:
      return 'bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)] border-[color:var(--league-border)]';
  }
}

export default function LeagueSeasonTab({
  leagueId,
  initialPanel = 'ladder',
  embedded = false,
}: LeagueSeasonTabProps) {
  const [seasonState, setSeasonState] = useState<SeasonStateResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadSeasonState = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/leagues/${leagueId}/season-state`, {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          let message = `Failed to load season state (${response.status})`;
          try {
            const body = (await response.json()) as SeasonStateResponse;
            message = body.error?.message || message;
          } catch {
            message = response.statusText || message;
          }
          throw new Error(message);
        }

        const body = (await response.json()) as SeasonStateResponse;
        if (active) {
          setSeasonState(body.data ?? null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load season state');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadSeasonState();

    return () => {
      active = false;
    };
  }, [leagueId]);

  const topLadder = useMemo(() => seasonState?.ladder.slice(0, 8) ?? [], [seasonState?.ladder]);
  const currentWeek = seasonState?.currentWeek ?? null;
  const totalRounds = seasonState?.schedule.length ?? 0;
  const completedRounds =
    seasonState?.schedule.filter((round) => round.status === 'final').length ?? 0;
  const liveRounds =
    seasonState?.schedule.filter((round) => round.status === 'in_progress').length ?? 0;
  const primaryPanel = initialPanel === 'schedule' ? 'schedule' : 'ladder';

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-40 rounded bg-slate-200" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
          </div>
          <div className="h-64 rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
        <h2 className="text-lg font-semibold">Season view unavailable</h2>
        <p className="mt-2 text-sm">{error}</p>
        <button
          type="button"
          onClick={() => {
            setIsLoading(true);
            setError(null);
            setSeasonState(null);
            void fetch(`/api/leagues/${leagueId}/season-state`, {
              credentials: 'include',
              cache: 'no-store',
            })
              .then(async (response) => {
                if (!response.ok) throw new Error(`Failed to load season state (${response.status})`);
                return response.json() as Promise<SeasonStateResponse>;
              })
              .then((body) => setSeasonState(body.data ?? null))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Failed to load season state');
              })
              .finally(() => setIsLoading(false));
          }}
          className="mt-4 rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!seasonState) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        No season data is available yet. The league will populate this tab once the season state
        has been materialized.
      </div>
    );
  }

  const ladderCard = (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h3 className="text-lg font-semibold text-slate-900">Ladder</h3>
        <p className="mt-1 text-sm text-slate-500">
          Category wins become points, then teams are ranked by ladder position.
        </p>
      </div>
      <div className="overflow-hidden">
        <div className="grid grid-cols-[64px_minmax(0,1.8fr)_88px_88px] gap-3 border-b border-slate-100 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          <span>Rank</span>
          <span>Team</span>
          <span className="text-right">Record</span>
          <span className="text-right">Points</span>
        </div>
        <div className="divide-y divide-slate-100">
          {topLadder.map((entry) => (
            <div
              key={entry.userId}
              className={`grid grid-cols-[64px_minmax(0,1.8fr)_88px_88px] gap-3 px-6 py-4 text-sm ${
                entry.isCurrentUser ? 'bg-[color:var(--league-primary-soft)]' : ''
              }`}
            >
              <div className="font-semibold text-slate-900">#{entry.ladderRank}</div>
              <div>
                <div className="font-medium text-slate-900">{entry.teamName}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {entry.categoriesWon}W / {entry.categoriesLost}L / {entry.categoriesTied}T
                </div>
                {entry.currentOpponentTeamName && (
                  <div className="mt-1 text-xs text-slate-400">
                    vs {entry.currentOpponentTeamName}
                  </div>
                )}
              </div>
              <div className="text-right font-medium text-slate-700">
                {formatRecord(entry.record)}
              </div>
              <div className="text-right font-semibold text-slate-900">{entry.points}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const scheduleCard = (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h3 className="text-lg font-semibold text-slate-900">Schedule</h3>
        <p className="mt-1 text-sm text-slate-500">
          Track the active round, upcoming slate, and completed league history.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {seasonState.schedule.map((round) => (
          <div key={round.id} className="flex items-center justify-between gap-4 px-6 py-4">
            <div>
              <div className="font-medium text-slate-900">{round.roundLabel}</div>
              <div className="mt-1 text-sm text-slate-500">
                {round.matchupCount} matchup{round.matchupCount === 1 ? '' : 's'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {round.current && (
                <span className="rounded-full bg-[color:var(--league-primary-soft)] px-2.5 py-1 text-xs font-semibold text-[color:var(--league-primary)]">
                  Current
                </span>
              )}
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusStyles(
                  round.status
                )}`}
              >
                {round.status.replace('_', ' ')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {embedded ? (
        <LeagueViewHeader
          eyebrow={initialPanel === 'ladder' ? 'League ladder' : 'League schedule'}
          title={initialPanel === 'ladder' ? 'Standings and points' : 'Season schedule'}
          description={
            initialPanel === 'ladder'
              ? 'Track ladder position, category points, and the teams you are chasing.'
              : 'Move round by round through the league calendar and keep history in view.'
          }
          chips={[
            { label: `Season ${seasonState.season}` },
            { label: `Current week ${currentWeek ?? 'Not set'}` , tone: 'accent'},
            { label: `${liveRounds} live`, tone: liveRounds > 0 ? 'warning' : 'neutral' },
            { label: `${completedRounds} completed`, tone: 'success' },
          ]}
          aside={
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Current week</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{currentWeek ?? 'Not set'}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Rounds</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{totalRounds}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Live</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{liveRounds}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Completed</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{completedRounds}</div>
              </div>
            </div>
          }
        />
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Season</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">{seasonState.season}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Follow the current week, inspect the ladder, and review the full season slate.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Current week</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">
                  {currentWeek ?? 'Not set'}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Rounds</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{totalRounds}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Live</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{liveRounds}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Completed</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{completedRounds}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.9fr)] 2xl:grid-cols-[minmax(0,1.6fr)_minmax(380px,0.85fr)] 2xl:gap-8">
        <div>{primaryPanel === 'ladder' ? ladderCard : scheduleCard}</div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Season Navigation</h3>
            </div>
            <div className="space-y-3 p-6">
              <Link
                href={`/leagues/${leagueId}?tab=overview`}
                className="block rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-sm font-medium text-[color:var(--league-text)] transition-colors hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
              >
                Open league overview
              </Link>
              <Link
                href={`/leagues/${leagueId}?tab=matchup`}
                className="block rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-sm font-medium text-[color:var(--league-text)] transition-colors hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
              >
                Review current matchup
              </Link>
            </div>
          </div>

          {primaryPanel === 'ladder' ? scheduleCard : ladderCard}
        </div>
      </section>
    </div>
  );
}
