'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { motion } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
import { usePlayerStatsAggregate } from '@/hooks/usePlayerStats';

interface LeaderboardModuleProps {
  refreshTrigger: number;
}

interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  team: string;
  points: number;
  games: number;
}

export default function LeaderboardModule({ refreshTrigger }: LeaderboardModuleProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const {
    data: playerStats,
    loading,
    error,
    season,
    refetch,
  } = usePlayerStatsAggregate(undefined, {
    limit: 100,
  });

  useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  useEffect(() => {
    if (!playerStats || playerStats.length === 0) {
      setLeaderboard([]);
      return;
    }

    const entries: LeaderboardEntry[] = [...playerStats]
      .sort((a, b) => b.fantasy_points - a.fantasy_points)
      .slice(0, 8)
      .map((stat, index) => ({
        id: stat.player_id,
        rank: index + 1,
        name: stat.player_name,
        team: stat.team,
        points: stat.fantasy_points,
        games: stat.games,
      }));

    setLeaderboard(entries);
  }, [playerStats]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="animate-pulse rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-slate-200" />
                <div className="h-4 w-28 rounded bg-slate-200" />
              </div>
              <div className="h-4 w-16 rounded bg-slate-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-slate-900">No season leaders yet</p>
        <p className="mt-1 text-sm text-slate-600">
          Player leaderboard data will appear once season aggregates are available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {season ? `${season} season leaders` : 'Season leaders'}
        </p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          Live aggregate
        </span>
      </div>

      <div className="space-y-2">
        {leaderboard.map((entry, index) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.06 }}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700">
                {entry.rank}
              </div>
              <div>
                <p className="font-medium text-slate-900">{entry.name}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {entry.team ? (
                    <TeamLogo
                      team={entry.team}
                      size={18}
                      withCircle
                      decorative
                      className="shrink-0"
                    />
                  ) : null}
                  <span>
                    {entry.team || '—'} • {entry.games} games
                  </span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-900">{entry.points.toLocaleString()}</p>
              <p className="text-xs text-slate-500">fantasy pts</p>
            </div>
          </motion.div>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Failed to load leaderboard: {error}
        </div>
      ) : null}

      <div className="pt-2">
        <Link
          href="/rankings"
          className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Open rankings
        </Link>
      </div>
    </div>
  );
}
