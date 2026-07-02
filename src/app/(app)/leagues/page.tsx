'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Plus,
  ShieldCheck,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react';

import { useAuth } from '@/AuthContext';
import { fetchApi } from '@/lib/api';
import type { League } from '@/types/leagues';
import { AppLayout } from '@/components/navigation';

function formatDraftDate(value?: string): string {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatStatusLabel(status: League['status']): string {
  return status.replace(/_/g, ' ');
}

function formatTeamCount(league: League): string {
  return typeof league.currentTeams === 'number'
    ? `${league.currentTeams}/${league.maxTeams} teams`
    : `${league.maxTeams} teams max`;
}

function formatLeagueCode(code?: string): string | null {
  if (!code) return null;
  if (code.startsWith('DRAFT_')) return 'Draft setup';
  return `Code ${code}`;
}

function getStatusIcon(status: League['status']) {
  return status === 'completed' ? CheckCircle2 : ShieldCheck;
}

export default function LeaguesPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      const getLeagues = async () => {
        try {
          setLoading(true);
          const response = await fetchApi(`leagues/user/${user.uid}`);

          let userLeagues: League[] = [];
          if (Array.isArray(response)) {
            userLeagues = response;
          } else if (response.leagues) {
            userLeagues = response.leagues;
          } else if (response.data?.leagues) {
            userLeagues = response.data.leagues;
          }

          setLeagues(userLeagues);
        } catch (error) {
          console.error('Failed to fetch leagues:', error);
        } finally {
          setLoading(false);
        }
      };
      getLeagues();
    } else {
      setLoading(false);
      setLeagues([]);
    }
  }, [user]);

  const activeCount = useMemo(
    () => leagues.filter((league) => league.status === 'active').length,
    [leagues]
  );

  return (
    <AppLayout>
      <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_44%,var(--league-surface-muted)_100%)] text-[color:var(--league-text)]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                  League workspace
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
                  My leagues
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--league-text-muted)] sm:text-base">
                  Manage commissioner duties, draft setup, rosters, trades, and waivers from a
                  consistent league command center.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  href="/leagues/join"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Join league
                </Link>
                <Link
                  href="/leagues/new"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New league
                </Link>
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Leagues', value: leagues.length, icon: Trophy },
              { label: 'Active', value: activeCount, icon: ShieldCheck },
              {
                label: 'Teams available',
                value: leagues.reduce((sum, league) => sum + Math.max(league.maxTeams || 0, 0), 0),
                icon: Users,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-[0_18px_55px_-44px_rgba(23,34,48,0.35)]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                        {item.label}
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-[color:var(--league-text)]">
                        {item.value}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          {loading ? (
            <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-8 text-center">
              <Loader2
                className="mx-auto h-8 w-8 animate-spin text-[color:var(--league-primary)]"
                aria-hidden="true"
              />
              <p className="mt-4 text-sm font-semibold text-[color:var(--league-text)]">
                Loading leagues
              </p>
            </section>
          ) : leagues.length > 0 ? (
            <section className="overflow-hidden rounded-[24px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_80px_-54px_rgba(23,34,48,0.48)]">
              <div className="flex flex-col gap-3 border-b border-[color:var(--league-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                    League directory
                  </p>
                  <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-3">
                    <h2 className="text-xl font-semibold tracking-tight text-[color:var(--league-text)]">
                      Open a workspace
                    </h2>
                    <p className="text-sm text-[color:var(--league-text-muted)]">
                      Review draft timing, scoring, and league state at a glance.
                    </p>
                  </div>
                </div>
                <p className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 py-1.5 text-xs font-semibold text-[color:var(--league-text)]">
                  {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'} available
                </p>
              </div>

              <div className="hidden border-b border-[color:var(--league-border)] bg-[color:var(--league-page)] px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--league-text-muted)] md:grid md:grid-cols-[minmax(0,1.8fr)_0.8fr_0.75fr_1fr_auto] md:items-center md:gap-4">
                <span>League</span>
                <span>Status</span>
                <span>Scoring</span>
                <span>Draft</span>
                <span className="text-right">Action</span>
              </div>

              <div className="divide-y divide-[color:var(--league-border)]">
                {leagues.map((league, index) => {
                  const StatusIcon = getStatusIcon(league.status);
                  const leagueCode = formatLeagueCode(league.code);

                  return (
                    <Link
                      href={`/leagues/${league.id}`}
                      key={league.id}
                      aria-label={`Open ${league.name} league command center`}
                      className="group relative grid gap-4 px-5 py-4 transition hover:bg-[color:var(--league-page)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--league-primary)] sm:px-6 md:grid-cols-[minmax(0,1.8fr)_0.8fr_0.75fr_1fr_auto] md:items-center md:gap-4"
                    >
                      <span
                        className="absolute bottom-3 left-0 top-3 w-1 rounded-r-full bg-transparent transition group-hover:bg-[color:var(--league-primary)]"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] text-xs font-semibold tabular-nums text-[color:var(--league-primary)]">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold tracking-tight text-[color:var(--league-text)]">
                              {league.name}
                            </h2>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[color:var(--league-text-muted)]">
                              <span>{formatTeamCount(league)}</span>
                              {leagueCode ? (
                                <span className="rounded-full bg-[color:var(--league-page)] px-2 py-0.5 text-xs font-medium text-[color:var(--league-text-muted)]">
                                  {leagueCode}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 md:block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--league-text-muted)] md:hidden">
                          Status
                        </span>
                        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-primary-soft)] px-2.5 py-1 text-xs font-semibold capitalize text-[color:var(--league-primary)]">
                          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {formatStatusLabel(league.status)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-3 md:block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--league-text-muted)] md:hidden">
                          Scoring
                        </span>
                        <span className="text-sm font-semibold text-[color:var(--league-text)]">
                          {league.categories.length} categories
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-3 md:block">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--league-text-muted)] md:hidden">
                          Draft
                        </span>
                        <span className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--league-text)]">
                          <CalendarClock
                            className="hidden h-4 w-4 text-[color:var(--league-text-muted)] lg:block"
                            aria-hidden="true"
                          />
                          {formatDraftDate(league.draftDate)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between border-t border-[color:var(--league-border)] pt-3 text-sm font-semibold text-[color:var(--league-primary)] md:justify-end md:border-t-0 md:pt-0">
                        <span className="md:sr-only">Open league command center</span>
                        <span className="inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1.5 transition group-hover:border-[color:var(--league-border)] group-hover:bg-[color:var(--league-surface)]">
                          <span className="hidden md:inline">Open</span>
                          <ArrowRight
                            className="h-4 w-4 transition group-hover:translate-x-0.5"
                            aria-hidden="true"
                          />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="rounded-[28px] border border-dashed border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]">
                <Trophy className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-[color:var(--league-text)]">
                No leagues yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--league-text-muted)]">
                Join an existing league with an invite code or create a league and invite managers
                from your command center.
              </p>
              <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/leagues/join"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Join league
                </Link>
                <Link
                  href="/leagues/new"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New league
                </Link>
              </div>
            </section>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
