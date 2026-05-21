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
            className="animate-pulse rounded-xl border border-border bg-muted p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="h-4 w-28 rounded bg-muted" />
              </div>
              <div className="h-4 w-16 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-6 text-center"
        >
          <p className="text-sm font-semibold text-destructive">Leaderboard unavailable</p>
          <p className="mt-1 text-sm text-destructive">
            Failed to load leaderboard: {error}
          </p>
        </div>
        <div className="pt-2">
          <Link
            href="/rankings"
            className="inline-flex w-full items-center justify-center rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-muted"
          >
            Open rankings
          </Link>
        </div>
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted px-4 py-6 text-center">
        <p className="text-sm font-semibold text-foreground">No season leaders yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Player leaderboard data will appear once season aggregates are available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {season ? `${season} season leaders` : 'Season leaders'}
        </p>
        <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
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
            className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white text-sm font-semibold text-foreground">
                {entry.rank}
              </div>
              <div>
                <p className="font-medium text-foreground">{entry.name}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
              <p className="font-semibold text-foreground">{entry.points.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">fantasy pts</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="pt-2">
        <Link
          href="/rankings"
          className="inline-flex w-full items-center justify-center rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-muted"
        >
          Open rankings
        </Link>
      </div>
    </div>
  );
}
