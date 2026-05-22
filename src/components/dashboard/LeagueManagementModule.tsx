'use client';

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';

import { motion } from 'framer-motion';

import { LeagueOnboardingEntry } from '@/app/(app)/leagues/_components/LeagueOnboardingEntry';
import type { UserLeagueSummary } from '@/types/leagues';

import type { User } from 'firebase/auth';

interface LeagueManagementModuleProps {
  user: User;
  refreshTrigger?: number;
}

export default function LeagueManagementModule({
  user,
  refreshTrigger,
}: LeagueManagementModuleProps) {
  const [leagues, setLeagues] = useState<UserLeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUserLeagues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (!user?.uid) {
        throw new Error('User not authenticated');
      }

      const membershipsResponse = await fetch(`/api/leagues/user/${user.uid}`);

      if (!membershipsResponse.ok) {
        throw new Error('Failed to fetch user league memberships');
      }

      const membershipsData = await membershipsResponse.json();

      const leagues = membershipsData.leagues || membershipsData.data?.leagues || [];
      if (!Array.isArray(leagues)) {
        setLeagues([]);
        return;
      }

      setLeagues(leagues);
    } catch (err) {
      console.error('Error fetching user leagues:', err);
      setError('Failed to load leagues');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchUserLeagues();
  }, [fetchUserLeagues, refreshTrigger]);

  if (loading) {
    return (
      <div className="flex min-h-36 items-center justify-center rounded-xl border border-border bg-muted">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-slate-700"></div>
      </div>
    );
  }

  if (error) {
    return (
      <LeagueOnboardingEntry
        variant="compact"
        title="League list unavailable"
        description="Retry the league lookup, or use the guided setup flow to create or join a league."
        error={{
          title: 'Failed to load leagues',
          message: error,
          retryLabel: 'Retry',
          onRetry: fetchUserLeagues,
        }}
      />
    );
  }

  if (leagues.length === 0) {
    return (
      <LeagueOnboardingEntry
        variant="compact"
        title="Start your league workspace"
        description="Create a competition as commissioner or join an existing league with an invite code."
      />
    );
  }

  const adminLeagueCount = leagues.filter((league) => league.ownerId === user.uid).length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-muted p-3 text-center">
          <div className="text-lg font-semibold text-foreground">{leagues.length}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Active Leagues
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted p-3 text-center">
          <div className="text-lg font-semibold text-foreground">{adminLeagueCount}</div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Admin Of
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {leagues.slice(0, 4).map((league, index) => {
          const isAdmin = league.ownerId === user.uid;

          return (
            <motion.div
              key={league.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
            >
              <Link
                href={`/leagues/${league.id}`}
                className="block rounded-xl border border-border bg-muted px-3 py-3 transition hover:border-border hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-foreground">{league.name}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {league.memberCount} / {league.maxTeams} teams
                    </p>
                  </div>
                  {isAdmin ? (
                    <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white">
                      Admin
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="truncate font-mono uppercase">{league.code}</span>
                  <span className="font-medium text-foreground">Open →</span>
                </div>
                {league.description ? (
                  <p className="mt-2 truncate text-xs text-muted-foreground">{league.description}</p>
                ) : null}
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
        <Link
          href="/leagues/new"
          className="inline-flex items-center justify-center rounded-xl bg-foreground px-3 py-2 text-xs font-semibold text-white transition hover:bg-muted"
        >
          Create
        </Link>
        <Link
          href="/leagues"
          className="inline-flex items-center justify-center rounded-xl border border-border bg-muted px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-white"
        >
          Browse leagues
        </Link>
      </div>

      {leagues.length > 4 ? (
        <div className="border-t border-border pt-3">
          <Link
            href="/leagues"
            className="block text-center text-sm font-medium text-foreground transition hover:text-foreground"
          >
            View all {leagues.length} leagues
          </Link>
        </div>
      ) : null}
    </div>
  );
}
