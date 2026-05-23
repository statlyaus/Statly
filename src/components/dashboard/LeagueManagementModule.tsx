'use client';

import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight, Plus, RefreshCw, Users } from 'lucide-react';
import type { User } from 'firebase/auth';

import type { League } from '@/types/leagues';

interface LeagueSummary extends League {
  memberCount?: number;
  teamName?: string;
}

interface LeagueManagementModuleProps {
  user: User;
  refreshTrigger?: number;
}

function getLeagueMemberCount(league: LeagueSummary): number {
  if (typeof league.memberCount === 'number') return league.memberCount;
  if (typeof league.currentTeams === 'number') return league.currentTeams;
  return 0;
}

function OnboardingActions(): ReactElement {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Link
        href="/leagues/new"
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <Plus className="size-4" aria-hidden="true" />
        Create league
      </Link>
      <Link
        href="/leagues/join"
        className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <Users className="size-4" aria-hidden="true" />
        Join league
      </Link>
    </div>
  );
}

function LeagueOnboardingPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <section className="flex h-full min-h-56 flex-col justify-center rounded-lg border border-border bg-card p-5 text-card-foreground">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-foreground">
        <Users className="size-6" aria-hidden="true" />
      </div>
      <div className="mt-4 text-center">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function LeagueManagementModule({
  user,
  refreshTrigger,
}: LeagueManagementModuleProps): ReactElement {
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUserLeagues = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      if (!user?.uid) {
        throw new Error('User not authenticated');
      }

      const membershipsResponse = await fetch(`/api/leagues/user/${user.uid}`);

      if (!membershipsResponse.ok) {
        throw new Error('Failed to load leagues');
      }

      const membershipsData = (await membershipsResponse.json()) as {
        leagues?: unknown;
        data?: { leagues?: unknown };
      };
      const leagues = membershipsData.leagues ?? membershipsData.data?.leagues ?? [];

      if (!Array.isArray(leagues)) {
        setLeagues([]);
        return;
      }

      setLeagues(leagues as LeagueSummary[]);
    } catch (err) {
      console.error('Error fetching user leagues:', err);
      setError(err instanceof Error ? err.message : 'Failed to load leagues');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void fetchUserLeagues();
  }, [fetchUserLeagues, refreshTrigger]);

  if (loading) {
    return (
      <div
        className="flex min-h-36 items-center justify-center rounded-lg border border-border bg-card"
        role="status"
        aria-live="polite"
      >
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <span className="sr-only">Loading leagues</span>
      </div>
    );
  }

  if (error) {
    return (
      <LeagueOnboardingPanel
        title="League list unavailable"
        description="Retry the league lookup, or use the setup actions to create or join a league."
      >
        <div className="space-y-4">
          <div className="rounded-md border border-destructive bg-card p-3" role="alert">
            <p className="text-sm text-destructive">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => void fetchUserLeagues()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </button>
          <OnboardingActions />
        </div>
      </LeagueOnboardingPanel>
    );
  }

  if (leagues.length === 0) {
    return (
      <LeagueOnboardingPanel
        title="Start your league workspace"
        description="Create a competition as commissioner or join an existing league with an invite code."
      >
        <OnboardingActions />
      </LeagueOnboardingPanel>
    );
  }

  const adminLeagueCount = leagues.filter((league) => league.ownerId === user.uid).length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <div className="text-lg font-semibold text-foreground">{leagues.length}</div>
          <div className="text-xs text-muted-foreground">Active Leagues</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-center">
          <div className="text-lg font-semibold text-foreground">{adminLeagueCount}</div>
          <div className="text-xs text-muted-foreground">Admin Of</div>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {leagues.slice(0, 4).map((league, index) => {
          const isAdmin = league.ownerId === user.uid;
          const memberCount = getLeagueMemberCount(league);

          return (
            <motion.div
              key={league.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
            >
              <Link
                href={`/leagues/${league.id}`}
                className="block rounded-lg border border-border bg-card p-3 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-semibold text-foreground">
                      {league.name}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {memberCount} / {league.maxTeams} teams
                    </p>
                  </div>
                  {isAdmin ? (
                    <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground">
                      Admin
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="truncate font-mono uppercase">{league.code}</span>
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    Open
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </span>
                </div>
                {league.description ? (
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {league.description}
                  </p>
                ) : null}
              </Link>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
        <Link
          href="/leagues/new"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Plus className="size-4" aria-hidden="true" />
          Create
        </Link>
        <Link
          href="/leagues"
          className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Browse leagues
        </Link>
      </div>

      {leagues.length > 4 ? (
        <div className="border-t border-border pt-3">
          <Link
            href="/leagues"
            className="block text-center text-sm font-medium text-foreground underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all {leagues.length} leagues
          </Link>
        </div>
      ) : null}
    </div>
  );
}
