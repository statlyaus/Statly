'use client';

import { useEffect, useMemo, useState } from 'react';

import { TeamLogo } from '@/components/TeamLogo';

type LiveMatch = {
  id?: string;
  match_uid?: string;
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: 'scheduled' | 'in_progress' | 'final';
  home_score?: number | null;
  away_score?: number | null;
  home_score_breakdown?: string | null;
  away_score_breakdown?: string | null;
  current_quarter?: number | null;
  live_clock_text?: string | null;
  venue?: string | null;
};

interface LiveGameScoresPanelProps {
  season?: number | null;
  round?: number | null;
  title?: string;
  subtitle?: string;
  emptyLabel?: string;
  compact?: boolean;
}

type ScoreEvent = {
  side: 'home' | 'away';
  label: 'GOAL' | 'BEHIND';
};

function formatStatusLabel(match: LiveMatch): string {
  if (match.status === 'in_progress') return 'Live now';
  if (match.status === 'final') return 'Final';
  return 'Scheduled';
}

function formatStartTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Time TBC';
  return date.toLocaleString('en-AU', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatLiveProgress(match: LiveMatch): string | null {
  if (typeof match.current_quarter !== 'number' || !Number.isFinite(match.current_quarter)) {
    return null;
  }

  if (match.live_clock_text && match.live_clock_text.trim().length > 0) {
    return `Q${match.current_quarter} • ${match.live_clock_text} elapsed`;
  }

  return `Q${match.current_quarter}`;
}

function formatSecondaryMeta(match: LiveMatch): string {
  const parts: string[] = [];
  if (match.venue) parts.push(match.venue);
  parts.push(`Round ${match.round_number}`);
  return parts.join(' • ');
}

function getScoreTone(match: LiveMatch, side: 'home' | 'away'): string {
  if (typeof match.home_score !== 'number' || typeof match.away_score !== 'number') {
    return 'text-white';
  }

  if (match.home_score === match.away_score) {
    return 'text-amber-300';
  }

  const homeIsLeading = match.home_score > match.away_score;
  const isLeadingSide = side === 'home' ? homeIsLeading : !homeIsLeading;
  return isLeadingSide ? 'text-white' : 'text-slate-400';
}

function getSideState(
  match: LiveMatch,
  side: 'home' | 'away'
): 'leading' | 'trailing' | 'tied' | 'neutral' {
  if (typeof match.home_score !== 'number' || typeof match.away_score !== 'number') {
    return 'neutral';
  }

  if (match.home_score === match.away_score) {
    return 'tied';
  }

  const homeIsLeading = match.home_score > match.away_score;
  const isLeadingSide = side === 'home' ? homeIsLeading : !homeIsLeading;
  return isLeadingSide ? 'leading' : 'trailing';
}

export default function LiveGameScoresPanel({
  season,
  round,
  title = 'Live AFL scores',
  subtitle = 'Current match scores from the live AFL feed.',
  emptyLabel = 'No live AFL games right now.',
  compact = false,
}: LiveGameScoresPanelProps) {
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scoreEvents, setScoreEvents] = useState<Record<string, ScoreEvent>>({});

  useEffect(() => {
    let cancelled = false;
    let clearEventTimeout: number | null = null;

    const loadMatches = async () => {
      try {
        setError(null);
        const response = await fetch('/api/etl/live-matches', {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error('Failed to load live match scores');
        }
        const nextMatches = Array.isArray(payload?.data) ? (payload.data as LiveMatch[]) : [];
        if (!cancelled) {
          setMatches((previousMatches) => {
            const previousById = new Map(
              previousMatches.map((match) => [
                match.id ??
                  match.match_uid ??
                  `${match.home_team}-${match.away_team}-${match.start_time_utc}`,
                match,
              ])
            );
            const nextEvents: Record<string, ScoreEvent> = {};

            for (const match of nextMatches) {
              const key =
                match.id ??
                match.match_uid ??
                `${match.home_team}-${match.away_team}-${match.start_time_utc}`;
              const previous = previousById.get(key);
              if (
                previous &&
                typeof match.home_score === 'number' &&
                typeof match.away_score === 'number' &&
                typeof previous.home_score === 'number' &&
                typeof previous.away_score === 'number'
              ) {
                const homeDelta = match.home_score - previous.home_score;
                const awayDelta = match.away_score - previous.away_score;

                if (homeDelta === 6) {
                  nextEvents[key] = { side: 'home', label: 'GOAL' };
                } else if (homeDelta === 1) {
                  nextEvents[key] = { side: 'home', label: 'BEHIND' };
                } else if (awayDelta === 6) {
                  nextEvents[key] = { side: 'away', label: 'GOAL' };
                } else if (awayDelta === 1) {
                  nextEvents[key] = { side: 'away', label: 'BEHIND' };
                }
              }
            }

            if (Object.keys(nextEvents).length > 0) {
              setScoreEvents(nextEvents);
              if (clearEventTimeout) {
                window.clearTimeout(clearEventTimeout);
              }
              clearEventTimeout = window.setTimeout(() => {
                setScoreEvents({});
              }, 5000);
            }

            return nextMatches;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load live match scores');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadMatches();
    const intervalId = window.setInterval(() => {
      void loadMatches();
    }, 30000);

    return () => {
      cancelled = true;
      if (clearEventTimeout) {
        window.clearTimeout(clearEventTimeout);
      }
      window.clearInterval(intervalId);
    };
  }, []);

  const visibleMatches = useMemo(() => {
    return matches.filter((match) => {
      if (season != null && match.season !== season) return false;
      if (round != null && match.round_number !== round) return false;
      return true;
    });
  }, [matches, round, season]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">
            {title}
          </p>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {visibleMatches.length > 0 ? (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
            {visibleMatches.length} live
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading scores...
        </div>
      ) : error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-700">
          {error}
        </div>
      ) : visibleMatches.length === 0 ? (
        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        <div className={`mt-4 grid gap-3 ${compact ? '' : 'xl:grid-cols-2'}`}>
          {visibleMatches.map((match) => {
            const hasScore =
              typeof match.home_score === 'number' && typeof match.away_score === 'number';
            const matchKey =
              match.id ??
              match.match_uid ??
              `${match.home_team}-${match.away_team}-${match.start_time_utc}`;
            const scoreEvent = scoreEvents[matchKey];
            const liveProgress = formatLiveProgress(match);
            const homeState = getSideState(match, 'home');
            const awayState = getSideState(match, 'away');

            return (
              <div
                key={matchKey}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.28)]"
              >
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ring-1 ring-inset ${
                      match.status === 'in_progress'
                        ? 'bg-red-600 text-white ring-red-600'
                        : match.status === 'final'
                          ? 'bg-slate-900 text-white ring-slate-900'
                          : 'bg-white text-slate-600 ring-slate-200'
                    }`}
                  >
                    {formatStatusLabel(match)}
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">
                    {formatStartTime(match.start_time_utc)}
                  </span>
                </div>

                <div className="px-4 py-2">
                  {liveProgress ? (
                    <div className="mb-0.5 flex items-center justify-center">
                      <span className="inline-flex min-w-[154px] items-center justify-center rounded-lg bg-slate-900 px-3 py-0.5 text-[11px] font-bold tracking-[0.14em] text-white shadow-sm">
                        {liveProgress}
                      </span>
                    </div>
                  ) : null}

                  <div className="mx-auto grid w-full max-w-[560px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                    <div className="min-w-0 pr-1.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {homeState === 'leading' ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-slate-500/70"
                            aria-hidden="true"
                          />
                        ) : null}
                        <p
                          className={`min-w-0 truncate text-lg tracking-tight ${
                            homeState === 'leading'
                              ? 'font-black text-slate-950'
                              : homeState === 'trailing'
                                ? 'font-bold text-slate-700'
                                : 'font-extrabold text-slate-950'
                          }`}
                        >
                          {match.home_team}
                        </p>
                        <TeamLogo team={match.home_team} size={compact ? 24 : 28} withCircle />
                      </div>
                      {match.home_score_breakdown ? (
                        <p
                          className={`mt-0.5 text-xs ${
                            homeState === 'leading'
                              ? 'font-semibold text-slate-700'
                              : homeState === 'trailing'
                                ? 'font-medium text-slate-500'
                                : 'font-semibold text-slate-600'
                          }`}
                        >
                          {match.home_score_breakdown} ({match.home_score ?? '-'})
                        </p>
                      ) : null}
                    </div>

                    <div className="flex w-[154px] justify-center">
                      {hasScore ? (
                        <div className="relative w-full overflow-hidden rounded-xl bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 px-4 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_6px_12px_-16px_rgba(15,23,42,0.24),0_1px_2px_rgba(15,23,42,0.06)]">
                          <div className="flex items-center justify-center gap-3 text-3xl font-black tabular-nums tracking-tight">
                            <span className={getScoreTone(match, 'home')}>{match.home_score}</span>
                            <span className="text-slate-600">-</span>
                            <span className={getScoreTone(match, 'away')}>{match.away_score}</span>
                          </div>
                          {scoreEvent ? (
                            <div
                              className="pointer-events-none absolute inset-0 flex animate-[score-curtain_3000ms_cubic-bezier(0.22,1,0.36,1)_forwards] items-center justify-center bg-gradient-to-r from-black via-slate-900 to-black text-2xl font-black uppercase tracking-[0.5em] text-white shadow-[0_0_56px_rgba(255,255,255,0.14)_inset]"
                              aria-hidden="true"
                            >
                              <span className="score-curtain-text">{scoreEvent.label}</span>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="w-full text-center text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
                          vs
                        </p>
                      )}
                    </div>

                    <div className="min-w-0 pl-1.5 text-left">
                      <div className="flex items-center gap-2">
                        <TeamLogo team={match.away_team} size={compact ? 24 : 28} withCircle />
                        <p
                          className={`min-w-0 truncate text-lg tracking-tight ${
                            awayState === 'leading'
                              ? 'font-black text-slate-950'
                              : awayState === 'trailing'
                                ? 'font-bold text-slate-700'
                                : 'font-extrabold text-slate-950'
                          }`}
                        >
                          {match.away_team}
                        </p>
                        {awayState === 'leading' ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-slate-500/70"
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                      {match.away_score_breakdown ? (
                        <p
                          className={`mt-0.5 text-xs ${
                            awayState === 'leading'
                              ? 'font-semibold text-slate-700'
                              : awayState === 'trailing'
                                ? 'font-medium text-slate-500'
                                : 'font-semibold text-slate-600'
                          }`}
                        >
                          {match.away_score_breakdown} ({match.away_score ?? '-'})
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-slate-50 px-4 py-1 text-sm text-slate-500">
                  {formatSecondaryMeta(match)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes score-curtain {
          0% {
            transform: translateX(-102%);
            opacity: 0.2;
          }
          12%,
          82% {
            transform: translateX(0);
            opacity: 1;
          }
          100% {
            transform: translateX(102%);
            opacity: 0.2;
          }
        }

        .score-curtain-text {
          transform: scale(0.92);
          animation: score-curtain-pulse 3000ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        @keyframes score-curtain-pulse {
          0% {
            transform: scale(0.86);
            letter-spacing: 0.35em;
          }
          16%,
          82% {
            transform: scale(1);
            letter-spacing: 0.45em;
          }
          100% {
            transform: scale(0.9);
            letter-spacing: 0.38em;
          }
        }
      `}</style>
    </section>
  );
}
