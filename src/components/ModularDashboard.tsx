'use client';

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import {
  getLeagueOverview,
  type ActivityItem,
  type ActivityKind,
  type Membership,
} from '@/lib/data/leagueApi';
import { db } from '@/lib/firebaseClient';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { logger } from '@/lib/logger';

import LeagueManagementModule from './dashboard/LeagueManagementModule';
import LiveDraftModule from './dashboard/LiveDraftModule';
import QuickActionsModule from './dashboard/QuickActionsModule';
import RecentActivityModule from './dashboard/RecentActivityModule';
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
  className = '',
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-[1.5rem] border border-border bg-background/96 p-5 shadow-[0_22px_60px_-42px_rgba(15,23,42,0.46)] ring-1 ring-foreground/[0.03] backdrop-blur-sm ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
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
      className="group rounded-2xl border border-border bg-background/80 px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition hover:border-foreground/20 hover:bg-muted hover:shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <span className="text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground">
          →
        </span>
      </div>
    </Link>
  );
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
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [leagueSnapshots, setLeagueSnapshots] = useState<LeagueSnapshot[]>([]);
  const [leagueStateLoading, setLeagueStateLoading] = useState(false);
  const { leagues: userLeagues, loading: leaguesLoading } = useUserLeagues(user.uid);

  useEffect(() => {
    let active = true;

    const fetchLeagueSnapshots = async () => {
      if (!user.uid || userLeagues.length === 0) {
        setLeagueSnapshots([]);
        return;
      }

      setLeagueStateLoading(true);
      try {
        if (!db) {
          logger.warn('Dashboard league snapshots falling back without Firestore', {
            message: 'Firebase client database is not initialized',
          });
        }
        const trackedLeagues = userLeagues.slice(0, 4);

        const snapshots = await Promise.all(
          trackedLeagues.map(async (league) => {
            const [overview, seasonStatePayload] = await Promise.all([
              db
                ? getLeagueOverview(db, league.id, user.uid).catch(() => null)
                : Promise.resolve(null),
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
  const liveLeagueCount = leagueSnapshots.filter((league: LeagueSnapshot) => league.isLive).length;
  const nextWaiverLeague = useMemo(
    () =>
      [...leagueSnapshots]
        .filter((league: LeagueSnapshot) => league.nextWaiverIso)
        .sort(
          (a, b) =>
            new Date(a.nextWaiverIso ?? '').getTime() - new Date(b.nextWaiverIso ?? '').getTime()
        )[0] ?? null,
    [leagueSnapshots]
  );
  const nextEventLeague = useMemo(
    () =>
      [...leagueSnapshots]
        .filter((league: LeagueSnapshot) => league.nextEventIso)
        .sort(
          (a, b) =>
            new Date(a.nextEventIso ?? '').getTime() - new Date(b.nextEventIso ?? '').getTime()
        )[0] ?? null,
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

  const primaryLeague = leagueSnapshots[0] ?? null;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_42%,var(--league-surface-muted)_100%)]">
      <section className="mx-auto max-w-[var(--app-shell-max-width)] px-4 pb-8 pt-6 sm:px-6 lg:px-8 2xl:px-10">
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-border bg-background/95 p-5 shadow-[0_26px_80px_-48px_rgba(15,23,42,0.45)] ring-1 ring-foreground/[0.03] sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Dashboard
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-[2.5rem]">
                  League command center for {displayName}
                </h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                  Start from the leagues and deadlines that need attention, then move into draft,
                  waivers, market research, or recent activity without leaving the page.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <span className="rounded-full border border-border bg-muted px-3 py-1 text-sm font-medium text-foreground">
                  {leagueStateLoading || leaguesLoading ? 'Refreshing…' : 'Current state'}
                </span>
                {liveLeagueCount > 0 ? (
                  <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1 text-sm font-medium text-success">
                    {liveLeagueCount} live {liveLeagueCount === 1 ? 'league' : 'leagues'}
                  </span>
                ) : null}
                {draftPendingCount > 0 ? (
                  <span className="rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-sm font-medium text-warning">
                    {draftPendingCount} draft{draftPendingCount === 1 ? '' : 's'} pending
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRefreshTrigger((prev) => prev + 1)}
                  className="inline-flex items-center justify-center rounded-full border border-border bg-foreground px-4 py-2 text-sm font-semibold text-white transition hover:bg-muted"
                >
                  Refresh dashboard
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.9fr))]">
              <Link
                href={primaryLeague ? `/leagues/${primaryLeague.id}` : '/dashboard#leagues'}
                className="group rounded-[1.5rem] border border-foreground bg-foreground px-5 py-5 text-background shadow-[0_18px_44px_-32px_rgba(15,23,42,0.8)] transition hover:bg-foreground/95"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Primary focus
                </p>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xl font-semibold">
                      {primaryLeague ? primaryLeague.name : 'Open your leagues'}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {primaryLeague
                        ? `${primaryLeague.teamName} • ${primaryLeague.currentRoundLabel ?? 'Schedule pending'}`
                        : 'Jump into your active leagues, standings, and current matchups.'}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-muted-foreground transition group-hover:translate-x-0.5">
                    Open →
                  </span>
                </div>
              </Link>

              <div className="rounded-[1.5rem] border border-border bg-muted px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Next waiver
                </p>
                <p className="mt-3 text-lg font-semibold text-foreground">
                  {nextWaiverLeague ? nextWaiverLeague.name : 'No waiver queued'}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {nextWaiverLeague
                    ? formatDateLabel(nextWaiverLeague.nextWaiverIso)
                    : 'No waiver window is currently materialized across tracked leagues.'}
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-border bg-muted px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Next checkpoint
                </p>
                <p className="mt-3 text-lg font-semibold text-foreground">
                  {nextEventLeague
                    ? (nextEventLeague.nextEventLabel ?? 'League event')
                    : 'No event queued'}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {nextEventLeague
                    ? `${nextEventLeague.name} • ${formatDateLabel(nextEventLeague.nextEventIso)}`
                    : 'No upcoming league event is currently available.'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <CommandLink
                href="/dashboard#leagues"
                title="Open league directory"
                description="Jump into league workspaces and standings from this dashboard."
              />
              <CommandLink
                href="/waivers"
                title="Review waivers"
                description="Check claims, order, and the next run."
              />
              <CommandLink
                href="/players"
                title="Player research"
                description="Search the player pool with live market context."
              />
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
            <div className="space-y-6">
              <DashboardCard
                eyebrow="League Hub"
                title="Your leagues"
                description="Start here to open league workspaces, switch contexts, and manage creation or invites."
                className="scroll-mt-24 border-[color:var(--league-primary)]/30 bg-background shadow-[0_32px_80px_-48px_rgba(23,34,48,0.52)]"
              >
                <LeagueManagementModule user={user} refreshTrigger={refreshTrigger} />
              </DashboardCard>

              <DashboardCard
                eyebrow="League Command Center"
                title="Active leagues"
                description="Open the right league first, with live state and the next decision visible in each row."
              >
                {leagueStateLoading && leagueSnapshots.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-white px-4 py-8 text-sm text-muted-foreground">
                    Loading league context…
                  </div>
                ) : userLeagues.length === 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      You are not currently in any leagues. Create or join one to populate the
                      dashboard.
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
                        className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
                      >
                        Join league
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {leagueSnapshots.map((league, index) => {
                      const primaryActionHref = league.isLive
                        ? `/leagues/${league.id}?tab=matchup`
                        : `/leagues/${league.id}`;
                      const primaryActionLabel = league.isLive ? 'Open matchup' : 'Open league';
                      const nextActionLabel = league.nextWaiverIso
                        ? 'Waiver run'
                        : (league.nextEventLabel ?? 'League event');
                      const priorityCopy = league.isLive
                        ? 'Live scoring is active in this league.'
                        : league.nextWaiverIso
                          ? 'This league has the clearest upcoming deadline.'
                          : 'Use this workspace for standings, roster, and season context.';

                      return (
                        <div
                          key={league.id}
                          className="rounded-[1.5rem] border border-border bg-white px-4 py-4 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.28)]"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  {index === 0 ? 'Primary focus' : `League ${index + 1}`}
                                </span>
                                {league.isLive ? (
                                  <span className="rounded-full bg-success/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-success">
                                    Live round
                                  </span>
                                ) : null}
                                <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                  {league.role}
                                </span>
                              </div>

                              <div className="mt-3">
                                <h3 className="text-xl font-semibold text-foreground">
                                  {league.name}
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {league.teamName}
                                </p>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                  {priorityCopy}
                                </p>
                              </div>

                              <div className="mt-4 grid gap-2 md:grid-cols-3">
                                <div className="rounded-xl bg-muted px-3 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Current round
                                  </p>
                                  <p className="mt-1 font-medium text-foreground">
                                    {league.currentRoundLabel ?? 'Not materialized'}
                                  </p>
                                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                                    {league.currentRoundStatus?.replace('_', ' ') ??
                                      'No schedule yet'}
                                  </p>
                                </div>
                                <div className="rounded-xl bg-muted px-3 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Next action
                                  </p>
                                  <p className="mt-1 font-medium text-foreground">
                                    {nextActionLabel}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {league.nextWaiverIso
                                      ? formatDateLabel(league.nextWaiverIso)
                                      : formatDateLabel(league.nextEventIso)}
                                  </p>
                                </div>
                                <div className="rounded-xl bg-muted px-3 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Fastest path
                                  </p>
                                  <p className="mt-1 font-medium text-foreground">
                                    {primaryActionLabel}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {league.isLive
                                      ? 'Jump straight into the current head-to-head.'
                                      : 'Open the full league workspace.'}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 lg:w-[190px]">
                              <Link
                                href={primaryActionHref}
                                className="inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-muted"
                              >
                                {primaryActionLabel}
                              </Link>
                              <Link
                                href={`/leagues/${league.id}?tab=roster`}
                                className="inline-flex items-center justify-center rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-white"
                              >
                                Open roster
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </DashboardCard>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
                <DashboardCard
                  eyebrow="Draft State"
                  title="Draft room pulse"
                  description="Keep draft attention visible without letting it dominate the whole dashboard."
                >
                  <LiveDraftModule user={user} refreshTrigger={refreshTrigger} />
                </DashboardCard>

                <DashboardCard
                  eyebrow="Round Summary"
                  title="Weekend storylines"
                  description="A compact read on what has shifted across the current round."
                >
                  <WeekendSummaryModule refreshTrigger={refreshTrigger} />
                </DashboardCard>
              </div>

              <DashboardCard
                eyebrow="League Activity"
                title="Recent movement"
                description="Latest league transactions, waivers, and manager actions across your tracked leagues."
              >
                <RecentActivityModule
                  activities={dashboardActivities}
                  refreshTrigger={refreshTrigger}
                />
              </DashboardCard>
            </div>

            <aside className="space-y-6">
              <div className="xl:sticky xl:top-24 xl:space-y-6">
                <DashboardCard
                  eyebrow="Attention Now"
                  title="What needs action"
                  description="The highest-signal league conditions and deadlines across your account."
                  className="border-foreground/15"
                >
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-muted px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Live leagues
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {liveLeagueCount}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {liveLeagueCount > 0
                          ? 'Open active matchups and current league state first.'
                          : 'No live rounds are currently in progress.'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Draft queue
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {draftPendingCount}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {draftPendingCount > 0
                          ? 'Draft attention is still required in your league list.'
                          : 'No pending drafts are flagged right now.'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted px-4 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Upcoming checkpoint
                      </p>
                      <p className="mt-2 font-semibold text-foreground">
                        {nextEventLeague ? nextEventLeague.name : 'No event queued'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {nextEventLeague
                          ? `${nextEventLeague.nextEventLabel ?? 'Next event'} • ${formatDateLabel(nextEventLeague.nextEventIso)}`
                          : 'League deadlines will appear here when state is available.'}
                      </p>
                    </div>
                  </div>
                </DashboardCard>

                <DashboardCard
                  eyebrow="Next Actions"
                  title="Tool shortcuts"
                  description="Secondary tools that support league decisions without taking over the page."
                  className="border-foreground/15"
                >
                  <QuickActionsModule refreshTrigger={refreshTrigger} />
                </DashboardCard>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
