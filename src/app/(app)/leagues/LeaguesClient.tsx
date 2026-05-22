'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { useAuth } from '@/AuthContext';
import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import { AppLayout } from '@/components/navigation';
import { buttonVariants } from '@/components/ui/button';
import { fetchApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { UserLeagueSummary } from '@/types/leagues';

import { LeagueOnboardingEntry } from './_components/LeagueOnboardingEntry';

function LeagueCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-sm">
      <div className="h-4 w-24 rounded bg-[color:var(--league-surface-muted)]" />
      <div className="mt-4 h-7 w-48 rounded bg-[color:var(--league-surface-muted)]" />
      <div className="mt-3 h-4 w-full rounded bg-[color:var(--league-surface-muted)]" />
      <div className="mt-2 h-4 w-2/3 rounded bg-[color:var(--league-surface-muted)]" />
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="h-20 rounded-2xl bg-[color:var(--league-surface-muted)]" />
        <div className="h-20 rounded-2xl bg-[color:var(--league-surface-muted)]" />
      </div>
      <div className="mt-6 h-11 rounded-full bg-[color:var(--league-surface-muted)]" />
    </div>
  );
}

export default function LeaguesClient() {
  const [leagues, setLeagues] = useState<UserLeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();

  const loadLeagues = useCallback(async () => {
    if (!user) {
      setLoading(false);
      setError(null);
      setLeagues([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await fetchApi(`leagues/user/${user.uid}`);
      const list = Array.isArray(response)
        ? response
        : response?.leagues
          ? response.leagues
          : response?.data?.leagues || [];
      setLeagues(list as UserLeagueSummary[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to fetch leagues.');
      setLeagues([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;

    void loadLeagues();
  }, [authLoading, loadLeagues]);

  const activeLeague = leagues[0] ?? null;
  const statusChips = useMemo(
    () => [
      {
        label: `${leagues.length} League${leagues.length === 1 ? '' : 's'}`,
        tone: 'accent' as const,
      },
      user
        ? { label: 'Signed in', tone: 'success' as const }
        : { label: 'Sign in required', tone: 'warning' as const },
    ],
    [leagues.length, user]
  );

  return (
    <AppLayout>
      <main className="min-h-screen bg-[color:var(--league-page)]">
        <div className="mx-auto w-full max-w-[var(--app-shell-max-width)] px-4 py-6 sm:px-6 lg:px-8 2xl:px-10">
          <LeagueViewHeader
            eyebrow="League center"
            title="Choose your league workspace"
            description="Move straight into the right competition, see which leagues need attention, and keep league selection inside the same design system as the rest of the app."
            chips={statusChips}
            actions={
              <>
                <Link
                  href="/leagues/join"
                  className={cn(buttonVariants({ variant: 'secondary', size: 'md' }), 'rounded-full')}
                >
                  Join league
                </Link>
                <Link
                  href="/leagues/new"
                  className={cn(buttonVariants({ variant: 'primary', size: 'md' }), 'rounded-full')}
                >
                  Create league
                </Link>
              </>
            }
            aside={
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--league-text-muted)]">
                    Next step
                  </p>
                  <h2 className="mt-3 text-xl font-semibold text-[color:var(--league-text)]">
                    {activeLeague
                      ? activeLeague.name
                      : user
                        ? 'Select a league'
                        : 'Sign in to continue'}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
                    {activeLeague
                      ? 'Open the league workspace to review matchup state, ladder movement, waivers, and roster decisions.'
                      : user
                        ? 'Your leagues will appear here once they load. From there you can move directly into the league workspace.'
                        : 'League selection depends on your signed-in account, so sign in first to load your competitions.'}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {activeLeague ? (
                      <Link
                        href={`/leagues/${activeLeague.id}`}
                        className="inline-flex items-center rounded-full bg-[color:var(--league-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
                      >
                        Open active league
                      </Link>
                    ) : null}
                    <Link
                      href="/players"
                      className="inline-flex items-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2.5 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)]"
                    >
                      Player research
                    </Link>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                  <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                      Leagues
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[color:var(--league-text)]">
                      {loading ? '...' : leagues.length}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                      Formats
                    </p>
                    <p className="mt-2 text-2xl font-semibold capitalize text-[color:var(--league-text)]">
                      {loading ? '...' : new Set(leagues.map((league) => league.type)).size || 0}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                      Capacity
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[color:var(--league-text)]">
                      {loading
                        ? '...'
                        : leagues.reduce((sum, league) => sum + (league.maxTeams ?? 0), 0)}
                    </p>
                  </div>
                </div>
              </div>
            }
          />

          <section className="mt-6">
            {loading ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <LeagueCardSkeleton key={index} />
                ))}
              </div>
            ) : error ? (
              <LeagueOnboardingEntry
                title="League list unavailable"
                description="Retry loading your memberships, or continue by creating a new league or joining with an invite code."
                error={{
                  title: 'Failed to load leagues',
                  message: error,
                  retryLabel: 'Retry',
                  onRetry: loadLeagues,
                }}
              />
            ) : !user ? (
              <div className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-8 text-center shadow-sm">
                <h2 className="text-xl font-semibold text-[color:var(--league-text)]">
                  Sign in to view your leagues
                </h2>
                <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
                  League selection is tied to your account, so the league hub stays empty until you
                  authenticate.
                </p>
              </div>
            ) : leagues.length > 0 ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {leagues.map((league) => (
                  <Link key={league.id} href={`/leagues/${league.id}`} className="group block">
                    <article className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-sm transition hover:-translate-y-1 hover:border-[color:var(--league-accent)] hover:shadow-[0_28px_60px_-40px_rgba(23,34,48,0.28)]">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                            League
                          </p>
                          <h3 className="mt-3 truncate text-xl font-semibold text-[color:var(--league-text)]">
                            {league.name}
                          </h3>
                          <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
                            Code {league.code}
                          </p>
                        </div>
                        <span className="rounded-full bg-[color:var(--league-primary-soft)] px-3 py-1 text-xs font-semibold capitalize text-[color:var(--league-primary)]">
                          {league.status}
                        </span>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                            Format
                          </p>
                          <p className="mt-2 text-base font-semibold capitalize text-[color:var(--league-text)]">
                            {league.type}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                            Team cap
                          </p>
                          <p className="mt-2 text-base font-semibold text-[color:var(--league-text)]">
                            {league.maxTeams}
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                          Categories
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--league-text)]">
                          {league.categories.length} scoring categories configured.
                        </p>
                      </div>

                      <div className="mt-5 flex items-center justify-between text-sm font-semibold text-[color:var(--league-primary)]">
                        <span>Open league workspace</span>
                        <span className="transition group-hover:translate-x-0.5">→</span>
                      </div>
                    </article>
                  </Link>
                ))}
              </div>
            ) : (
              <LeagueOnboardingEntry
                title="Start your league workspace"
                description="Create a competition as commissioner or join an existing league with an invite code. Both paths keep setup, invites, and draft readiness visible."
              />
            )}
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
