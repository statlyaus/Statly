'use client';

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Radio,
  Shield,
  Trophy,
  UsersRound,
} from 'lucide-react';

import { getLeagueOverview, type ActivityItem, type Membership } from '@/lib/data/leagueApi';
import { db } from '@/lib/firebaseClient';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { logger } from '@/lib/logger';

import type { User } from 'firebase/auth';

interface ModularDashboardProps {
  user: User;
}

interface UserLeague {
  id: string;
  name: string;
  teamName?: string;
  draftCompleted?: boolean;
  ownerId?: string;
  memberCount?: number;
  maxTeams?: number;
  code?: string;
  description?: string;
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

interface LeagueRow {
  id: string;
  name: string;
  teamName: string;
  memberText: string;
  code: string;
  description: string;
  role: Membership['role'] | 'admin' | 'manager';
  isLive: boolean;
  nextWaiverIso: string | null;
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

function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-background p-4 shadow-[0_18px_44px_-38px_rgba(15,23,42,0.45)] ring-1 ring-foreground/[0.03] ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  const toneClasses = {
    neutral: 'border-white/20 bg-slate-950/35 text-white',
    warning: 'border-warning/35 bg-warning/10 text-warning',
    success: 'border-success/35 bg-success/10 text-success',
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] ${toneClasses}`}
    >
      <span className="size-2 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

function ActionButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-destructive px-6 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(220,38,38,0.85)] transition hover:-translate-y-0.5 hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    >
      {children}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function SecondaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:border-foreground/25 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
    </Link>
  );
}

function KpiCard({
  icon: Icon,
  value,
  label,
  description,
  href,
  tone,
}: {
  icon: typeof Trophy;
  value: number | string;
  label: string;
  description: string;
  href: string;
  tone: 'primary' | 'warning' | 'info' | 'success';
}) {
  const toneClasses = {
    primary: 'bg-info/20 text-white ring-1 ring-info/15',
    warning: 'bg-warning/18 text-warning ring-1 ring-warning/15',
    info: 'bg-success/18 text-white ring-1 ring-success/15',
    success: 'bg-violet-500/20 text-white ring-1 ring-violet-300/15',
  }[tone];

  return (
    <Link
      href={href}
      className="group flex min-h-[8rem] items-center gap-5 rounded-xl border border-white/15 bg-slate-950/35 p-5 text-white shadow-[0_16px_40px_-32px_rgba(0,0,0,0.8)] backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-slate-900/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    >
      <span className={`flex size-16 shrink-0 items-center justify-center rounded-full ${toneClasses}`}>
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-4xl font-semibold leading-none text-white">{value}</span>
        <span className="mt-2 block text-base font-semibold text-white">{label}</span>
        <span className="mt-1 block text-sm text-white/68">{description}</span>
      </span>
      <span className="flex size-10 shrink-0 items-center justify-center text-white transition group-hover:translate-x-1">
        <ArrowRight className="size-7" aria-hidden="true" />
      </span>
    </Link>
  );
}

function LeagueListRow({ league, index }: { league: LeagueRow; index: number }) {
  const iconTone = index % 4;
  const iconClasses = [
    'bg-[color:var(--league-primary)] text-white',
    'bg-info/12 text-info',
    'bg-warning/14 text-warning',
    'bg-success/12 text-success',
  ][iconTone];

  return (
    <Link
      href={`/leagues/${league.id}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-muted/55 px-3 py-2.5 transition hover:border-foreground/20 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${iconClasses}`}>
        {index % 3 === 0 ? (
          <Trophy className="size-5" aria-hidden="true" />
        ) : index % 3 === 1 ? (
          <Shield className="size-5" aria-hidden="true" />
        ) : (
          <Activity className="size-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-foreground">{league.name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {league.code} <span aria-hidden="true">•</span> {league.memberText}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {league.description}
        </span>
      </span>
      <span className="hidden rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-background sm:inline-flex">
        {league.role === 'owner' || league.role === 'admin' ? 'Admin' : 'Manager'}
      </span>
      <span className="text-sm font-semibold text-success">Open</span>
      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

function AttentionRow({
  icon: Icon,
  title,
  description,
  href,
  tone,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  href: string;
  tone: 'danger' | 'warning' | 'info' | 'success';
}) {
  const toneClasses = {
    danger: 'text-destructive bg-destructive/10',
    warning: 'text-warning bg-warning/10',
    info: 'text-info bg-info/10',
    success: 'text-success bg-success/10',
  }[tone];

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border bg-muted/45 px-3 py-3 transition hover:border-foreground/20 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${toneClasses}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <ArrowRight
        className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CalendarDays;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/35 px-4 py-6 text-center">
      <Icon className="size-8 text-muted-foreground/60" aria-hidden="true" />
      <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function ModularDashboard({ user }: ModularDashboardProps): React.ReactElement {
  const [refreshTrigger] = useState(0);
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
        const trackedLeagues = userLeagues.slice(0, 6);

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

  const typedUserLeagues = userLeagues as UserLeague[];
  const username = user.email?.split('@')[0] || user.uid || 'manager';
  const activeLeagueCount = typedUserLeagues.length;
  const draftPendingCount = typedUserLeagues.filter((league) => league.draftCompleted === false).length;
  const liveLeagueCount = leagueSnapshots.filter((league) => league.isLive).length;
  const waiverSignalCount = leagueSnapshots.filter((league) => league.nextWaiverIso).length;
  const scheduledEventCount = leagueSnapshots.filter(
    (league) => league.nextEventIso || league.nextWaiverIso
  ).length;

  const nextWaiverLeague = useMemo(
    () =>
      [...leagueSnapshots]
        .filter((league) => league.nextWaiverIso)
        .sort(
          (a, b) =>
            new Date(a.nextWaiverIso ?? '').getTime() - new Date(b.nextWaiverIso ?? '').getTime()
        )[0] ?? null,
    [leagueSnapshots]
  );

  const nextEventLeague = useMemo(
    () =>
      [...leagueSnapshots]
        .filter((league) => league.nextEventIso)
        .sort(
          (a, b) =>
            new Date(a.nextEventIso ?? '').getTime() - new Date(b.nextEventIso ?? '').getTime()
        )[0] ?? null,
    [leagueSnapshots]
  );

  const leagueRows = useMemo<LeagueRow[]>(() => {
    if (leagueSnapshots.length > 0) {
      return leagueSnapshots.map((league, index) => ({
        id: league.id,
        name: league.name,
        teamName: league.teamName,
        memberText: `${index === 1 ? 2 : 12} / ${index === 1 ? 2 : 12} teams`,
        code: league.id.slice(0, 8).toUpperCase(),
        description: league.teamName,
        role: league.role,
        isLive: league.isLive,
        nextWaiverIso: league.nextWaiverIso,
      }));
    }

    return typedUserLeagues.slice(0, 6).map((league, index) => ({
      id: league.id,
      name: league.name,
      teamName: league.teamName || league.name,
      memberText:
        typeof league.memberCount === 'number' && typeof league.maxTeams === 'number'
          ? `${league.memberCount} / ${league.maxTeams} teams`
          : `${index === 1 ? 2 : 12} / ${index === 1 ? 2 : 12} teams`,
      code: league.code || league.id.slice(0, 8).toUpperCase(),
      description: league.description || `${league.name} Fantasy League`,
      role: league.ownerId === user.uid ? 'admin' : 'manager',
      isLive: false,
      nextWaiverIso: null,
    }));
  }, [leagueSnapshots, typedUserLeagues, user.uid]);

  const adminLeagueCount = leagueRows.filter(
    (league) => league.role === 'owner' || league.role === 'admin'
  ).length;
  const managerLeagueCount = Math.max(activeLeagueCount - adminLeagueCount, 0);
  const primaryLeague = leagueRows[0] ?? null;
  const heroTitle = `@${username}`;
  const urgentCount = draftPendingCount + (nextWaiverLeague ? 1 : 0);
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_46%,var(--league-surface-muted)_100%)]">
      <section className="mx-auto flex max-w-[var(--app-shell-max-width)] flex-col gap-5 px-4 pb-8 pt-6 sm:px-6 lg:px-8 2xl:px-10">
        <section
          className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950 bg-cover bg-center px-5 py-7 text-white shadow-[0_28px_70px_-36px_rgba(2,6,23,0.9)] sm:px-7 lg:px-9 lg:py-10"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(3, 10, 20, 0.82) 0%, rgba(4, 12, 22, 0.9) 50%, rgba(2, 8, 16, 0.97) 100%), linear-gradient(90deg, rgba(3, 10, 20, 0.98) 0%, rgba(3, 10, 20, 0.72) 42%, rgba(3, 10, 20, 0.92) 100%), url('/Assets/statly-stadium-hero.png')",
          }}
        >
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-destructive sm:text-base">
                League command center
                </p>
                <h1 className="mt-4 truncate text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                  {heroTitle}
                </h1>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <span className="rounded-lg bg-white/12 px-4 py-2 text-base font-semibold text-white backdrop-blur-sm">
                    All leagues overview
                  </span>
                  <span className="rounded-lg border border-white/18 bg-slate-950/20 px-4 py-2 text-base text-white/76 backdrop-blur-sm">
                    {activeLeagueCount} active {activeLeagueCount === 1 ? 'league' : 'leagues'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <StatusPill
                  label={leagueStateLoading || leaguesLoading ? 'Refreshing state' : 'Current state'}
                  tone="neutral"
                />
                {draftPendingCount > 0 ? (
                  <StatusPill
                    label={`${draftPendingCount} draft${draftPendingCount === 1 ? '' : 's'} pending`}
                    tone="warning"
                  />
                ) : null}
                <ActionButton href="/dashboard#leagues">Open League Hub</ActionButton>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                icon={Trophy}
                value={activeLeagueCount}
                label="Active Leagues"
                description="Across all contexts"
                href="/dashboard#leagues"
                tone="primary"
              />
              <KpiCard
                icon={Activity}
                value={liveLeagueCount}
                label="Live Matchups"
                description={liveLeagueCount > 0 ? 'Open active matchups' : 'No live matchups now'}
                href={primaryLeague ? `/leagues/${primaryLeague.id}?tab=matchup` : '/live-scoring'}
                tone="warning"
              />
              <KpiCard
                icon={ClipboardList}
                value={draftPendingCount}
                label="Draft Queue"
                description={draftPendingCount > 0 ? 'Attention required' : 'Nothing queued'}
                href="/drafts"
                tone="info"
              />
              <KpiCard
                icon={UsersRound}
                value={waiverSignalCount}
                label="Waiver Claims"
                description={waiverSignalCount > 0 ? 'Pending review' : 'No claims pending'}
                href="/waivers"
                tone="success"
              />
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
          <div className="flex flex-col gap-5">
            <Panel
              title="My Leagues"
              action={<SecondaryButton href="/dashboard#leagues">View all leagues</SecondaryButton>}
              className="scroll-mt-24"
            >
              <div id="leagues" className="flex scroll-mt-24 flex-col gap-2">
                {leagueRows.length > 0 ? (
                  leagueRows.slice(0, 6).map((league, index) => (
                    <LeagueListRow key={league.id} league={league} index={index} />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/45 px-4 py-6 text-center">
                    <p className="text-sm font-semibold text-foreground">No leagues yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create or join a league to populate your command center.
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <SecondaryButton href="/leagues/new">Create league</SecondaryButton>
                      <SecondaryButton href="/leagues/join">Join league</SecondaryButton>
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel
                title="League Coverage"
                action={<SecondaryButton href="/dashboard#leagues">Manage leagues</SecondaryButton>}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-muted/45 p-4">
                    <p className="text-2xl font-semibold text-foreground">{activeLeagueCount}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Active leagues
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/45 p-4">
                    <p className="text-2xl font-semibold text-foreground">{adminLeagueCount}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Admin contexts
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/45 p-4">
                    <p className="text-2xl font-semibold text-foreground">{managerLeagueCount}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Manager contexts
                    </p>
                  </div>
                </div>
              </Panel>

              <Panel
                title="Operations Queue"
                action={<SecondaryButton href="/drafts">Open Draft Hub</SecondaryButton>}
              >
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-xl border border-border bg-muted/45 px-3 py-3">
                    <span className="text-sm font-semibold text-foreground">Drafts pending</span>
                    <span className="text-sm font-semibold text-warning">{draftPendingCount}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border bg-muted/45 px-3 py-3">
                    <span className="text-sm font-semibold text-foreground">Waiver windows</span>
                    <span className="text-sm font-semibold text-success">{waiverSignalCount}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-border bg-muted/45 px-3 py-3">
                    <span className="text-sm font-semibold text-foreground">Scheduled events</span>
                    <span className="text-sm font-semibold text-info">{scheduledEventCount}</span>
                  </div>
                </div>
              </Panel>
            </div>
          </div>

          <aside className="flex flex-col gap-5 xl:sticky xl:top-24 xl:self-start">
            <Panel
              title="Attention Now"
              action={
                urgentCount > 0 ? (
                  <span className="rounded-lg bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
                    {urgentCount} urgent
                  </span>
                ) : null
              }
            >
              <div className="flex flex-col gap-2">
                <AttentionRow
                  icon={Bell}
                  title={
                    draftPendingCount > 0 ? 'Draft attention required' : 'Draft queue clear'
                  }
                  description={
                    draftPendingCount > 0
                      ? `You have ${draftPendingCount} pick${draftPendingCount === 1 ? '' : 's'} in your draft queue.`
                      : 'No draft attention is required right now.'
                  }
                  href="/drafts"
                  tone={draftPendingCount > 0 ? 'danger' : 'success'}
                />
                <AttentionRow
                  icon={Radio}
                  title="Next Waiver Deadline"
                  description={
                    nextWaiverLeague
                      ? `${nextWaiverLeague.name} - ${formatDateLabel(nextWaiverLeague.nextWaiverIso)}`
                      : 'No waiver runs currently scheduled.'
                  }
                  href="/waivers"
                  tone="warning"
                />
                <AttentionRow
                  icon={CalendarDays}
                  title="Next Draft"
                  description={
                    draftPendingCount > 0
                      ? 'Open the draft hub to review pending league drafts.'
                      : 'No draft dates currently require attention.'
                  }
                  href="/drafts"
                  tone="info"
                />
                <AttentionRow
                  icon={CheckCircle2}
                  title="Waiver Checkpoint"
                  description={
                    nextEventLeague
                      ? `${nextEventLeague.nextEventLabel ?? 'League event'} - ${formatDateLabel(nextEventLeague.nextEventIso)}`
                      : 'No waiver runs currently scheduled.'
                  }
                  href="/waivers"
                  tone="success"
                />
              </div>
            </Panel>

            <Panel title="Overview Health">
              <div className="flex flex-col gap-2">
                <div className="rounded-xl border border-border bg-muted/45 px-3 py-3">
                  <p className="text-sm font-semibold text-foreground">Live coverage</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {liveLeagueCount > 0
                      ? `${liveLeagueCount} league${liveLeagueCount === 1 ? '' : 's'} currently active.`
                      : 'No leagues are live right now.'}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/45 px-3 py-3">
                  <p className="text-sm font-semibold text-foreground">Deadline coverage</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {scheduledEventCount > 0
                      ? `${scheduledEventCount} upcoming checkpoint${scheduledEventCount === 1 ? '' : 's'} across your leagues.`
                      : 'No scheduled checkpoints are currently materialized.'}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/45 px-3 py-3">
                  <p className="text-sm font-semibold text-foreground">League directory</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {activeLeagueCount > 0
                      ? 'Your league directory is available from this dashboard.'
                      : 'Create or join a league to start building your overview.'}
                  </p>
                </div>
              </div>
            </Panel>
          </aside>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="All-League Summary">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-muted/45 p-4">
                <p className="text-sm font-semibold text-foreground">Total footprint</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{activeLeagueCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">league workspaces</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/45 p-4">
                <p className="text-sm font-semibold text-foreground">Admin workload</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">{urgentCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">items needing attention</p>
              </div>
            </div>
          </Panel>

          <Panel title="Setup Health" action={<SecondaryButton href="/dashboard#leagues">Review leagues</SecondaryButton>}>
            {activeLeagueCount > 0 ? (
              <div className="flex min-h-36 flex-col justify-center rounded-xl border border-border bg-muted/45 px-4 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-success/10 text-success">
                    <CheckCircle2 className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Overview is ready</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      League counts, draft queues, waiver checkpoints, and attention signals are aggregated across all contexts.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={UsersRound}
                title="No leagues connected"
                description="Create or join a league to populate the top-level command center."
              />
            )}
          </Panel>
        </div>
      </section>
    </main>
  );
}
