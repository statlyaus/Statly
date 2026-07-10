'use client';

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import {
  Activity,
  ArrowRight,
  ClipboardList,
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

function Panel({
  title,
  action,
  children,
  className = '',
  headerClassName = '',
  titleClassName = '',
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-background p-4 shadow-[0_18px_44px_-38px_rgba(15,23,42,0.45)] ring-1 ring-foreground/[0.03] ${className}`}
    >
      <div className={`mb-4 flex items-center justify-between gap-3 ${headerClassName}`}>
        <h2 className={`text-lg font-semibold tracking-tight text-foreground ${titleClassName}`}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SecondaryButton({
  href,
  children,
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:border-foreground/25 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className}`}
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
  const roleLabel = league.role === 'owner' || league.role === 'admin' ? 'Admin' : 'Manager';

  return (
    <Link
      href={`/leagues/${league.id}`}
      className="group flex min-h-[4.75rem] items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 transition hover:border-[color:var(--league-success)]/40 hover:bg-[color:var(--league-success-soft)]/35 focus-visible:border-[color:var(--league-success)]/45 focus-visible:bg-[color:var(--league-success-soft)]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-4 sm:px-4"
    >
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition group-hover:border-[color:var(--league-success)]/25 group-hover:bg-[color:var(--league-success)] group-hover:text-white group-focus-visible:border-[color:var(--league-success)]/25 group-focus-visible:bg-[color:var(--league-success)] group-focus-visible:text-white"
      >
        {index % 3 === 0 ? (
          <Trophy className="size-5" aria-hidden="true" />
        ) : index % 3 === 1 ? (
          <Shield className="size-5" aria-hidden="true" />
        ) : (
          <Activity className="size-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold tracking-tight text-foreground">
          {league.name}
        </span>
        <span className="mt-1 block truncate text-sm text-muted-foreground">{league.memberText}</span>
      </span>
      <span className="hidden items-center gap-5 sm:flex">
        <span className="rounded-full bg-foreground px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-background transition group-hover:bg-[color:var(--league-success)] group-hover:text-white group-focus-visible:bg-[color:var(--league-success)] group-focus-visible:text-white">
          {roleLabel}
        </span>
        <span className="text-sm font-semibold text-foreground transition group-hover:text-[color:var(--league-success)] group-focus-visible:text-[color:var(--league-success)]">
          Open
        </span>
      </span>
      <ArrowRight
        className="size-5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-[color:var(--league-success)] group-focus-visible:text-[color:var(--league-success)]"
        aria-hidden="true"
      />
    </Link>
  );
}

export default function ModularDashboard({ user }: ModularDashboardProps): React.ReactElement {
  const [refreshTrigger] = useState(0);
  const [leagueSnapshots, setLeagueSnapshots] = useState<LeagueSnapshot[]>([]);
  const [, setLeagueStateLoading] = useState(false);
  const { leagues: userLeagues } = useUserLeagues(user.uid);

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
  const accountName = user.displayName || user.email || user.uid || 'Manager';
  const activeLeagueCount = typedUserLeagues.length;
  const draftPendingCount = typedUserLeagues.filter((league) => league.draftCompleted === false).length;
  const liveLeagueCount = leagueSnapshots.filter((league) => league.isLive).length;
  const waiverSignalCount = leagueSnapshots.filter((league) => league.nextWaiverIso).length;

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
  const heroTitle = accountName;
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--league-surface)_0%,var(--league-page)_46%,var(--league-surface-muted)_100%)]">
      <section className="mx-auto flex max-w-[var(--app-shell-max-width)] flex-col gap-5 px-4 pb-8 pt-6 sm:px-6 lg:px-8 2xl:px-10">
        <section
          className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950 bg-cover bg-center px-5 py-5 text-white shadow-[0_24px_56px_-34px_rgba(2,6,23,0.88)] sm:px-7 lg:px-9 lg:py-7"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(3, 10, 20, 0.82) 0%, rgba(4, 12, 22, 0.9) 50%, rgba(2, 8, 16, 0.97) 100%), linear-gradient(90deg, rgba(3, 10, 20, 0.98) 0%, rgba(3, 10, 20, 0.72) 42%, rgba(3, 10, 20, 0.92) 100%), url('/Assets/statly-stadium-hero.png')",
          }}
        >
          <div className="flex flex-col gap-7">
            <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
              <span className="mb-4 h-1 w-20 rounded-full bg-destructive shadow-[0_0_24px_rgba(239,68,68,0.55)]" />
              <div className="min-w-0">
                <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl">
                  League command center
                </h1>
                <p className="mt-6 truncate text-2xl font-semibold tracking-tight text-white/70 sm:text-3xl lg:text-4xl">
                  {heroTitle}
                </p>
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

      </section>
    </main>
  );
}
