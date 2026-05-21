'use client';

import React, { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { useAuth } from '@/AuthContext';
import { getLeagueOverview, type MatchupSummary } from '@/lib/data/leagueApi';
import { getFirebaseDb } from '@/lib/firebaseClient';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { logger } from '@/lib/logger';

interface LiveScoringModuleProps {
  refreshTrigger: number;
}

interface LeagueLiveSnapshot {
  leagueId: string;
  leagueName: string;
  roundLabel: string | null;
  roundStatus: string | null;
  matchup?: MatchupSummary;
}

interface SeasonStateRound {
  roundLabel: string;
  status: string;
  current: boolean;
}

function extractSchedule(payload: unknown): SeasonStateRound[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as {
    schedule?: SeasonStateRound[];
    data?: { schedule?: SeasonStateRound[] };
  } | null;

  if (Array.isArray(body?.data?.schedule)) {
    return body.data.schedule;
  }
  if (Array.isArray(body?.schedule)) {
    return body.schedule;
  }
  return [];
}

function formatRoundStatus(status?: string | null) {
  if (!status) return 'Schedule pending';
  return status.replace(/_/g, ' ');
}

function getCategoryTone(delta: number) {
  if (delta > 0) return 'text-success bg-success/10';
  if (delta < 0) return 'text-destructive bg-destructive/10';
  return 'text-foreground bg-muted';
}

export default function LiveScoringModule({ refreshTrigger }: LiveScoringModuleProps) {
  const { user } = useAuth();
  const { leagues } = useUserLeagues(user?.uid);
  const [snapshots, setSnapshots] = useState<LeagueLiveSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadLiveState = async () => {
      if (!user?.uid || leagues.length === 0) {
        setSnapshots([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const db = getFirebaseDb();
        const results = await Promise.all(
          leagues.slice(0, 6).map(async (league) => {
            const [overview, seasonStatePayload] = await Promise.all([
              getLeagueOverview(db, league.id, user.uid).catch(() => null),
              fetch(`/api/leagues/${league.id}/season-state`, {
                credentials: 'include',
                cache: 'no-store',
              })
                .then(async (response) => (response.ok ? response.json() : null))
                .catch(() => null),
            ]);

            if (!overview?.matchup) return null;

            const schedule = extractSchedule(seasonStatePayload);
            const currentRound =
              schedule.find((round) => round.current) ??
              schedule.find((round) => round.status === 'in_progress') ??
              schedule.find((round) => round.status !== 'final') ??
              null;

            const snapshot: LeagueLiveSnapshot = {
              leagueId: league.id,
              leagueName: league.name,
              roundLabel: currentRound?.roundLabel ?? overview.matchup.roundLabel ?? null,
              roundStatus: currentRound?.status ?? null,
              matchup: overview.matchup,
            };

            return snapshot;
          })
        );

        if (active) {
          setSnapshots(
            results.filter((snapshot): snapshot is LeagueLiveSnapshot => Boolean(snapshot))
          );
        }
      } catch (loadError) {
        logger.error('Failed to load live scoring module state', loadError);
        if (active) {
          setSnapshots([]);
          setError('Live matchup data is unavailable right now.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadLiveState();

    return () => {
      active = false;
    };
  }, [refreshTrigger, leagues, user?.uid]);

  const prioritizedSnapshots = useMemo(
    () =>
      [...snapshots].sort((a, b) => {
        const aLive = a.roundStatus === 'in_progress' ? 0 : 1;
        const bLive = b.roundStatus === 'in_progress' ? 0 : 1;
        return aLive - bLive;
      }),
    [snapshots]
  );
  const featured = prioritizedSnapshots[0] ?? null;
  const categoryLeads = featured?.matchup?.categoryLeads?.slice(0, 3) ?? [];

  if (!user) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center">
        <p className="text-sm font-medium text-foreground">Sign in required</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Live matchup state is only available for your leagues.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="animate-pulse rounded-xl bg-muted p-4">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="mt-3 h-3 w-48 rounded bg-muted" />
            <div className="mt-2 h-3 w-32 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (!featured?.matchup) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm font-medium text-foreground">No live matchup view available</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your tracked leagues have not materialized a current matchup summary yet.
          </p>
        </div>
        {error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/leagues"
            className="rounded-xl bg-[color:var(--league-primary)] px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
          >
            Open leagues
          </Link>
          <Link
            href="/players"
            className="rounded-xl border border-border bg-white px-3 py-2 text-center text-sm font-semibold text-foreground transition hover:bg-muted"
          >
            Research players
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">
              Featured matchup
            </p>
            <p className="mt-2 text-lg font-semibold text-foreground">{featured.leagueName}</p>
          </div>
          {featured.roundStatus === 'in_progress' ? (
            <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-success">
              Live
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {featured.roundLabel ?? 'Current round'} • {formatRoundStatus(featured.roundStatus)}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-white px-3 py-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Opponent
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {featured.matchup.opponentTeam.name}
            </p>
          </div>
          <div className="rounded-xl bg-white px-3 py-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Actual
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {featured.matchup.actual != null ? Math.round(featured.matchup.actual) : 'Pending'}
            </p>
          </div>
          <div className="rounded-xl bg-white px-3 py-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Projected
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {featured.matchup.projected != null
                ? Math.round(featured.matchup.projected)
                : 'Pending'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Category pulse</h4>
          <span className="text-xs text-muted-foreground">{featured.matchup.roundLabel}</span>
        </div>
        {categoryLeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
            Category-level live scoring is not available for this matchup yet.
          </div>
        ) : (
          <div className="space-y-2">
            {categoryLeads.map((category) => {
              const delta = category.you - category.opp;
              return (
                <div
                  key={category.key}
                  className="flex items-center justify-between rounded-xl border border-border bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{category.key}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      You {category.you} • Opp {category.opp}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getCategoryTone(delta)}`}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {prioritizedSnapshots.length > 1 ? (
        <div className="rounded-xl border border-border bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Other leagues tracked
          </p>
          <div className="mt-3 space-y-2">
            {prioritizedSnapshots.slice(1, 4).map((league) => (
              <div key={league.leagueId} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{league.leagueName}</p>
                  <p className="text-xs text-muted-foreground">
                    {league.roundLabel ?? 'Current round'} • {formatRoundStatus(league.roundStatus)}
                  </p>
                </div>
                <Link
                  href={`/leagues/${league.leagueId}?tab=matchup`}
                  className="text-xs font-semibold text-[color:var(--league-primary)] hover:text-[color:var(--league-primary-hover)]"
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/leagues/${featured.leagueId}?tab=matchup`}
          className="rounded-xl bg-[color:var(--league-primary)] px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
        >
          Open matchup
        </Link>
        <Link
          href="/leagues"
          className="rounded-xl border border-border bg-white px-3 py-2 text-center text-sm font-semibold text-foreground transition hover:bg-muted"
        >
          Open leagues
        </Link>
      </div>
    </div>
  );
}
