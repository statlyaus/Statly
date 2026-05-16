'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import {
  ArrowRight as ArrowRightIcon,
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  Share2 as ShareIcon,
  Users as UserGroupIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';

import { getLeagueOverview, type LeagueOverviewData } from '@/lib/data/leagueApi';
import { getFirebaseDb } from '@/lib/firebaseClient';
import { leagueSurfacePatterns } from '@/styles/leagueDesignSystem';
import type { League, LeagueMember } from '@/types/leagues';

import InviteModal from './InviteModal';
import LiveGameScoresPanel from './LiveGameScoresPanel';
import LeagueViewHeader from './LeagueViewHeader';

interface LeagueOverviewProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

interface SeasonStateScheduleWeek {
  id: string;
  season: number;
  week: number;
  aflRound: number | null;
  roundLabel: string;
  status: string;
  matchupCount: number;
  current: boolean;
}

interface SeasonStateLadderRow {
  userId: string;
  teamName: string;
  ladderRank: number;
  record: { w: number; l: number; t: number };
  points: number;
  categoriesWon: number;
  categoriesLost: number;
  categoriesTied: number;
  scheduleWeek: number | null;
  currentOpponentUserId: string | null;
  currentOpponentTeamName: string | null;
  isCurrentUser: boolean;
}

interface SeasonStateData {
  leagueId: string;
  season: number;
  currentWeek: number | null;
  schedule: SeasonStateScheduleWeek[];
  ladder: SeasonStateLadderRow[];
}

function formatRecord(record?: { w: number; l: number; t?: number }) {
  if (!record) return '0-0';
  return record.t ? `${record.w}-${record.l}-${record.t}` : `${record.w}-${record.l}`;
}

function formatRoundStatus(status?: string) {
  if (status === 'in_progress') return 'Live';
  if (status === 'final') return 'Completed';
  return 'Upcoming';
}

function formatPoints(value?: number) {
  if (value == null || Number.isNaN(value)) return '-';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDateLabel(iso?: string) {
  if (!iso) return 'TBC';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'TBC';
  return date.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRelativeTime(iso?: string) {
  if (!iso) return 'No recent activity';

  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return 'No recent activity';

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
}

function loadSeasonStatePayload(payload: unknown): SeasonStateData | null {
  if (!payload || typeof payload !== 'object') return null;

  if ('data' in payload && payload.data && typeof payload.data === 'object') {
    return payload.data as SeasonStateData;
  }

  return payload as SeasonStateData;
}

function OverviewMetricCard({
  eyebrow,
  value,
  detail,
}: {
  eyebrow: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={`${leagueSurfacePatterns.panelCard} p-5`}>
      <p className={leagueSurfacePatterns.sectionEyebrow}>{eyebrow}</p>
      <p className="mt-3 text-3xl font-semibold text-[color:var(--league-text)]">{value}</p>
      <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">{detail}</p>
    </div>
  );
}

export default function LeagueOverview({ league, members, currentUserId }: LeagueOverviewProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [liveOverview, setLiveOverview] = useState<LeagueOverviewData | null>(null);
  const [seasonState, setSeasonState] = useState<SeasonStateData | null>(null);

  const safeMembers = Array.isArray(members) ? members : [];
  const currentUserRole = safeMembers.find((member) => member.userId === currentUserId)?.role;
  const isAdmin = currentUserRole === 'owner' || currentUserRole === 'commissioner';

  useEffect(() => {
    if (!league.id) return;

    let cancelled = false;

    const loadOverview = async () => {
      try {
        const [seasonStateResponse, overview] = await Promise.all([
          fetch(`/api/leagues/${league.id}/season-state`, {
            credentials: 'include',
            cache: 'no-store',
          }).catch(() => null),
          currentUserId
            ? getLeagueOverview(getFirebaseDb(), league.id, currentUserId).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        if (seasonStateResponse?.ok) {
          const payload = await seasonStateResponse.json().catch(() => null);
          setSeasonState(loadSeasonStatePayload(payload));
        }

        if (overview) {
          setLiveOverview(overview);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load league overview snapshot', error);
        }
      }
    };

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [league.id, currentUserId]);

  const currentRound =
    seasonState?.schedule.find((week) => week.current) ??
    seasonState?.schedule.find((week) => week.status === 'in_progress') ??
    seasonState?.schedule.find((week) => week.status !== 'final') ??
    (seasonState?.schedule.length
      ? seasonState.schedule[seasonState.schedule.length - 1]
      : undefined);
  const nextRound =
    seasonState?.schedule.find(
      (week) => week.week > (currentRound?.week ?? 0) && week.status !== 'final'
    ) ?? null;
  const myMembership =
    liveOverview?.membership ?? safeMembers.find((member) => member.userId === currentUserId);
  const myLadderRow =
    seasonState?.ladder.find((row) => row.isCurrentUser) ??
    seasonState?.ladder.find((row) => row.userId === currentUserId) ??
    null;
  const myTeamName = myLadderRow?.teamName ?? myMembership?.teamName ?? 'My Team';
  const myWaiverIndex = liveOverview?.waiver?.orderTop.findIndex(
    (team) => team.teamId === currentUserId || team.teamName === myTeamName
  );
  const myWaiverLabel =
    myWaiverIndex != null && myWaiverIndex >= 0 ? `#${myWaiverIndex + 1}` : 'Unranked';
  const activity = liveOverview?.activity ?? [];
  const activityPreview = activity.slice(0, 5);
  const ladderRows = seasonState?.ladder?.length
    ? seasonState.ladder.slice(0, 5)
    : (liveOverview?.standingsTop ?? []).map((row) => ({
        userId: row.teamId,
        teamName: row.teamName,
        ladderRank: row.rank,
        record: {
          w: row.record?.w ?? 0,
          l: row.record?.l ?? 0,
          t: row.record?.t ?? 0,
        },
        points: row.points ?? 0,
        categoriesWon: 0,
        categoriesLost: 0,
        categoriesTied: 0,
        scheduleWeek: null,
        currentOpponentUserId: null,
        currentOpponentTeamName: null,
        isCurrentUser: row.teamId === currentUserId,
      }));

  const liveCategoryState = liveOverview?.matchup?.categoryLeads?.reduce(
    (summary, category) => {
      if (category.you > category.opp) summary.leads += 1;
      else if (category.you < category.opp) summary.trails += 1;
      else summary.ties += 1;
      return summary;
    },
    { leads: 0, trails: 0, ties: 0 }
  );

  const leagueSnapshot = [
    {
      label: 'Status',
      value: league.status,
    },
    {
      label: 'Teams',
      value: `${safeMembers.length}/${league.maxTeams}`,
    },
    {
      label: 'Categories',
      value: String(league.categories.length),
    },
    {
      label: 'League code',
      value: league.code,
    },
  ];

  const nextEventLabel =
    liveOverview?.league.nextEvent?.label ?? (league.draftDate ? 'Draft' : 'Next event');
  const nextEventValue = liveOverview?.league.nextEvent?.iso ?? league.draftDate ?? null;

  return (
    <div className="space-y-7">
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[32px]"
      >
        <LeagueViewHeader
          eyebrow="League Snapshot"
          title={league.name}
          description="Key league reads for this round."
          chips={leagueSnapshot
            .filter((item) => item.label === 'Status' || item.label === 'Categories')
            .map((item) => ({
              label: `${item.label}: ${item.value}`,
              tone: item.label === 'Status' ? 'accent' : 'neutral',
            }))}
          actions={
            <>
              {isAdmin ? (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 py-2.5 text-sm font-semibold text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
                >
                  <ShareIcon className="h-4 w-4" />
                  Invite managers
                </button>
              ) : null}
              <Link
                href={`/leagues/${league.id}?tab=matchup`}
                className="inline-flex items-center gap-2 rounded-full bg-[color:var(--league-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--league-primary-hover)]"
              >
                Open matchup
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </>
          }
          aside={
            <div className="grid gap-4 md:grid-cols-2">
              <div className={leagueSurfacePatterns.panelCard}>
                <div className="flex items-start gap-3">
                  <CalendarIcon className="mt-0.5 h-5 w-5 text-[color:var(--league-accent)]" />
                  <div>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>{nextEventLabel}</p>
                    <p className="mt-2 text-base font-medium text-[color:var(--league-text)]">
                      {formatDateLabel(nextEventValue ?? undefined)}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                      {nextRound
                        ? `${nextRound.roundLabel} is the next slate on the calendar.`
                        : 'Season schedule is already materialized.'}
                    </p>
                  </div>
                </div>
              </div>
              <div className={leagueSurfacePatterns.panelCard}>
                <div className="flex items-start gap-3">
                  <UserGroupIcon className="mt-0.5 h-5 w-5 text-[color:var(--league-accent)]" />
                  <div>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>League pulse</p>
                    <p className="mt-2 text-base font-medium text-[color:var(--league-text)]">
                      {currentRound
                        ? `${currentRound.roundLabel} • ${formatRoundStatus(currentRound.status)}`
                        : 'Season not started'}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                      {currentRound
                        ? `${currentRound.matchupCount} matchup${currentRound.matchupCount === 1 ? '' : 's'} on the board.`
                        : `${safeMembers.length} teams are in the league.`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          }
        />
      </motion.section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewMetricCard
          eyebrow="Current round"
          value={currentRound?.roundLabel ?? 'Waiting'}
          detail={
            currentRound
              ? `${formatRoundStatus(currentRound.status)}${seasonState?.season ? ` • ${seasonState.season}` : ''}`
              : 'Schedule pending.'
          }
        />
        <OverviewMetricCard
          eyebrow="Ladder spot"
          value={myLadderRow ? `#${myLadderRow.ladderRank}` : 'TBC'}
          detail={
            myLadderRow
              ? `${formatRecord(myLadderRow.record)} record • ${formatPoints(myLadderRow.points)} pts`
              : 'Rank appears after results post.'
          }
        />
        <OverviewMetricCard
          eyebrow="Matchup"
          value={liveOverview?.matchup?.opponentTeam.name ?? 'No matchup'}
          detail={
            liveOverview?.matchup
              ? `${formatPoints(liveOverview.matchup.actual ?? liveOverview.matchup.projected)} score • ${liveOverview.matchup.roundLabel}`
              : currentRound
                ? `${currentRound.roundLabel} matchup loading.`
                : 'No matchup yet.'
          }
        />
        <OverviewMetricCard
          eyebrow="Waiver priority"
          value={myWaiverLabel}
          detail={
            liveOverview?.waiver?.nextRunIso
              ? `Next run ${formatDateLabel(liveOverview.waiver.nextRunIso)}`
              : 'Run not scheduled.'
          }
        />
      </section>

      <LiveGameScoresPanel
        season={seasonState?.season ?? null}
        round={currentRound?.aflRound ?? null}
        title="Live game scores"
        subtitle="Current AFL scores for the active league round."
        emptyLabel={
          currentRound?.roundLabel
            ? `No live AFL games in ${currentRound.roundLabel} right now.`
            : 'No live AFL games right now.'
        }
        compact
      />

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] xl:grid-rows-[auto_auto] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.68fr)_minmax(340px,0.68fr)] 2xl:grid-rows-1 2xl:gap-8">
        <div className="space-y-7 xl:row-span-2 2xl:row-span-1">
          <section className={leagueSurfacePatterns.panelSection}>
            <div className="flex flex-col gap-3 border-b border-[color:var(--league-border)] pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className={leagueSurfacePatterns.sectionEyebrow}>Your team</p>
                <h2 className="mt-2 text-2xl font-semibold text-[color:var(--league-text)]">
                  {myTeamName}
                </h2>
                <p className="mt-2 text-sm text-[color:var(--league-text-muted)]">
                  Standing, matchup, and category split.
                </p>
              </div>
              <Link
                href={`/leagues/${league.id}?tab=roster`}
                className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--league-primary)] transition hover:text-[color:var(--league-primary-hover)]"
              >
                Open roster
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className={leagueSurfacePatterns.subpanel}>
                <p className={leagueSurfacePatterns.sectionEyebrow}>Standing</p>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-4xl font-semibold text-[color:var(--league-text)]">
                    {myLadderRow ? `#${myLadderRow.ladderRank}` : '-'}
                  </span>
                  <span className="pb-1 text-sm text-[color:var(--league-text-muted)]">
                    {myLadderRow ? `${formatRecord(myLadderRow.record)} record` : 'No result'}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2.5 text-sm">
                  <div className={leagueSurfacePatterns.subpanelCompact}>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>Points</p>
                    <p className="mt-1 font-semibold text-[color:var(--league-text)]">
                      {formatPoints(myLadderRow?.points)}
                    </p>
                  </div>
                  <div className={leagueSurfacePatterns.subpanelCompact}>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>Cats won</p>
                    <p className="mt-1 font-semibold text-[color:var(--league-text)]">
                      {myLadderRow?.categoriesWon ?? 0}
                    </p>
                  </div>
                  <div className={leagueSurfacePatterns.subpanelCompact}>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>Cats tied</p>
                    <p className="mt-1 font-semibold text-[color:var(--league-text)]">
                      {myLadderRow?.categoriesTied ?? 0}
                    </p>
                  </div>
                </div>
              </div>

              <div className={leagueSurfacePatterns.subpanel}>
                <p className={leagueSurfacePatterns.sectionEyebrow}>Current battle</p>
                <div className="mt-3">
                  <p className="text-lg font-semibold text-[color:var(--league-text)]">
                    {liveOverview?.matchup?.opponentTeam.name ??
                      myLadderRow?.currentOpponentTeamName ??
                      'Awaiting opponent'}
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                    {liveOverview?.matchup?.roundLabel ??
                      currentRound?.roundLabel ??
                      'Awaiting round data'}
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2.5 text-sm">
                  <div className={leagueSurfacePatterns.subpanelCompact}>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>Score</p>
                    <p className="mt-1 font-semibold text-[color:var(--league-text)]">
                      {formatPoints(
                        liveOverview?.matchup?.actual ?? liveOverview?.matchup?.projected
                      )}
                    </p>
                  </div>
                  <div className={leagueSurfacePatterns.subpanelCompact}>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>Leads</p>
                    <p className="mt-1 font-semibold text-[color:var(--league-success)]">
                      {liveCategoryState?.leads ?? 0}
                    </p>
                  </div>
                  <div className={leagueSurfacePatterns.subpanelCompact}>
                    <p className={leagueSurfacePatterns.sectionEyebrow}>Trailing</p>
                    <p className="mt-1 font-semibold text-[color:var(--league-danger)]">
                      {liveCategoryState?.trails ?? 0}
                    </p>
                  </div>
                </div>
                {liveCategoryState ? (
                  <p className="mt-4 text-sm text-[color:var(--league-text-muted)]">
                    {liveCategoryState.ties} category tie{liveCategoryState.ties === 1 ? '' : 's'}{' '}
                    in play.
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-[color:var(--league-text-muted)]">
                    Category split appears when live matchup data lands.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className={leagueSurfacePatterns.panelSection}>
            <div className="flex items-center justify-between border-b border-[color:var(--league-border)] pb-4">
              <div>
                <p className={leagueSurfacePatterns.sectionEyebrow}>Ladder</p>
                <h2 className="mt-2 text-2xl font-semibold text-[color:var(--league-text)]">
                  Top of the table
                </h2>
              </div>
              <Link
                href={`/leagues/${league.id}?tab=ladder`}
                className="text-sm font-medium text-[color:var(--league-primary)] transition hover:text-[color:var(--league-primary-hover)]"
              >
                Open ladder
              </Link>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--league-border)]">
              <div className="grid grid-cols-[56px_1.4fr_0.7fr_0.7fr] bg-[color:var(--league-surface-muted)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
                <span>Rank</span>
                <span>Team</span>
                <span>Record</span>
                <span>Points</span>
              </div>
              {ladderRows.length > 0 ? (
                ladderRows.map((row) => (
                  <div
                    key={row.userId}
                    className={`grid grid-cols-[56px_1.4fr_0.7fr_0.7fr] items-center border-t border-[color:var(--league-border)] px-4 py-4 text-sm ${
                      row.isCurrentUser
                        ? 'bg-[color:var(--league-primary-soft)]'
                        : 'bg-[color:var(--league-surface)]'
                    }`}
                  >
                    <span className="font-semibold text-[color:var(--league-text)]">
                      {row.ladderRank}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[color:var(--league-text)]">
                        {row.teamName}
                      </p>
                      <p className="mt-1 truncate text-xs text-[color:var(--league-text-muted)]">
                        {row.currentOpponentTeamName
                          ? `Vs ${row.currentOpponentTeamName}`
                          : row.scheduleWeek
                            ? `Week ${row.scheduleWeek}`
                            : 'No current opponent'}
                      </p>
                    </div>
                    <span className="text-[color:var(--league-text-muted)]">
                      {formatRecord(row.record)}
                    </span>
                    <span className="font-medium text-[color:var(--league-text)]">
                      {formatPoints(row.points)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-sm text-[color:var(--league-text-muted)]">
                  Ladder data appears once season state is ready.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className={leagueSurfacePatterns.panelSection}>
          <div className="flex items-center justify-between border-b border-[color:var(--league-border)] pb-4">
            <div>
              <p className={leagueSurfacePatterns.sectionEyebrow}>League pulse</p>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--league-text)]">
                What matters next
              </h2>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className={leagueSurfacePatterns.subpanel}>
              <div className="flex items-start gap-3">
                <ClockIcon className="mt-0.5 h-5 w-5 text-[color:var(--league-text-muted)]" />
                <div>
                  <p className="text-sm font-semibold text-[color:var(--league-text)]">
                    Waiver processing
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                    {liveOverview?.waiver?.nextRunIso
                      ? formatDateLabel(liveOverview.waiver.nextRunIso)
                      : 'No run scheduled.'}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
                    Your current priority is {myWaiverLabel}.
                  </p>
                </div>
              </div>
            </div>

            <div className={leagueSurfacePatterns.subpanel}>
              <div className="flex items-start gap-3">
                <CalendarIcon className="mt-0.5 h-5 w-5 text-[color:var(--league-text-muted)]" />
                <div>
                  <p className="text-sm font-semibold text-[color:var(--league-text)]">
                    Season track
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                    {currentRound
                      ? `${currentRound.roundLabel} is ${formatRoundStatus(currentRound.status).toLowerCase()}.`
                      : 'Round status unavailable.'}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
                    {nextRound
                      ? `${nextRound.roundLabel} is queued next.`
                      : 'No later round queued.'}
                  </p>
                </div>
              </div>
            </div>

            <div className={leagueSurfacePatterns.subpanel}>
              <div className="flex items-start gap-3">
                <UserGroupIcon className="mt-0.5 h-5 w-5 text-[color:var(--league-text-muted)]" />
                <div>
                  <p className="text-sm font-semibold text-[color:var(--league-text)]">
                    League settings
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                    {league.type === 'private' ? 'Private league' : 'Public league'} with{' '}
                    {league.categories.length} scoring categories.
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
                    {safeMembers.length}/{league.maxTeams} spots filled.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={leagueSurfacePatterns.panelSection}>
          <div className="flex items-center justify-between border-b border-[color:var(--league-border)] pb-4">
            <div>
              <p className={leagueSurfacePatterns.sectionEyebrow}>Activity</p>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--league-text)]">
                Recent league moves
              </h2>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {activityPreview.length > 0 ? (
              activityPreview.map((item) => (
                <div key={item.id} className={leagueSurfacePatterns.subpanel}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold capitalize text-[color:var(--league-text)]">
                        {item.kind}
                      </p>
                      <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                        {item.text}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs uppercase tracking-wide text-[color:var(--league-text-muted)]">
                      {formatRelativeTime(item.iso)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[color:var(--league-border)] px-4 py-8 text-sm text-[color:var(--league-text-muted)]">
                Trades, waivers, and admin activity appear here.
              </div>
            )}
          </div>
        </section>
      </div>

      <InviteModal
        league={league}
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
      />
    </div>
  );
}
