'use client';

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { fetchApi } from '@/lib/api';
import {
  getLeagueOverview,
  type ActivityItem,
  type ActivityKind,
  type Membership,
} from '@/lib/data/leagueApi';
import { getFirebaseDb } from '@/lib/firebaseClient';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { logger } from '@/lib/logger';
import type { Player } from '@/types/players';

import LeaderboardModule from './dashboard/LeaderboardModule';
import LeagueManagementModule from './dashboard/LeagueManagementModule';
import LiveDraftModule from './dashboard/LiveDraftModule';
import QuickActionsModule from './dashboard/QuickActionsModule';
import RecentActivityModule from './dashboard/RecentActivityModule';
import StatsOverviewModule from './dashboard/StatsOverviewModule';
import WeekendSummaryModule from './dashboard/WeekendSummaryModule';

import type { User } from 'firebase/auth';

interface ModularDashboardProps {
  user: User;
}

interface UserLeague {
  id: string;
  name: string;
  teamName?: string;
  draftCompleted?: boolean;
}

interface SeasonStateRound {
  roundLabel: string;
  status: string;
  current: boolean;
}

interface LeagueSnapshot {
  id: string;
  name: string;
  teamName: string;
  role: Membership['role'];
  isLive: boolean;
  currentRoundLabel: string | null;
  currentRoundStatus: string | null;
  nextWaiverIso: string | null;
  nextEventLabel: string | null;
  nextEventIso: string | null;
  activity: ActivityItem[];
}

interface DashboardActivity {
  id: string;
  type: 'trade' | 'draft' | 'score' | 'injury' | 'waiver' | 'admin';
  message: string;
  timestamp: Date;
  urgent?: boolean;
}

function DashboardCard({
  eyebrow,
  title,
  description,
  children,
  accent = 'slate',
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  accent?: 'slate' | 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  const accentClass =
    accent === 'sky'
      ? 'from-sky-500/12 to-cyan-400/10 border-sky-200/70'
      : accent === 'emerald'
        ? 'from-emerald-500/12 to-teal-400/10 border-emerald-200/70'
        : accent === 'amber'
          ? 'from-amber-500/12 to-yellow-400/10 border-amber-200/70'
          : accent === 'rose'
            ? 'from-rose-500/12 to-orange-400/10 border-rose-200/70'
            : 'from-slate-500/10 to-slate-200/30 border-slate-200';

  return (
    <section
      className={`rounded-[1.5rem] border bg-gradient-to-br ${accentClass} bg-white p-5 shadow-[0_18px_45px_-32px_rgba(15,23,42,0.45)]`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function CommandLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-left transition hover:border-white/25 hover:bg-white/14"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs leading-5 text-white/70">{description}</p>
        </div>
        <span className="text-white/55 transition group-hover:translate-x-0.5 group-hover:text-white">
          →
        </span>
      </div>
    </Link>
  );
}

function extractSchedule(payload: unknown): SeasonStateRound[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as
    | { schedule?: SeasonStateRound[]; data?: { schedule?: SeasonStateRound[] } }
    | null;

  if (Array.isArray(body?.data?.schedule)) {
    return body.data.schedule;
  }
  if (Array.isArray(body?.schedule)) {
    return body.schedule;
  }
  return [];
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

function mapActivityKind(kind: ActivityKind): DashboardActivity['type'] {
  if (kind === 'waiver') return 'waiver';
  if (kind === 'admin') return 'admin';
  if (kind === 'draft') return 'draft';
  return 'trade';
}

export default function ModularDashboard({ user }: ModularDashboardProps): React.ReactElement {
  const [players, setPlayers] = useState<Player[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [leagueSnapshots, setLeagueSnapshots] = useState<LeagueSnapshot[]>([]);
  const [leagueStateLoading, setLeagueStateLoading] = useState(false);
  const { leagues: userLeagues, loading: leaguesLoading } = useUserLeagues(user.uid);

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const response = await fetchApi('players');
        const playersData = Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
            ? response
            : [];
        setPlayers(playersData as Player[]);
      } catch (error) {
        logger.error('Error fetching players:', error);
      }
    };

    void fetchPlayers();
  }, []);

  useEffect(() => {
    let active = true;

    const fetchLeagueSnapshots = async () => {
      if (!user.uid || userLeagues.length === 0) {
        setLeagueSnapshots([]);
        return;
      }

      setLeagueStateLoading(true);
      try {
        let db: ReturnType<typeof getFirebaseDb> | null = null;
        try {
          db = getFirebaseDb();
        } catch (dbError) {
          logger.warn('Dashboard league snapshots falling back without Firestore', {
            message: dbError instanceof Error ? dbError.message : String(dbError),
          });
        }
        const trackedLeagues = userLeagues.slice(0, 4);

        const snapshots = await Promise.all(
          trackedLeagues.map(async (league) => {
            const [overview, seasonStatePayload] = await Promise.all([
              db ? getLeagueOverview(db, league.id, user.uid).catch(() => null) : Promise.resolve(null),
              fetch(`/api/leagues/${league.id}/season-state`, {
                credentials: 'include',
                cache: 'no-store',
              })
                .then(async (response) => (response.ok ? response.json() : null))
                .catch(() => null),
            ]);

            if (!overview) return null;

            const schedule = extractSchedule(seasonStatePayload);
            const currentRound =
              schedule.find((round) => round.current) ??
              schedule.find((round) => round.status === 'in_progress') ??
              schedule.find((round) => round.status !== 'final') ??
              null;

            return {
              id: league.id,
              name: league.name,
              teamName: overview?.membership.teamName || league.teamName || league.name,
              role: overview?.membership.role ?? 'manager',
              isLive: currentRound?.status === 'in_progress',
              currentRoundLabel: currentRound?.roundLabel ?? null,
              currentRoundStatus: currentRound?.status ?? null,
              nextWaiverIso: overview?.waiver?.nextRunIso ?? null,
              nextEventLabel: overview?.league.nextEvent?.label ?? null,
              nextEventIso: overview?.league.nextEvent?.iso ?? null,
              activity: overview?.activity ?? [],
            } satisfies LeagueSnapshot;
          })
        );

        if (active) {
          setLeagueSnapshots(
            snapshots.filter((snapshot): snapshot is LeagueSnapshot => Boolean(snapshot))
          );
        }
      } catch (error) {
        logger.error('Failed to fetch dashboard league snapshots', error);
        if (active) setLeagueSnapshots([]);
      } finally {
        if (active) setLeagueStateLoading(false);
      }
    };

    void fetchLeagueSnapshots();

    return () => {
      active = false;
    };
  }, [refreshTrigger, user.uid, userLeagues]);

  const displayName = user.displayName || user.email || 'Manager';
  const draftPendingCount = userLeagues.filter(
    (league: UserLeague) => league.draftCompleted === false
  ).length;
  const liveLeagueCount = leagueSnapshots.filter(
    (league: LeagueSnapshot) => league.isLive
  ).length;
  const nextWaiverLeague = useMemo(
    () =>
      [...leagueSnapshots]
        .filter((league: LeagueSnapshot) => league.nextWaiverIso)
        .sort((a, b) => new Date(a.nextWaiverIso ?? '').getTime() - new Date(b.nextWaiverIso ?? '').getTime())[0] ??
      null,
    [leagueSnapshots]
  );
  const nextEventLeague = useMemo(
    () =>
      [...leagueSnapshots]
        .filter((league: LeagueSnapshot) => league.nextEventIso)
        .sort((a, b) => new Date(a.nextEventIso ?? '').getTime() - new Date(b.nextEventIso ?? '').getTime())[0] ??
      null,
    [leagueSnapshots]
  );
  const dashboardActivities = useMemo<DashboardActivity[]>(() => {
    return leagueSnapshots
      .flatMap((league) =>
        league.activity.map((activity) => ({
          id: `${league.id}:${activity.id}`,
          type: mapActivityKind(activity.kind),
          message: `${league.name}: ${activity.text}`,
          timestamp: new Date(activity.iso),
          urgent: league.isLive && activity.kind === 'waiver',
        }))
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 8);
  }, [leagueSnapshots]);

  const overviewStats = [
    { label: 'My Leagues', value: userLeagues.length, format: 'number' as const },
    { label: 'Live Rounds', value: liveLeagueCount, format: 'number' as const },
    { label: 'Drafts Pending', value: draftPendingCount, format: 'number' as const },
    { label: 'Player Pool', value: players.length, format: 'number' as const },
    {
      label: 'Next Waiver',
      value: nextWaiverLeague ? formatDateLabel(nextWaiverLeague.nextWaiverIso) : 'Not scheduled',
    },
    { label: 'Tracked Leagues', value: leagueSnapshots.length, format: 'number' as const },
  ];

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#eef4f8_45%,#f6f8fb_100%)]">
      <section className="mx-auto max-w-[var(--app-shell-max-width)] px-4 pb-8 pt-6 sm:px-6 lg:px-8 2xl:px-10">
        <div className="overflow-hidden rounded-[2rem] border border-slate-900/10 bg-[radial-gradient(circle_at_top_left,rgba(24,50,74,0.24),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(47,107,88,0.16),transparent_24%),linear-gradient(135deg,#102132,#13283c_58%,#1d3448)] text-white shadow-[0_30px_90px_-45px_rgba(15,23,42,0.85)]">
          <div className="grid gap-8 px-6 py-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)] lg:px-8 lg:py-8">
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-200/85">
                  Dashboard
                </p>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    Current league state for {displayName}
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                    A live snapshot of your leagues, deadlines, player market, and the actions that
                    matter next.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                    My Leagues
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-white">{userLeagues.length}</p>
                  <p className="mt-1 text-sm text-white/70">Leagues currently linked to your account.</p>
                </div>
                <div className="rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                    Live Rounds
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-white">{liveLeagueCount}</p>
                  <p className="mt-1 text-sm text-white/70">Leagues with a round currently in progress.</p>
                </div>
                <div className="rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                    Next Waiver
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {nextWaiverLeague ? nextWaiverLeague.name : 'Not scheduled'}
                  </p>
                  <p className="mt-1 text-sm text-white/70">
                    {nextWaiverLeague ? formatDateLabel(nextWaiverLeague.nextWaiverIso) : 'No waiver run found across tracked leagues.'}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <CommandLink
                  href="/leagues"
                  title="Open My Leagues"
                  description="Jump straight into current league workspaces and standings."
                />
                <CommandLink
                  href="/players"
                  title="Research Players"
                  description="Search the live player market with current ownership context."
                />
                <CommandLink
                  href="/waivers"
                  title="Review Waivers"
                  description="Check active claims and upcoming processing windows."
                />
                <button
                  type="button"
                  onClick={() => setRefreshTrigger((prev) => prev + 1)}
                  className="rounded-2xl border border-sky-300/35 bg-sky-400/18 px-4 py-3 text-left transition hover:bg-sky-400/24"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Refresh Dashboard</p>
                      <p className="mt-1 text-xs leading-5 text-white/75">
                        Pull fresh league context and rerun the live modules.
                      </p>
                    </div>
                    <span className="text-white/70">↻</span>
                  </div>
                </button>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/12 bg-white/8 p-5 backdrop-blur-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                Current Priorities
              </p>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                  <p className="text-sm font-semibold text-emerald-100">League pulse</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-50/80">
                    {liveLeagueCount > 0
                      ? `${liveLeagueCount} league${liveLeagueCount === 1 ? '' : 's'} have a live round right now.`
                      : 'No live round is currently in progress across your tracked leagues.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-sm font-semibold text-white">Draft status</p>
                  <p className="mt-1 text-sm leading-6 text-white/72">
                    {draftPendingCount > 0
                      ? `${draftPendingCount} league draft${draftPendingCount === 1 ? '' : 's'} still need attention.`
                      : 'No pending league drafts are flagged in your current league list.'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                  <p className="text-sm font-semibold text-white">Next deadline</p>
                  <p className="mt-1 text-sm leading-6 text-white/72">
                    {nextEventLeague
                      ? `${nextEventLeague.name}: ${nextEventLeague.nextEventLabel ?? 'Next event'} on ${formatDateLabel(nextEventLeague.nextEventIso)}`
                      : 'No upcoming league event is currently materialized.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-sm sm:p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Performance Snapshot
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                Current account and league overview
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Real counts and timing signals pulled from your current player pool and league state.
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-600">
              {leagueStateLoading || leaguesLoading ? 'Refreshing…' : 'Current state'}
            </span>
          </div>
          <StatsOverviewModule stats={overviewStats} refreshTrigger={refreshTrigger} />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_360px]">
          <div className="space-y-6">
            <DashboardCard
              eyebrow="League Pulse"
              title="What matters across your leagues"
              description="Current round state, next waiver, and the fastest route back into each active league."
              accent="sky"
            >
              {leagueStateLoading && leagueSnapshots.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600">
                  Loading league context…
                </div>
              ) : userLeagues.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    You are not currently in any leagues. Create or join one to populate the dashboard.
                  </p>
                  <div className="flex gap-2">
                    <Link
                      href="/leagues/new"
                      className="rounded-xl bg-[color:var(--league-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
                    >
                      Create league
                    </Link>
                    <Link
                      href="/leagues/join"
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Join league
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {leagueSnapshots.map((league) => (
                    <Link
                      key={league.id}
                      href={`/leagues/${league.id}`}
                      className="block rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-semibold text-slate-950">{league.name}</p>
                            {league.isLive ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                                Live
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{league.teamName}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          {league.role}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Current round
                          </p>
                          <p className="mt-1 font-medium text-slate-900">
                            {league.currentRoundLabel ?? 'Not materialized'}
                          </p>
                          <p className="mt-1 text-xs capitalize text-slate-500">
                            {league.currentRoundStatus?.replace('_', ' ') ?? 'No schedule yet'}
                          </p>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Next deadline
                          </p>
                          <p className="mt-1 font-medium text-slate-900">
                            {league.nextWaiverIso ? 'Waiver run' : league.nextEventLabel ?? 'No next event'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {league.nextWaiverIso
                              ? formatDateLabel(league.nextWaiverIso)
                              : formatDateLabel(league.nextEventIso)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </DashboardCard>

            <div className="grid gap-6 lg:grid-cols-2">
              <DashboardCard
                eyebrow="Draft State"
                title="Draft room pulse"
                description="Keep live draft attention separate from your leagues so it is easy to ignore when nothing is active."
                accent="amber"
              >
                <LiveDraftModule user={user} refreshTrigger={refreshTrigger} />
              </DashboardCard>

              <DashboardCard
                eyebrow="Round Summary"
                title="Weekend storylines"
                description="A quick read on the current round so key movement is visible at a glance."
                accent="emerald"
              >
                <WeekendSummaryModule refreshTrigger={refreshTrigger} />
              </DashboardCard>
            </div>

            <DashboardCard
              eyebrow="League Activity"
              title="Recent movement and manager actions"
              description="Aggregated from your tracked leagues so the dashboard reflects current transactions and admin actions."
              accent="slate"
            >
              <RecentActivityModule activities={dashboardActivities} refreshTrigger={refreshTrigger} />
            </DashboardCard>
          </div>

          <aside className="space-y-6">
            <div className="xl:sticky xl:top-24 xl:space-y-6">
              <DashboardCard
                eyebrow="League Operations"
                title="Your leagues"
                description="Primary management surface for moving between league contexts."
                accent="emerald"
              >
                <LeagueManagementModule user={user} refreshTrigger={refreshTrigger} />
              </DashboardCard>

              <DashboardCard
                eyebrow="Next Actions"
                title="Move quickly"
                description="High-frequency actions grouped together so common tasks are one click away."
                accent="sky"
              >
                <QuickActionsModule refreshTrigger={refreshTrigger} />
              </DashboardCard>

              <DashboardCard
                eyebrow="Market Intel"
                title="Season scoring leaders"
                description="The highest season scorers from the live aggregate player feed."
                accent="amber"
              >
                <LeaderboardModule refreshTrigger={refreshTrigger} />
              </DashboardCard>

              <DashboardCard
                eyebrow="Deadlines"
                title="Upcoming league checkpoints"
                description="Waiver windows and next league events across the leagues you are actively tracking."
                accent="rose"
              >
                <div className="space-y-3">
                  {leagueSnapshots.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-600">
                      Upcoming league deadlines will appear here once league state is available.
                    </div>
                  ) : (
                    leagueSnapshots.map((league) => (
                      <div key={league.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-slate-900">{league.name}</p>
                          {league.isLive ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                              Live
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {league.nextWaiverIso
                            ? `Waiver run: ${formatDateLabel(league.nextWaiverIso)}`
                            : league.nextEventIso
                              ? `${league.nextEventLabel ?? 'Next event'}: ${formatDateLabel(league.nextEventIso)}`
                              : 'No upcoming deadline materialized yet.'}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </DashboardCard>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
