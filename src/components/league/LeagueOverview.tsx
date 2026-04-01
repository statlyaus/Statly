'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import {
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  ShareIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';

import { getLeagueOverview, type LeagueOverviewData } from '@/lib/data/leagueApi';
import { getFirebaseDb } from '@/lib/firebaseClient';
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{eyebrow}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{detail}</p>
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
    (seasonState?.schedule.length ? seasonState.schedule[seasonState.schedule.length - 1] : undefined);
  const nextRound =
    seasonState?.schedule.find((week) => week.week > (currentRound?.week ?? 0) && week.status !== 'final') ??
    null;
  const myMembership = liveOverview?.membership ?? safeMembers.find((member) => member.userId === currentUserId);
  const myLadderRow =
    seasonState?.ladder.find((row) => row.isCurrentUser) ??
    seasonState?.ladder.find((row) => row.userId === currentUserId) ??
    null;
  const myTeamName = myLadderRow?.teamName ?? myMembership?.teamName ?? 'My Team';
  const myWaiverIndex = liveOverview?.waiver?.orderTop.findIndex(
    (team) => team.teamId === currentUserId || team.teamName === myTeamName
  );
  const myWaiverLabel = myWaiverIndex != null && myWaiverIndex >= 0 ? `#${myWaiverIndex + 1}` : 'Unranked';
  const activity = liveOverview?.activity ?? [];
  const activityPreview = activity.slice(0, 5);
  const ladderRows =
    seasonState?.ladder?.length
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

  const nextEventLabel = liveOverview?.league.nextEvent?.label ?? (league.draftDate ? 'Draft' : 'Next event');
  const nextEventValue =
    liveOverview?.league.nextEvent?.iso ?? league.draftDate ?? null;

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[32px]"
      >
        <LeagueViewHeader
          eyebrow="League Snapshot"
          title={league.name}
          description="The fastest read on what matters in your league right now: live round state, your standing, your matchup, and the next actions worth taking."
          chips={leagueSnapshot.map((item) => ({
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
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <CalendarIcon className="mt-0.5 h-5 w-5 text-[color:var(--league-accent)]" />
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                        {nextEventLabel}
                      </p>
                      <p className="mt-2 text-base font-medium text-slate-950">
                        {formatDateLabel(nextEventValue ?? undefined)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {nextRound
                          ? `${nextRound.roundLabel} is the next slate on the calendar.`
                          : 'Season schedule is already materialized.'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <UserGroupIcon className="mt-0.5 h-5 w-5 text-[color:var(--league-accent)]" />
                    <div>
                      <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                        League pulse
                      </p>
                      <p className="mt-2 text-base font-medium text-slate-950">
                        {currentRound
                          ? `${currentRound.roundLabel} • ${formatRoundStatus(currentRound.status)}`
                          : 'Season not started'}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {currentRound
                          ? `${currentRound.matchupCount} matchup${currentRound.matchupCount === 1 ? '' : 's'} on the board.`
                          : `${safeMembers.length} teams are in the league.`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  Quick routes
                </p>
                <div className="mt-4 grid gap-2">
                  {[
                    { label: 'Overview', href: 'overview' },
                    { label: 'Ladder', href: 'ladder' },
                    { label: 'Players', href: 'players' },
                    { label: 'Waivers', href: 'waivers' },
                    { label: 'Draft', href: 'draft' },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={`/leagues/${league.id}?tab=${item.href}`}
                      className="flex items-center justify-between rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3 text-sm font-medium text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
                    >
                      <span>{item.label}</span>
                      <ArrowRightIcon className="h-4 w-4" />
                    </Link>
                  ))}
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
              : 'League schedule not materialized yet.'
          }
        />
        <OverviewMetricCard
          eyebrow="Your ladder spot"
          value={myLadderRow ? `#${myLadderRow.ladderRank}` : 'TBC'}
          detail={
            myLadderRow
              ? `${formatRecord(myLadderRow.record)} record • ${formatPoints(myLadderRow.points)} pts`
              : 'Ranking will appear once results are processed.'
          }
        />
        <OverviewMetricCard
          eyebrow="Current matchup"
          value={liveOverview?.matchup?.opponentTeam.name ?? 'No matchup'}
          detail={
            liveOverview?.matchup
              ? `${formatPoints(liveOverview.matchup.actual ?? liveOverview.matchup.projected)} score • ${liveOverview.matchup.roundLabel}`
              : currentRound
                ? `${currentRound.roundLabel} matchup will appear when data is ready.`
                : 'No live matchup data yet.'
          }
        />
        <OverviewMetricCard
          eyebrow="Waiver priority"
          value={myWaiverLabel}
          detail={
            liveOverview?.waiver?.nextRunIso
              ? `Next run ${formatDateLabel(liveOverview.waiver.nextRunIso)}`
              : 'Next waiver run not scheduled.'
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] xl:grid-rows-[auto_auto] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.68fr)_minmax(340px,0.68fr)] 2xl:grid-rows-1 2xl:gap-8">
        <div className="space-y-6 xl:row-span-2 2xl:row-span-1">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Your team</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">{myTeamName}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  The fastest read on your league position, matchup, and category profile.
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

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Standing</p>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-4xl font-semibold text-slate-950">
                    {myLadderRow ? `#${myLadderRow.ladderRank}` : '-'}
                  </span>
                  <span className="pb-1 text-sm text-slate-500">
                    {myLadderRow ? `${formatRecord(myLadderRow.record)} record` : 'No result yet'}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl bg-white px-3 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Points</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {formatPoints(myLadderRow?.points)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Cats won</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {myLadderRow?.categoriesWon ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Cats tied</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {myLadderRow?.categoriesTied ?? 0}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Current battle</p>
                <div className="mt-3">
                  <p className="text-lg font-semibold text-slate-950">
                    {liveOverview?.matchup?.opponentTeam.name ??
                      myLadderRow?.currentOpponentTeamName ??
                      'Awaiting opponent'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {liveOverview?.matchup?.roundLabel ??
                      currentRound?.roundLabel ??
                      'Next matchup will appear here'}
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl bg-white px-3 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Score</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {formatPoints(liveOverview?.matchup?.actual ?? liveOverview?.matchup?.projected)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Leads</p>
                    <p className="mt-1 font-semibold text-emerald-700">
                      {liveCategoryState?.leads ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Trailing</p>
                    <p className="mt-1 font-semibold text-rose-700">
                      {liveCategoryState?.trails ?? 0}
                    </p>
                  </div>
                </div>
                {liveCategoryState ? (
                  <p className="mt-4 text-sm text-slate-500">
                    {liveCategoryState.ties} category tie{liveCategoryState.ties === 1 ? '' : 's'} in play.
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Category-by-category scoring will show here once the matchup feed is ready.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Ladder</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Top of the table</h2>
              </div>
              <Link
                href={`/leagues/${league.id}?tab=ladder`}
                className="text-sm font-medium text-[color:var(--league-primary)] transition hover:text-[color:var(--league-primary-hover)]"
              >
                Open ladder
              </Link>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
              <div className="grid grid-cols-[56px_1.4fr_0.7fr_0.7fr] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>Rank</span>
                <span>Team</span>
                <span>Record</span>
                <span>Points</span>
              </div>
              {ladderRows.length > 0 ? (
                ladderRows.map((row) => (
                  <div
                    key={row.userId}
                    className={`grid grid-cols-[56px_1.4fr_0.7fr_0.7fr] items-center border-t border-slate-100 px-4 py-4 text-sm ${
                      row.isCurrentUser ? 'bg-[color:var(--league-primary-soft)]' : 'bg-white'
                    }`}
                  >
                    <span className="font-semibold text-slate-900">{row.ladderRank}</span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{row.teamName}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {row.currentOpponentTeamName
                          ? `Vs ${row.currentOpponentTeamName}`
                          : row.scheduleWeek
                            ? `Week ${row.scheduleWeek}`
                            : 'No current opponent'}
                      </p>
                    </div>
                    <span className="text-slate-600">{formatRecord(row.record)}</span>
                    <span className="font-medium text-slate-900">{formatPoints(row.points)}</span>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-sm text-slate-500">
                  Ladder data will appear once the season state is materialized.
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">League pulse</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">What matters next</h2>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <ClockIcon className="mt-0.5 h-5 w-5 text-slate-400" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Waiver processing</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {liveOverview?.waiver?.nextRunIso
                      ? formatDateLabel(liveOverview.waiver.nextRunIso)
                      : 'Next run is not scheduled yet.'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">Your current priority is {myWaiverLabel}.</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <CalendarIcon className="mt-0.5 h-5 w-5 text-slate-400" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Season track</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {currentRound
                      ? `${currentRound.roundLabel} is ${formatRoundStatus(currentRound.status).toLowerCase()}.`
                      : 'Schedule status is not available yet.'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {nextRound
                      ? `${nextRound.roundLabel} is queued next.`
                      : 'No later round is scheduled yet.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <UserGroupIcon className="mt-0.5 h-5 w-5 text-slate-400" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">League settings</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {league.type === 'private' ? 'Private league' : 'Public league'} with {league.categories.length}{' '}
                    scoring categories.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {safeMembers.length} of {league.maxTeams} spots filled.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Activity</p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">Recent league moves</h2>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {activityPreview.length > 0 ? (
              activityPreview.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold capitalize text-slate-900">{item.kind}</p>
                      <p className="mt-1 text-sm text-slate-600">{item.text}</p>
                    </div>
                    <span className="shrink-0 text-xs uppercase tracking-wide text-slate-400">
                      {formatRelativeTime(item.iso)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">
                Recent trades, waivers, and league admin changes will appear here.
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
