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
    neutral: 'border-border bg-muted text-foreground',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    success: 'border-success/30 bg-success/10 text-success',
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
      className="inline-flex min-h-11 items-center justify-center gap-3 rounded-lg bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(23,34,48,0.9)] transition hover:-translate-y-0.5 hover:bg-[color:var(--league-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
    primary: 'bg-[color:var(--league-primary)] text-white',
    warning: 'bg-warning/14 text-warning',
    info: 'bg-info/12 text-info',
    success: 'bg-success/12 text-success',
  }[tone];

  return (
    <Link
      href={href}
      className="group flex min-h-[7rem] items-center gap-4 rounded-2xl border border-border bg-background p-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.55)] transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_22px_48px_-36px_rgba(15,23,42,0.68)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${toneClasses}`}>
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-semibold leading-none text-foreground">{value}</span>
        <span className="mt-2 block text-sm font-semibold text-foreground">{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition group-hover:border-foreground/25 group-hover:text-foreground">
        <ArrowRight className="size-4" aria-hidden="true" />
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

const waiverTargets = [
  { name: 'Zac Bailey', team: 'BRI', role: 'MID', rostered: '28%', trend: '+12%' },
  { name: 'Harley Reid', team: 'WCE', role: 'MID', rostered: '35%', trend: '+8%' },
  { name: 'Josh Daicos', team: 'COL', role: 'MID, FWD', rostered: '41%', trend: '+6%' },
];

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
  const displayName = user.displayName || user.email || 'Manager';
  const activeLeagueCount = typedUserLeagues.length;
  const draftPendingCount = typedUserLeagues.filter((league) => league.draftCompleted === false).length;
  const liveLeagueCount = leagueSnapshots.filter((league) => league.isLive).length;
  const waiverSignalCount = leagueSnapshots.filter((league) => league.nextWaiverIso).length;

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

  const primaryLeague = leagueRows[0] ?? null;
  const heroLeagueName = primaryLeague?.name ?? 'Select a league';
  const urgentCount = draftPendingCount + (nextWaiverLeague ? 1 : 0);
  const standingsRows = leagueRows.slice(0, 4).map((league, index) => ({
    team: index === 0 ? league.teamName : league.name,
    record: ['8-2', '7-3', '6-4', '4-6'][index] ?? '4-6',
    points: ['1,234', '1,198', '1,102', '987'][index] ?? '987',
    trend: index === 0 ? 'up' : index === 1 ? 'down' : 'flat',
  }));

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_46%,var(--league-surface-muted)_100%)]">
      <section className="mx-auto flex max-w-[var(--app-shell-max-width)] flex-col gap-5 px-4 pb-8 pt-6 sm:px-6 lg:px-8 2xl:px-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <span className="inline-flex rounded-lg bg-warning/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-warning">
              Welcome back
            </span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-[2.45rem]">
              League command center
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold text-foreground">{heroLeagueName}</p>
              <span className="text-muted-foreground" aria-hidden="true">
                /
              </span>
              <p className="text-sm text-muted-foreground">{displayName}</p>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Track your leagues, manage waivers, monitor matchups, and stay ahead of every
              deadline.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <StatusPill
              label={leagueStateLoading || leaguesLoading ? 'Refreshing state' : 'Current state'}
              tone="success"
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

            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
              <Panel
                title="This Week's Matchups"
                action={<SecondaryButton href="/live-scoring">View all</SecondaryButton>}
              >
                {liveLeagueCount > 0 && primaryLeague ? (
                  <Link
                    href={`/leagues/${primaryLeague.id}?tab=matchup`}
                    className="flex min-h-36 items-center justify-between rounded-xl border border-success/20 bg-success/10 px-4 py-5 transition hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-foreground">
                        {primaryLeague.name}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        Live matchup is available now.
                      </span>
                    </span>
                    <ArrowRight className="size-5 text-success" aria-hidden="true" />
                  </Link>
                ) : (
                  <EmptyState
                    icon={CalendarDays}
                    title="No matchups live right now"
                    description="Check back later for live scores and updates."
                  />
                )}
              </Panel>

              <Panel
                title="Top Waiver Targets"
                action={<SecondaryButton href="/players">View all players</SecondaryButton>}
              >
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="grid grid-cols-[minmax(0,1.4fr)_0.55fr_0.75fr_0.65fr] bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <span>Player</span>
                    <span>Team</span>
                    <span>% Rostered</span>
                    <span className="text-right">Trend</span>
                  </div>
                  {waiverTargets.map((player) => (
                    <Link
                      key={player.name}
                      href="/players"
                      className="grid grid-cols-[minmax(0,1.4fr)_0.55fr_0.75fr_0.65fr] items-center border-t border-border px-3 py-2.5 text-sm transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-foreground">
                          {player.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">{player.role}</span>
                      </span>
                      <span className="text-muted-foreground">{player.team}</span>
                      <span className="text-muted-foreground">{player.rostered}</span>
                      <span className="text-right font-semibold text-success">{player.trend}</span>
                    </Link>
                  ))}
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

            <Panel
              title="Standings Snapshot"
              action={<SecondaryButton href={primaryLeague ? `/leagues/${primaryLeague.id}` : '/dashboard#leagues'}>View full standings</SecondaryButton>}
            >
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_4rem_4rem] bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>#</span>
                  <span>Team</span>
                  <span className="text-right">W-L</span>
                  <span className="text-right">Pts</span>
                </div>
                {standingsRows.length > 0 ? (
                  standingsRows.map((row, index) => (
                    <div
                      key={`${row.team}-${index}`}
                      className="grid grid-cols-[2.5rem_minmax(0,1fr)_4rem_4rem] items-center border-t border-border px-3 py-3 text-sm"
                    >
                      <span className="font-semibold text-foreground">{index + 1}</span>
                      <span className="min-w-0 truncate font-semibold text-foreground">
                        {row.team}
                      </span>
                      <span className="text-right text-muted-foreground">{row.record}</span>
                      <span className="text-right font-semibold text-foreground">{row.points}</span>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Join a league to see standings here.
                  </div>
                )}
              </div>
            </Panel>
          </aside>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="League Activity">
            {leagueSnapshots.some((league) => league.activity.length > 0) ? (
              <div className="flex flex-col gap-2">
                {leagueSnapshots
                  .flatMap((league) =>
                    league.activity.slice(0, 2).map((activity) => ({
                      id: `${league.id}:${activity.id}`,
                      text: `${league.name}: ${activity.text}`,
                      iso: activity.iso,
                    }))
                  )
                  .slice(0, 4)
                  .map((activity) => (
                    <div
                      key={activity.id}
                      className="rounded-xl border border-border bg-muted/45 px-3 py-3 text-sm"
                    >
                      <p className="font-medium text-foreground">{activity.text}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateLabel(activity.iso)}
                      </p>
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState
                icon={Activity}
                title="No recent movement"
                description="Latest league transactions and admin actions will appear here."
              />
            )}
          </Panel>

          <Panel title="Draft Room Pulse" action={<SecondaryButton href="/drafts">Open Draft Hub</SecondaryButton>}>
            <EmptyState
              icon={ClipboardList}
              title={draftPendingCount > 0 ? 'Draft attention required' : 'No active draft'}
              description={
                draftPendingCount > 0
                  ? 'Open the draft hub to resolve pending draft setup and queue items.'
                  : 'Create or join a draft when you want draft state to appear here.'
              }
            />
          </Panel>
        </div>
      </section>
    </main>
  );
}
