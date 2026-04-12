'use client';

import React, { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { useAuth } from '@/AuthContext';
import { getLeagueOverview } from '@/lib/data/leagueApi';
import { getFirebaseDb } from '@/lib/firebaseClient';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { logger } from '@/lib/logger';

interface WaiversModuleProps {
  refreshTrigger: number;
}

interface LeagueWaiverSnapshot {
  leagueId: string;
  leagueName: string;
  nextRunIso: string;
  orderTop: Array<{ teamId: string; teamName: string }>;
}

function formatDateLabel(iso?: string | null) {
  if (!iso) return 'Not scheduled';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  return date.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function WaiversModule({ refreshTrigger }: WaiversModuleProps) {
  const { user } = useAuth();
  const { leagues } = useUserLeagues(user?.uid);
  const [snapshots, setSnapshots] = useState<LeagueWaiverSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadWaiverState = async () => {
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
            const overview = await getLeagueOverview(db, league.id, user.uid).catch(() => null);
            const nextRunIso = overview?.waiver?.nextRunIso;
            if (!nextRunIso) return null;

            return {
              leagueId: league.id,
              leagueName: league.name,
              nextRunIso,
              orderTop: overview.waiver?.orderTop ?? [],
            } satisfies LeagueWaiverSnapshot;
          })
        );

        if (active) {
          setSnapshots(
            results
              .filter((snapshot): snapshot is LeagueWaiverSnapshot => Boolean(snapshot))
              .sort((a, b) => new Date(a.nextRunIso).getTime() - new Date(b.nextRunIso).getTime())
          );
        }
      } catch (loadError) {
        logger.error('Failed to load waiver module state', loadError);
        if (active) {
          setSnapshots([]);
          setError('Waiver state is unavailable right now.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadWaiverState();

    return () => {
      active = false;
    };
  }, [refreshTrigger, leagues, user?.uid]);

  const nextRun = snapshots[0] ?? null;
  const topOrder = useMemo(() => nextRun?.orderTop.slice(0, 3) ?? [], [nextRun]);

  if (!user) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-900">Sign in required</p>
          <p className="mt-1 text-sm text-slate-600">
            Waiver state is tied to your league memberships.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="animate-pulse rounded-xl bg-slate-100 p-4">
            <div className="h-4 w-28 rounded bg-slate-200" />
            <div className="mt-3 h-3 w-40 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    );
  }

  if (!nextRun) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-900">No waiver run scheduled</p>
          <p className="mt-1 text-sm text-slate-600">
            Tracked leagues have not materialized their next waiver processing window yet.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/waivers"
            className="rounded-xl bg-[color:var(--league-primary)] px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
          >
            Open waivers
          </Link>
          <Link
            href="/leagues"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Open leagues
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Next run
        </p>
        <p className="mt-2 text-lg font-semibold text-slate-950">{nextRun.leagueName}</p>
        <p className="mt-1 text-sm text-slate-600">{formatDateLabel(nextRun.nextRunIso)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Tracked leagues
          </p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{snapshots.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Order shown
          </p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{topOrder.length}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">Waiver order preview</h4>
          <span className="text-xs text-slate-500">{nextRun.leagueName}</span>
        </div>
        {topOrder.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-600">
            No waiver priority order is materialized for the next run yet.
          </div>
        ) : (
          <div className="space-y-2">
            {topOrder.map((team, index) => (
              <div
                key={`${team.teamId}-${index}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-900">{team.teamName}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/waivers"
          className="rounded-xl bg-[color:var(--league-primary)] px-3 py-2 text-center text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
        >
          Open waivers
        </Link>
        <Link
          href={`/leagues/${nextRun.leagueId}?tab=waivers`}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Open league
        </Link>
      </div>
    </div>
  );
}
