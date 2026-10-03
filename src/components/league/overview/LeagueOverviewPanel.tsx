'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { StandingsLadderCompact } from '@/components/league/standings/StandingsLadderCompact';
import type { StandingsData } from '@/components/league/standings/standingsFormat';
import { CategoryPreviewScore } from '@/components/scores/CategoryPreviewScore';
import {
  CategoryBoxScore,
  MatchupScoreLine,
  type BoxScoreCategory,
} from '@/components/scores/MatchupScore';
import type { LeagueTradeDigest } from '@/server/leagues/trades/tradeContracts';
import type { League, LeagueMember } from '@/types/leagues';

import { getTeamInitials, getTeamLogoImageStyle } from '../leagueTabPanelUtils';

export type OverviewTarget =
  | 'matchups'
  | 'lineup'
  | 'standings'
  | 'teams'
  | 'trades'
  | 'waivers'
  | 'draft'
  | 'league-settings';

export interface OverviewWaiverClaimSummary {
  id: string;
  playerName: string;
  bidAmount?: number;
}

interface LeagueOverviewPanelProps {
  league: League;
  activeMembers: LeagueMember[];
  currentUserId?: string;
  currentMember?: LeagueMember;
  draftStatusLabel: string;
  waiverPriorityIndex: number;
  waiverPriorityLabel: string;
  waiverPolicyLabel: string;
  categoryLabels: string[];
  tradeDigest?: LeagueTradeDigest | null;
  waiverClaims: OverviewWaiverClaimSummary[];
  waiversStatus: 'idle' | 'loading' | 'ready' | 'error';
  onNavigate: (target: OverviewTarget) => void;
  /** Commissioners get a first-run checklist while the league is not ready to start. */
  isCommissioner?: boolean;
  /** Real reasons the draft cannot start, from the draft readiness payload. */
  draftBlockers?: readonly { id?: string; code?: string; message: string }[];
}

/* Shapes read from GET /api/leagues/[id]/matchups (LeagueMatchupReadModel). Parsed defensively. */
interface MatchupSide {
  id: string;
  teamName: string;
  teamLogoUrl: string | null;
}

interface CategoryRow {
  category: string;
  label: string;
  shortLabel: string;
  homeValue: number | null;
  awayValue: number | null;
  winner: 'home' | 'away' | 'draw' | null;
}

interface RoundMatchup {
  status: 'SCHEDULED' | 'LIVE' | 'FINAL';
  startsAt: string | null;
  homeMember: MatchupSide | null;
  awayMember: MatchupSide | null;
  byeMember: MatchupSide | null;
  homeCategoryWins: number;
  awayCategoryWins: number;
  categoryRows: CategoryRow[];
}

interface StandingRow {
  memberId: string;
  teamName: string;
  teamLogoUrl: string | null;
  wins: number;
  losses: number;
  draws: number;
  categoryWins: number;
  categoryLosses: number;
  categoryDraws: number;
}

interface RoundSnapshot {
  round: number;
  roundEndsAt: string | null;
  matchup: RoundMatchup | null;
  standings: StandingRow[];
}

type SnapshotState =
  { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; snapshot: RoundSnapshot };

export function LeagueOverviewPanel({
  league,
  activeMembers,
  currentUserId,
  currentMember,
  draftStatusLabel,
  waiverPriorityIndex,
  waiverPriorityLabel,
  waiverPolicyLabel,
  categoryLabels,
  tradeDigest,
  waiverClaims,
  waiversStatus,
  onNavigate,
  isCommissioner = false,
  draftBlockers = [],
}: LeagueOverviewPanelProps): React.JSX.Element {
  const [state, setState] = useState<SnapshotState>({ status: 'loading' });

  useEffect(() => {
    if (!currentUserId) {
      setState({ status: 'unavailable' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    authenticatedFetch(`/api/leagues/${encodeURIComponent(league.id)}/matchups`, {}, currentUserId)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as unknown;
        const snapshot = response.ok ? parseRoundSnapshot(payload, currentMember?.id) : null;
        if (!cancelled)
          setState(snapshot ? { status: 'ready', snapshot } : { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [league.id, currentUserId, currentMember?.id]);

  // The ladder comes from the Standings read model, so it matches the Standings tab exactly.
  const [standings, setStandings] = useState<StandingsData | null>(null);
  useEffect(() => {
    if (!currentUserId) {
      setStandings(null);
      return;
    }
    let cancelled = false;
    authenticatedFetch(`/api/leagues/${encodeURIComponent(league.id)}/standings`, {}, currentUserId)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: StandingsData;
        } | null;
        const data =
          response.ok && payload?.success && Array.isArray(payload.data?.teams)
            ? payload.data
            : null;
        if (!cancelled) setStandings(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setStandings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [league.id, currentUserId]);

  const snapshot = state.status === 'ready' ? state.snapshot : null;
  const hasResults =
    snapshot?.standings.some((row) => row.wins + row.losses + row.draws > 0) ?? false;
  const membersById = new Map(activeMembers.map((member) => [member.id, member]));
  const openTeamSlots = Math.max(league.maxTeams - activeMembers.length, 0);

  return (
    <div>
      <h2 id="league-overview-heading" className="sr-only">
        League overview
      </h2>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {isCommissioner &&
          (openTeamSlots > 0 || draftNeedsCommissioner(league, draftBlockers)) ? (
            <SetupChecklist
              league={league}
              memberCount={activeMembers.length}
              draftBlockers={draftBlockers}
              noFixturesYet={Boolean(snapshot && !snapshot.matchup && !hasResults)}
              onNavigate={onNavigate}
            />
          ) : null}

          {snapshot && (snapshot.matchup || hasResults) ? (
            <ThisRoundCard
              snapshot={snapshot}
              currentMember={currentMember}
              timeZone={league.timeZone}
              onNavigate={onNavigate}
            />
          ) : state.status !== 'loading' && league.categories.length > 0 ? (
            <OverviewCard id="overview-preview-heading" title="Your weekly matchup">
              <div className="px-4 py-4">
                <CategoryPreviewScore categories={league.categories} />
                <p className="mt-3 text-sm text-muted-foreground">
                  Each round your team is scored against an opponent across these categories.
                </p>
              </div>
            </OverviewCard>
          ) : null}

          {snapshot && hasResults ? (
            <OverviewCard
              id="overview-ladder-heading"
              title="Ladder"
              action={{ label: 'Standings', onClick: () => onNavigate('standings') }}
            >
              {standings ? (
                <StandingsLadderCompact data={standings} leagueId={league.id} />
              ) : (
                <LadderTable
                  leagueId={league.id}
                  rows={snapshot.standings}
                  currentMemberId={currentMember?.id}
                  membersById={membersById}
                />
              )}
            </OverviewCard>
          ) : (
            <OverviewCard
              id="overview-teams-heading"
              title="Teams"
              subtitle={`${league.maxTeams}-team league`}
              action={{ label: 'View teams', onClick: () => onNavigate('teams') }}
            >
              <ul aria-label="League teams" className="grid sm:grid-cols-2">
                {activeMembers.slice(0, league.maxTeams).map((member) => (
                  <li
                    key={member.id}
                    className={`flex min-w-0 items-center gap-3 border-b border-border px-4 py-2.5 sm:odd:border-r ${
                      member.userId === currentUserId ? 'bg-accent' : ''
                    }`}
                  >
                    <LeagueTeamMark
                      teamName={member.teamName || 'Team'}
                      logoUrl={member.teamLogoUrl ?? null}
                      member={member}
                    />
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                      {member.teamName || 'Unnamed team'}
                    </span>
                    {member.userId === currentUserId && (
                      <span className="ml-auto shrink-0 text-xs font-semibold text-muted-foreground">
                        Your team
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </OverviewCard>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <OverviewCard
            id="overview-trades-heading"
            title="Trade offers"
            action={{ label: 'Trade centre', onClick: () => onNavigate('trades') }}
          >
            {tradeDigest?.recent.length ? (
              <ul className="divide-y divide-border">
                {tradeDigest.recent.map((trade) => (
                  <li key={trade.id} className="px-4 py-2.5">
                    <p className="text-sm font-semibold text-foreground">
                      {trade.teamNames.join(' ↔ ')}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {trade.playerNames.length > 0
                        ? trade.playerNames.join(', ')
                        : 'Player details available in trade centre'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">No pending trade offers.</p>
            )}
          </OverviewCard>

          <OverviewCard
            id="overview-waivers-heading"
            title="Waiver position"
            action={{ label: 'Waivers', onClick: () => onNavigate('waivers') }}
          >
            <div className="px-4 py-3">
              <p className="font-display text-xl font-bold leading-tight text-foreground">
                {waiverPriorityIndex >= 0 ? waiverPriorityLabel : 'Waiver order pending'}
              </p>
              <p className="text-xs capitalize text-muted-foreground">
                {waiverPolicyLabel} waiver order
              </p>
            </div>
            {waiversStatus === 'loading' ? (
              <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                Checking waiver bids...
              </p>
            ) : waiverClaims.length > 0 ? (
              <ul className="divide-y divide-border border-t border-border">
                {waiverClaims.map((claim) => (
                  <li
                    key={claim.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                      {claim.playerName}
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                      {typeof claim.bidAmount === 'number' ? `$${claim.bidAmount}` : 'Claim'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                {waiverPriorityIndex >= 0
                  ? 'No pending waiver bids.'
                  : 'Your position will appear when the order is set.'}
              </p>
            )}
          </OverviewCard>

          <OverviewCard id="overview-details-heading" title="League details">
            <dl className="divide-y divide-border text-sm">
              <DetailRow label="Teams">
                {activeMembers.length} of {league.maxTeams}
                {openTeamSlots > 0
                  ? ` · ${openTeamSlots} ${openTeamSlots === 1 ? 'slot' : 'slots'} open`
                  : ''}
              </DetailRow>
              <DetailRow label="Draft">{draftStatusLabel}</DetailRow>
              <DetailRow label="Waiver order">
                <span className="capitalize">{waiverPolicyLabel}</span>
              </DetailRow>
            </dl>
            <div className="border-t border-border px-4 py-3">
              <h3 className="text-xs font-semibold text-muted-foreground">Scoring categories</h3>
              <p className="mt-1 text-sm leading-6 text-foreground">{categoryLabels.join(' · ')}</p>
            </div>
          </OverviewCard>
        </div>
      </div>
    </div>
  );
}

function OverviewCard({
  id,
  title,
  subtitle,
  action,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={id} className="font-display text-lg font-bold leading-tight text-foreground">
            {title}
          </h2>
          {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="-my-2 inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-md px-2 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
          >
            {action.label}
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold text-foreground">{children}</dd>
    </div>
  );
}

// The draft row only covers what a commissioner can act on: the date and the minimum team count.
// Room creation, draft order and the player pool are system concerns that stay in the draft room.
const MIN_DRAFT_TEAMS = 2; // DraftReadinessService's insufficient_members rule

type DraftBlocker = { code?: string };

function draftNeedsDate(league: League, blockers: readonly DraftBlocker[]): boolean {
  return (
    !league.draftDate ||
    blockers.some((b) => b.code === 'draft_time_missing' || b.code === 'settings_missing')
  );
}

function draftNeedsCommissioner(league: League, blockers: readonly DraftBlocker[]): boolean {
  return (
    draftNeedsDate(league, blockers) || blockers.some((b) => b.code === 'insufficient_members')
  );
}

function SetupChecklist({
  league,
  memberCount,
  draftBlockers,
  noFixturesYet,
  onNavigate,
}: {
  league: League;
  memberCount: number;
  draftBlockers: readonly DraftBlocker[];
  noFixturesYet: boolean;
  onNavigate: (target: OverviewTarget) => void;
}) {
  const [copied, setCopied] = useState(false);
  // Read in the browser only: this panel is server-rendered too.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);
  const inviteUrl = () =>
    `${window.location.origin}/leagues/join?code=${encodeURIComponent(league.code)}`;
  const scheduledFor = draftNeedsDate(league, draftBlockers)
    ? null
    : formatLeagueDateTime(league.draftDate, league.timeZone);
  const needsTeams = draftBlockers.some((b) => b.code === 'insufficient_members');

  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function shareInvite() {
    // A dismissed share sheet rejects; there is nothing to recover.
    navigator.share({ title: `Join ${league.name} on Statly`, url: inviteUrl() }).catch(() => {});
  }

  const buttonClass =
    'min-h-11 shrink-0 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar';
  const rowClass = 'flex flex-wrap items-center justify-between gap-3 px-4 py-3';

  return (
    <section
      aria-labelledby="overview-setup-heading"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border px-4 py-3">
        <h2
          id="overview-setup-heading"
          className="font-display text-lg font-bold leading-tight text-foreground"
        >
          Get your league ready
        </h2>
      </header>
      <ul className="divide-y divide-border text-sm">
        <li className={rowClass}>
          <div>
            <p className="font-semibold text-foreground">Invite managers</p>
            <p className="text-muted-foreground">
              {memberCount} of {league.maxTeams} teams · code{' '}
              <code className="font-semibold text-foreground">{league.code}</code>
            </p>
          </div>
          <div className="flex gap-2">
            {canShare ? (
              <button type="button" onClick={shareInvite} className={buttonClass}>
                Share
              </button>
            ) : null}
            <button type="button" onClick={() => void copyInviteLink()} className={buttonClass}>
              {copied ? 'Copied' : 'Copy invite link'}
            </button>
          </div>
        </li>
        <li className={rowClass}>
          <div>
            <p className="font-semibold text-foreground">Draft</p>
            <p className="text-muted-foreground">{scheduledFor ?? 'Not scheduled'}</p>
            {needsTeams ? (
              <p className="text-muted-foreground">
                Needs at least {MIN_DRAFT_TEAMS} teams to draft ({memberCount} joined)
              </p>
            ) : null}
          </div>
          {scheduledFor ? (
            <button type="button" onClick={() => onNavigate('draft')} className={buttonClass}>
              Open draft
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('league-settings')}
              className={buttonClass}
            >
              Set draft date
            </button>
          )}
        </li>
        {noFixturesYet && league.fixtureGenerationMode === 'MANUAL' ? (
          <li className={rowClass}>
            <div>
              <p className="font-semibold text-foreground">Fixtures</p>
              <p className="text-muted-foreground">Not generated</p>
            </div>
            <button type="button" onClick={() => onNavigate('matchups')} className={buttonClass}>
              Open match centre
            </button>
          </li>
        ) : null}
      </ul>
      <p role="status" className="sr-only">
        {copied ? 'Invite link copied' : ''}
      </p>
    </section>
  );
}

function ThisRoundCard({
  snapshot,
  currentMember,
  timeZone,
  onNavigate,
}: {
  snapshot: RoundSnapshot;
  currentMember?: LeagueMember;
  timeZone?: string;
  onNavigate: (target: OverviewTarget) => void;
}) {
  const { matchup } = snapshot;
  const roundLabel = `Round ${snapshot.round}`;
  const isBye = Boolean(matchup?.byeMember && matchup.byeMember.id === currentMember?.id);
  const viewerIsAway = matchup?.awayMember?.id === currentMember?.id;
  const you = viewerIsAway ? matchup?.awayMember : matchup?.homeMember;
  const opponent = viewerIsAway ? matchup?.homeMember : matchup?.awayMember;

  let statusLine: ReactNode = null;
  if (matchup?.status === 'LIVE') {
    const closes = formatLeagueDateTime(snapshot.roundEndsAt, timeZone);
    statusLine = (
      <>
        <span className="inline-flex items-center gap-1.5 font-bold text-result-loss">
          <span aria-hidden="true" className="size-2 rounded-full bg-result-loss" />
          Live
        </span>
        {closes ? <span>Closes {closes}</span> : null}
      </>
    );
  } else if (matchup?.status === 'FINAL') {
    statusLine = <span className="font-semibold text-foreground">Final</span>;
  } else if (matchup?.startsAt) {
    statusLine = <span>Starts {formatLeagueDateTime(matchup.startsAt, timeZone)}</span>;
  }

  return (
    <section
      aria-labelledby="overview-round-heading"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
        <h2
          id="overview-round-heading"
          className="font-display text-lg font-bold leading-tight text-foreground"
        >
          {roundLabel}
        </h2>
        {statusLine ? (
          <p className="flex items-center gap-3 text-xs text-muted-foreground">{statusLine}</p>
        ) : null}
      </header>

      {isBye ? (
        <p className="px-4 py-4 text-sm text-foreground">You have a bye this round.</p>
      ) : matchup && you && opponent ? (
        <div className="px-4 py-4">
          <MatchupScoreLine
            you={{ teamName: you.teamName, logoUrl: you.teamLogoUrl }}
            opponent={{ teamName: opponent.teamName, logoUrl: opponent.teamLogoUrl }}
            yourWins={viewerIsAway ? matchup.awayCategoryWins : matchup.homeCategoryWins}
            opponentWins={viewerIsAway ? matchup.homeCategoryWins : matchup.awayCategoryWins}
            resultLine={resultLine(matchup, viewerIsAway)}
          />
          {matchup.categoryRows.length > 0 ? (
            <div className="mt-4">
              <CategoryBoxScore
                caption={`${roundLabel} box score, ${you.teamName} against ${opponent.teamName}`}
                categories={toBoxScore(matchup, viewerIsAway)}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No fixture for your team this round yet.
        </p>
      )}

      <div className="grid grid-cols-2 border-t border-border bg-muted text-sm font-semibold">
        <button
          type="button"
          onClick={() => onNavigate('matchups')}
          className="min-h-11 px-4 text-foreground hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-bar"
        >
          Match centre
        </button>
        <button
          type="button"
          onClick={() => onNavigate('lineup')}
          className="min-h-11 border-l border-border px-4 text-foreground hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-bar"
        >
          Set lineup
        </button>
      </div>
    </section>
  );
}

function LadderTable({
  leagueId,
  rows,
  currentMemberId,
  membersById,
}: {
  leagueId: string;
  rows: StandingRow[];
  currentMemberId?: string;
  membersById: Map<string, LeagueMember>;
}) {
  return (
    <table className="w-full table-fixed text-sm tabular-nums">
      <caption className="sr-only">League ladder</caption>
      <colgroup>
        <col className="w-10 sm:w-12" />
        <col />
        <col className="w-16 sm:w-20" />
        <col className="w-16 sm:w-20" />
      </colgroup>
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th scope="col" className="px-4 py-2 text-left font-semibold">
            Pos
          </th>
          <th scope="col" className="py-2 text-left font-semibold">
            Team
          </th>
          <th scope="col" className="px-2 py-2 text-right font-semibold">
            <abbr title="Wins, losses, draws" className="no-underline">
              W–L–D
            </abbr>
          </th>
          <th scope="col" className="px-3 py-2 text-right font-semibold sm:px-4">
            <abbr title="Category record, won–lost" className="no-underline">
              Cats
            </abbr>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const isYou = row.memberId === currentMemberId;
          const member = membersById.get(row.memberId);
          return (
            <tr
              key={row.memberId}
              className={`h-11 border-b border-border last:border-b-0 ${isYou ? 'bg-accent' : ''}`}
            >
              <td
                className={`px-4 ${isYou ? 'font-bold text-foreground' : 'text-muted-foreground'}`}
              >
                {index + 1}
              </td>
              <th scope="row" className="min-w-0 py-1.5 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2.5">
                  <LeagueTeamMark
                    teamName={row.teamName}
                    logoUrl={member?.teamLogoUrl ?? row.teamLogoUrl}
                    member={member}
                  />
                  <Link
                    href={`/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(row.memberId)}`}
                    className={`min-w-0 truncate hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar ${
                      isYou ? 'font-bold text-foreground' : 'font-semibold text-foreground'
                    }`}
                  >
                    {row.teamName}
                  </Link>
                  {isYou ? <span className="sr-only">(your team)</span> : null}
                </span>
              </th>
              <td className="whitespace-nowrap px-2 text-right font-semibold text-foreground">
                {row.wins}–{row.losses}–{row.draws}
              </td>
              <td className="whitespace-nowrap px-3 text-right text-muted-foreground sm:px-4">
                {row.categoryWins}–{row.categoryLosses}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LeagueTeamMark({
  teamName,
  logoUrl,
  member,
}: {
  teamName: string;
  logoUrl: string | null;
  member?: LeagueMember;
}) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center overflow-hidden rounded font-display text-xs font-bold leading-none ${
        logoUrl ? 'bg-muted' : 'bg-brand-bar text-brand-bar-foreground'
      }`}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${teamName} symbol`}
          referrerPolicy="no-referrer"
          style={member ? getTeamLogoImageStyle(member) : undefined}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{getTeamInitials(teamName)}</span>
      )}
    </span>
  );
}

function resultLine(matchup: RoundMatchup, viewerIsAway: boolean): string {
  const yours = viewerIsAway ? matchup.awayCategoryWins : matchup.homeCategoryWins;
  const theirs = viewerIsAway ? matchup.homeCategoryWins : matchup.awayCategoryWins;
  const margin = Math.abs(yours - theirs);
  const categories = `${margin} ${margin === 1 ? 'category' : 'categories'}`;
  if (matchup.status === 'FINAL') {
    if (yours === theirs) return `Drawn ${yours}–${theirs}`;
    return yours > theirs ? `You won ${yours}–${theirs}` : `You lost ${yours}–${theirs}`;
  }
  if (matchup.status === 'LIVE') {
    if (yours === theirs) return 'Scores level';
    return yours > theirs ? `You lead by ${categories}` : `You trail by ${categories}`;
  }
  return 'Not started';
}

function toBoxScore(matchup: RoundMatchup, viewerIsAway: boolean): BoxScoreCategory[] {
  const started = matchup.status !== 'SCHEDULED';
  return matchup.categoryRows.map((row) => {
    const yourSide = viewerIsAway ? 'away' : 'home';
    const result: BoxScoreCategory['result'] =
      !started || row.winner === null
        ? 'pending'
        : row.winner === 'draw'
          ? 'drawn'
          : row.winner === yourSide
            ? 'won'
            : 'lost';
    return {
      key: row.category,
      label: row.label,
      shortLabel: row.shortLabel,
      result,
      yourValue: started ? (viewerIsAway ? row.awayValue : row.homeValue) : null,
      opponentValue: started ? (viewerIsAway ? row.homeValue : row.awayValue) : null,
    };
  });
}

function formatLeagueDateTime(value: string | null | undefined, timeZone?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/* ---------- defensive parsing of the matchups read model ---------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseSide(value: unknown): MatchupSide | null {
  if (!isObject(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    teamName: stringOrNull(value.teamName) ?? 'Team',
    teamLogoUrl: stringOrNull(value.teamLogoUrl),
  };
}

function parseMatchup(value: unknown): RoundMatchup | null {
  if (!isObject(value)) return null;
  const status = value.status === 'LIVE' || value.status === 'FINAL' ? value.status : 'SCHEDULED';
  const rows = Array.isArray(value.categoryRows) ? value.categoryRows : [];
  return {
    status,
    startsAt: stringOrNull(value.startsAt),
    homeMember: parseSide(value.homeMember),
    awayMember: parseSide(value.awayMember),
    byeMember: parseSide(value.byeMember),
    homeCategoryWins: numberOr(value.homeCategoryWins, 0),
    awayCategoryWins: numberOr(value.awayCategoryWins, 0),
    categoryRows: rows.filter(isObject).map((row) => ({
      category: String(row.category ?? ''),
      label: stringOrNull(row.label) ?? String(row.category ?? ''),
      shortLabel: stringOrNull(row.shortLabel) ?? String(row.category ?? ''),
      homeValue: numberOrNull(row.homeValue),
      awayValue: numberOrNull(row.awayValue),
      winner:
        row.winner === 'home' || row.winner === 'away' || row.winner === 'draw' ? row.winner : null,
    })),
  };
}

function parseStanding(value: unknown): StandingRow | null {
  if (!isObject(value) || typeof value.memberId !== 'string') return null;
  return {
    memberId: value.memberId,
    teamName: stringOrNull(value.teamName) ?? 'Team',
    teamLogoUrl: stringOrNull(value.teamLogoUrl),
    wins: numberOr(value.wins, 0),
    losses: numberOr(value.losses, 0),
    draws: numberOr(value.draws, 0),
    categoryWins: numberOr(value.categoryWins, 0),
    categoryLosses: numberOr(value.categoryLosses, 0),
    categoryDraws: numberOr(value.categoryDraws, 0),
  };
}

export function parseRoundSnapshot(
  payload: unknown,
  currentMemberId: string | undefined
): RoundSnapshot | null {
  if (!isObject(payload) || payload.success !== true || !isObject(payload.data)) return null;
  const data = payload.data;
  const matchups = (Array.isArray(data.matchups) ? data.matchups : [])
    .map(parseMatchup)
    .filter((matchup): matchup is RoundMatchup => matchup !== null);
  const viewerMatchup =
    matchups.find(
      (matchup) =>
        matchup.homeMember?.id === currentMemberId ||
        matchup.awayMember?.id === currentMemberId ||
        matchup.byeMember?.id === currentMemberId
    ) ?? null;
  const roundContext = isObject(data.roundContext) ? data.roundContext : null;
  return {
    round: numberOr(data.round, 1),
    roundEndsAt: roundContext ? stringOrNull(roundContext.endsAt) : null,
    matchup: viewerMatchup,
    standings: (Array.isArray(data.standings) ? data.standings : [])
      .map(parseStanding)
      .filter((row): row is StandingRow => row !== null),
  };
}
