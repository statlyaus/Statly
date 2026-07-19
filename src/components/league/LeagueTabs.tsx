'use client';

import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type {
  CategoryDirection,
  League,
  LeagueFixtureGenerationMode,
  LeagueLineupSlotSettings,
  LeagueMember,
  LeagueMemberNotificationSettings,
  LeagueScoringMode,
} from '@/types/leagues';
import {
  FANTASY_CATEGORIES,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import {
  DEFAULT_DRAFT_AUTO_PICK_RULES,
  DEFAULT_DRAFT_POSITION_LIMITS,
  POSITION_LIMIT_KEYS,
  TIME_PER_PICK_OPTIONS,
  type DraftAutoPickRules,
  type DraftPickOrderMode,
  type DraftPositionLimits,
  type PositionLimitKey,
} from '@/lib/draftSettings';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { MAX_LEAGUE_TEAMS, MIN_LEAGUE_TEAMS } from '@/server/leagues/leagueCapacity';
import {
  DEFAULT_TEAM_SYMBOL_ZOOM,
  MAX_TEAM_SYMBOL_ZOOM,
  MIN_TEAM_SYMBOL_ZOOM,
} from '@/lib/teamSymbol';
import MyTeamPanel from '@/components/MyTeamPanel';
import LeagueWaiversContainer from '@/components/waivers/LeagueWaiversContainer';
import type { Player, Team } from '@/types/players';
import DraftManager from './DraftManager';
import { LeagueLineupPanel } from './matchups/LeagueLineupPanel';
import { LeagueMatchupsPanel } from './matchups/LeagueMatchupsPanel';
import { LeagueStandingsPanel } from './matchups/LeagueStandingsPanel';
import { CompetitionSettingsPanel } from './settings/CompetitionSettingsPanel';
import { ScoringSettingsPanel } from './settings/ScoringSettingsPanel';

interface LeagueTabsProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
  onMembersChange?: (members: LeagueMember[]) => void;
}

type TabType =
  | 'overview'
  | 'teams'
  | 'roster'
  | 'matchups'
  | 'lineup'
  | 'standings'
  | 'trades'
  | 'waivers'
  | 'draft'
  | 'social'
  | 'team-settings'
  | 'league-settings';

interface Tab {
  id: TabType;
  name: string;
  icon?: React.ReactNode;
  badge?: number;
}

type OverviewTradeSummary = {
  tradeId: string;
  tradeName?: string;
  status: string;
  playerNames: string[];
  lastUpdated?: number;
};

type OverviewWaiverClaim = {
  id: string;
  playerId: string;
  playerName: string;
  bidAmount?: number;
};

type TeamNotificationToggleKey = 'tradePush' | 'waiverPush' | 'draftReminder' | 'scoringAlerts';

const TAB_IDS: readonly TabType[] = [
  'overview',
  'teams',
  'roster',
  'matchups',
  'lineup',
  'standings',
  'trades',
  'waivers',
  'draft',
  'team-settings',
  'league-settings',
];

function isLeagueTab(value: unknown): value is TabType {
  return typeof value === 'string' && TAB_IDS.includes(value as TabType);
}

function getLeagueTabFromSearch(
  value: string | null,
  canAccessCompetitionRules = false
): TabType | null {
  if (value === 'settings' || value === 'league-settings') {
    return canAccessCompetitionRules ? 'league-settings' : 'team-settings';
  }

  return isLeagueTab(value) ? value : null;
}

export default function LeagueTabs({
  league,
  members,
  currentUserId,
  onMembersChange,
}: LeagueTabsProps): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [teamActionMessage, setTeamActionMessage] = useState<LeagueSettingsMessage | null>(null);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [overviewTrades, setOverviewTrades] = useState<OverviewTradeSummary[]>([]);
  const [overviewTradesStatus, setOverviewTradesStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [overviewWaiverClaims, setOverviewWaiverClaims] = useState<OverviewWaiverClaim[]>([]);
  const [overviewWaiversStatus, setOverviewWaiversStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [socialUnread, setSocialUnread] = useState({ chat: 0, board: 0 });

  const currentMember = members.find((member) => member.userId === currentUserId);
  const selectedPlayerId = searchParams?.get('playerId') ?? null;
  const isLeagueOwner = Boolean(currentUserId) && currentUserId === league.ownerId;
  const isAdmin =
    isLeagueOwner || currentMember?.role === 'owner' || currentMember?.role === 'manager';
  const isCoCommissioner = currentMember?.isCoCommissioner === true;
  const canAccessCompetitionRules = isAdmin || isCoCommissioner;
  const canRemoveTeams = Boolean(currentUserId) && currentUserId === league.ownerId;
  const activeMembers = members.filter((member) => member.isActive !== false);
  const openTeamSlots = Math.max(league.maxTeams - activeMembers.length, 0);
  const waiverOrder = league.waiverWire?.waiverOrder ?? [];
  const waiverPriorityIndex = currentMember
    ? waiverOrder.findIndex(
        (memberId) => memberId === currentMember.id || memberId === currentMember.userId
      )
    : -1;
  const waiverPriorityLabel =
    waiverPriorityIndex >= 0 ? `Priority ${waiverPriorityIndex + 1}` : 'Not set';
  const waiverPolicyLabel = league.waiverRule ?? league.waiverWire?.waiverResetPolicy ?? 'weekly';
  const overviewTeams = activeMembers.slice(0, league.maxTeams);
  const categoryLabels = league.categories.map(
    (category) => FANTASY_CATEGORIES[category]?.label ?? category
  );

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    void authenticatedFetch(`/api/leagues/${league.id}/social/summary`, {}, currentUserId)
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          data?: { unread?: { chat?: number; board?: number } };
        };
      })
      .then((body) => {
        if (cancelled || !body?.data?.unread) return;
        setSocialUnread({
          chat: body.data.unread.chat ?? 0,
          board: body.data.unread.board ?? 0,
        });
      })
      .catch(() => {
        // Social has its own retry state; league navigation remains available.
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, league.id]);

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = getLeagueTabFromSearch(
      searchParams?.get('tab') ?? null,
      canAccessCompetitionRules
    );
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
      return;
    }

    if (activeTab === 'league-settings' && !canAccessCompetitionRules) {
      setActiveTab('team-settings');
    }
  }, [activeTab, canAccessCompetitionRules, searchParams]);

  const handleTabChange = (tabId: TabType) => {
    if (tabId === 'social') {
      router.push(`/leagues/${league.id}/social`);
      return;
    }
    setActiveTab(tabId);
    const newUrl = `${pathname}?tab=${tabId}`;
    router.push(newUrl, { scroll: false });
  };

  const baseTabs: Tab[] = [
    { id: 'overview', name: 'Overview' },
    { id: 'teams', name: 'Teams' },
    { id: 'roster', name: 'My Roster' },
    { id: 'matchups', name: 'Matchups' },
    { id: 'lineup', name: 'My Lineup' },
    { id: 'standings', name: 'Standings' },
    { id: 'trades', name: 'Trades' },
    { id: 'waivers', name: 'Waivers' },
    { id: 'draft', name: 'Draft' },
    {
      id: 'social',
      name: 'Social',
      badge: socialUnread.chat + socialUnread.board || undefined,
    },
    { id: 'team-settings', name: 'Team Settings' },
  ];
  const tabs: Tab[] = canAccessCompetitionRules
    ? [
        ...baseTabs,
        { id: 'league-settings', name: isAdmin ? 'League Settings' : 'Competition Rules' },
      ]
    : baseTabs;
  const waiverMembersIndex = useMemo(
    () =>
      Object.fromEntries(
        members.map((member) => [
          member.userId,
          {
            userId: member.userId,
            teamId: member.id,
            teamName: member.teamName,
          },
        ])
      ),
    [members]
  );
  const draftReadiness = league.draftReadiness ?? null;
  const isDraftComplete =
    draftReadiness?.status === 'completed' ||
    draftReadiness?.lifecycle.isComplete === true ||
    league.status === 'completed';
  const draftRoomPath =
    !isDraftComplete && draftReadiness?.draftId && draftReadiness.lifecycle.canEnterRoom
      ? `/drafts/${draftReadiness.draftId}`
      : null;
  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;

    async function loadOverviewTrades() {
      setOverviewTradesStatus('loading');

      try {
        const response = await authenticatedFetch(
          `/api/trades/list?leagueId=${encodeURIComponent(league.id)}&status=PENDING&pageSize=3`,
          {},
          currentUserId
        );

        if (!response?.ok) {
          throw new Error(`status ${response?.status ?? 'unknown'}`);
        }

        const payload = (await response.json()) as unknown;
        const trades = isRecord(payload) && Array.isArray(payload.trades) ? payload.trades : [];
        const summaries = trades
          .map((trade): OverviewTradeSummary | null => {
            if (!isRecord(trade) || !isRecord(trade.summary)) return null;
            const summary = trade.summary;
            const tradeId =
              typeof summary.tradeId === 'string'
                ? summary.tradeId
                : typeof trade.tradeId === 'string'
                  ? trade.tradeId
                  : null;

            if (!tradeId) return null;

            return {
              tradeId,
              tradeName: typeof summary.tradeName === 'string' ? summary.tradeName : undefined,
              status: typeof summary.status === 'string' ? summary.status : 'PENDING',
              playerNames: Array.isArray(summary.playerNames)
                ? summary.playerNames.filter((name): name is string => typeof name === 'string')
                : [],
              lastUpdated:
                typeof summary.lastUpdated === 'number' ? summary.lastUpdated : undefined,
            };
          })
          .filter((trade): trade is OverviewTradeSummary => trade !== null);

        if (!cancelled) {
          setOverviewTrades(summaries);
          setOverviewTradesStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setOverviewTrades([]);
          setOverviewTradesStatus('error');
        }
      }
    }

    void loadOverviewTrades();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, league.id]);

  useEffect(() => {
    if (!currentUserId) return;

    const controller = new AbortController();

    async function loadOverviewWaivers() {
      setOverviewWaiversStatus('loading');

      try {
        const response = await fetch(
          `/api/leagues/${encodeURIComponent(league.id)}/waivers?playersLimit=0&activityLimit=0`,
          { signal: controller.signal }
        );
        const payload = (await response.json().catch(() => ({}))) as unknown;

        if (!response.ok) {
          throw new Error(`status ${response.status}`);
        }

        const claims = isRecord(payload) && Array.isArray(payload.claims) ? payload.claims : [];
        const playersIndex =
          isRecord(payload) && isRecord(payload.playersIndex) ? payload.playersIndex : {};
        const pendingClaims = claims
          .map((claim): OverviewWaiverClaim | null => {
            if (!isRecord(claim)) return null;
            const id = typeof claim.id === 'string' ? claim.id : null;
            const playerId = typeof claim.playerId === 'string' ? claim.playerId : null;
            const status = typeof claim.status === 'string' ? claim.status : 'PENDING';

            if (!id || !playerId || status !== 'PENDING') return null;

            const player = playersIndex[playerId];
            const playerName =
              isRecord(player) && typeof player.name === 'string'
                ? player.name
                : `Player ${playerId}`;

            return {
              id,
              playerId,
              playerName,
              bidAmount: typeof claim.bidAmount === 'number' ? claim.bidAmount : undefined,
            };
          })
          .filter((claim): claim is OverviewWaiverClaim => claim !== null)
          .slice(0, 3);

        if (!controller.signal.aborted) {
          setOverviewWaiverClaims(pendingClaims);
          setOverviewWaiversStatus('ready');
        }
      } catch {
        if (!controller.signal.aborted) {
          setOverviewWaiverClaims([]);
          setOverviewWaiversStatus('error');
        }
      }
    }

    void loadOverviewWaivers();

    return () => {
      controller.abort();
    };
  }, [currentUserId, league.id]);

  const handleRemoveMember = async (member: LeagueMember) => {
    if (!canRemoveTeams || member.userId === league.ownerId) return;

    try {
      setRemovingUserId(member.userId);
      setTeamActionMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/members`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'removeMember',
            targetUserId: member.userId,
          }),
        },
        currentUserId
      );
      const payload = (await response.json()) as unknown;

      if (!response.ok || !isRecord(payload) || payload.success !== true) {
        const message =
          isRecord(payload) && typeof payload.error === 'string'
            ? payload.error
            : `status ${response.status}`;
        throw new Error(message);
      }

      const nextMembers = members.filter((candidate) => candidate.userId !== member.userId);
      onMembersChange?.(nextMembers);
      if (!onMembersChange) {
        router.refresh?.();
      }
      setPendingRemoveUserId(null);
      setTeamActionMessage({ type: 'success', text: `${member.teamName} removed.` });
    } catch (error) {
      setTeamActionMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to remove team.',
      });
    } finally {
      setRemovingUserId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[22px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_18px_60px_-48px_rgba(23,34,48,0.38)]">
        <div className="border-b border-[color:var(--league-border)] bg-[color:var(--league-page)]/80">
          <nav className="flex gap-1 overflow-x-auto px-3 py-3" aria-label="League sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`inline-flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] ${
                  activeTab === tab.id
                    ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)] shadow-sm'
                    : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{tab.name}</span>
                  {tab.badge && (
                    <span className="rounded-full bg-[color:var(--league-danger-soft)] px-2 py-0.5 text-xs font-semibold text-[color:var(--league-danger)]">
                      {tab.badge}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-5 sm:p-6">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="space-y-4">
                  <section className="rounded-[22px] bg-[color:var(--league-primary)] p-5 text-[color:var(--league-primary-foreground)] shadow-[0_24px_70px_-48px_rgba(15,23,42,0.7)] sm:p-6">
                    <div className="flex flex-col gap-6">
                      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/65">
                            League overview
                          </p>
                          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                            {league.name}
                          </h2>
                          <p className="mt-2 text-sm text-white/70">
                            {league.type === 'private' ? 'Private' : 'Public'} ·{' '}
                            {activeMembers.length}/{league.maxTeams} teams · Draft{' '}
                            {draftReadiness?.status ?? league.status}
                          </p>
                          <p className="mt-1 text-sm text-white/55">
                            {openTeamSlots === 0
                              ? 'League is full'
                              : `${openTeamSlots} team ${openTeamSlots === 1 ? 'slot' : 'slots'} open`}
                          </p>
                        </div>

                        <dl className="grid gap-5 sm:grid-cols-2 lg:min-w-[22rem]">
                          <div>
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
                              Your team
                            </dt>
                            <dd className="mt-2 text-lg font-semibold text-white">
                              {currentMember?.teamName ?? 'Team not set'}
                            </dd>
                            <p className="mt-1 text-sm text-white/70">
                              {currentMember?.role === 'owner' || currentMember?.role === 'manager'
                                ? 'Commissioner access'
                                : 'Member access'}
                            </p>
                          </div>
                          <div>
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
                              Waiver position
                            </dt>
                            <dd className="mt-2 text-lg font-semibold text-white">
                              {waiverPriorityLabel}
                            </dd>
                            <p className="mt-1 text-sm capitalize text-white/70">
                              {waiverPolicyLabel} order
                            </p>
                          </div>
                        </dl>
                      </div>

                      <div className="border-t border-white/15 pt-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
                          Scoring categories
                        </p>
                        <p className="mt-2 text-sm leading-6 text-white/80">
                          {categoryLabels.join(' · ')}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                          Teams
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-[color:var(--league-text)]">
                          {league.maxTeams}-team league
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTabChange('teams')}
                        className="inline-flex h-9 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                      >
                        View teams
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                      {overviewTeams.map((member) => (
                        <div
                          key={member.id}
                          className="group flex min-h-32 flex-col items-center justify-center rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-3 text-center transition hover:-translate-y-0.5 hover:border-[color:var(--league-primary)] hover:bg-[color:var(--league-surface)] hover:shadow-md"
                        >
                          <div className="flex size-24 items-center justify-center overflow-hidden rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-sm sm:size-28">
                            {member.teamLogoUrl ? (
                              <img
                                src={member.teamLogoUrl}
                                alt={`${member.teamName || 'Team'} symbol`}
                                referrerPolicy="no-referrer"
                                style={getTeamLogoImageStyle(member)}
                                className="h-full w-full object-cover will-change-transform"
                              />
                            ) : (
                              <span className="text-lg font-semibold text-[color:var(--league-text-muted)]">
                                {getTeamInitials(member.teamName || 'Team')}
                              </span>
                            )}
                          </div>
                          <p className="mt-3 text-sm font-semibold leading-5 text-[color:var(--league-text)]">
                            {member.teamName || 'Unnamed team'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_-48px_rgba(15,23,42,0.35)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Trades
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-950">Trade offers</h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => router.push(`/leagues/${league.id}/trades`)}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                      >
                        Trade centre
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      {overviewTradesStatus === 'loading' ? (
                        <p className="text-sm text-slate-600">Checking offers...</p>
                      ) : overviewTrades.length > 0 ? (
                        overviewTrades.map((trade) => (
                          <div
                            key={trade.tradeId}
                            className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                          >
                            <p className="text-sm font-semibold text-slate-950">
                              {trade.tradeName ?? `Trade ${trade.tradeId.slice(0, 8)}`}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {trade.playerNames.length > 0
                                ? trade.playerNames.join(', ')
                                : 'Player details available in trade centre'}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
                          No pending trade offers.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_-48px_rgba(15,23,42,0.35)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Waivers
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-slate-950">
                          Waiver position
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTabChange('waivers')}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                      >
                        Waivers
                      </button>
                    </div>
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-2xl font-semibold text-slate-950">{waiverPriorityLabel}</p>
                      <p className="mt-1 text-sm capitalize text-slate-600">
                        {waiverPolicyLabel} waiver order
                      </p>
                      {overviewWaiversStatus === 'loading' ? (
                        <p className="mt-3 text-sm text-slate-600">Checking waiver bids...</p>
                      ) : overviewWaiverClaims.length > 0 ? (
                        <div className="mt-4 space-y-2">
                          {overviewWaiverClaims.map((claim) => (
                            <div
                              key={claim.id}
                              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                            >
                              <p className="min-w-0 truncate text-sm font-semibold text-slate-950">
                                {claim.playerName}
                              </p>
                              <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                {typeof claim.bidAmount === 'number'
                                  ? `$${claim.bidAmount}`
                                  : 'Claim'}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-slate-600">
                          {waiverPriorityIndex >= 0 ? 'No pending waiver bids.' : 'Not set.'}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'teams' && (
              <section className="space-y-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                      Team registry
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--league-text)]">
                      League Teams
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm text-[color:var(--league-text-muted)]">
                      Active ownership and team access for {league.name}. Commissioner actions are
                      available only where the team can be managed.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-page)]">
                    <div className="border-r border-[color:var(--league-border)] px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                        Active
                      </p>
                      <p className="mt-1 text-xl font-semibold text-[color:var(--league-text)]">
                        {members.length}
                      </p>
                    </div>
                    <div className="border-r border-[color:var(--league-border)] px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                        Capacity
                      </p>
                      <p className="mt-1 text-xl font-semibold text-[color:var(--league-text)]">
                        {league.maxTeams}
                      </p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                        Open
                      </p>
                      <p className="mt-1 text-xl font-semibold text-[color:var(--league-text)]">
                        {Math.max(league.maxTeams - members.length, 0)}
                      </p>
                    </div>
                  </div>
                </div>
                {teamActionMessage && (
                  <div
                    role={teamActionMessage.type === 'error' ? 'alert' : 'status'}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      teamActionMessage.type === 'error'
                        ? 'border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] text-[color:var(--league-danger)]'
                        : 'border-[color:var(--league-success)]/30 bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]'
                    }`}
                  >
                    {teamActionMessage.text}
                  </div>
                )}
                <div className="overflow-hidden rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)]">
                  <table className="min-w-full table-fixed border-collapse text-left">
                    <colgroup>
                      <col className="w-[34%]" />
                      <col className="w-[16%]" />
                      <col className="w-[18%]" />
                      <col className="w-[18%]" />
                      <col className="w-[14%]" />
                    </colgroup>
                    <thead className="bg-[color:var(--league-page)]">
                      <tr className="border-b border-[color:var(--league-border)]">
                        <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                          Team
                        </th>
                        <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                          Access
                        </th>
                        <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                          Status
                        </th>
                        <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                          Joined
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--league-border)]">
                      {members.map((member) => {
                        const roleLabel = getLeagueMemberRoleLabel(member, league);
                        const canRemoveMember = canRemoveTeams && member.userId !== league.ownerId;

                        return (
                          <tr
                            key={member.id}
                            className="bg-[color:var(--league-surface)] transition-colors hover:bg-[color:var(--league-page)]"
                          >
                            <td className="px-4 py-4">
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-page)] text-sm font-semibold text-[color:var(--league-text)]">
                                  {getTeamInitials(member.teamName)}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-[color:var(--league-text)]">
                                    {member.teamName || 'Unnamed team'}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-[color:var(--league-text-muted)]">
                                    {member.userId}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <span className="inline-flex h-7 items-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-xs font-semibold text-[color:var(--league-text)]">
                                {roleLabel}
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <span className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--league-text)]">
                                <span
                                  className={`size-2 rounded-full ${
                                    member.isActive
                                      ? 'bg-[color:var(--league-success)]'
                                      : 'bg-[color:var(--league-text-muted)]'
                                  }`}
                                />
                                {member.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-sm text-[color:var(--league-text-muted)]">
                              {formatLeagueMemberJoinedAt(member.joinedAt)}
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex justify-end">
                                {canRemoveMember ? (
                                  pendingRemoveUserId === member.userId ? (
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleRemoveMember(member)}
                                        disabled={removingUserId === member.userId}
                                        aria-label={`Confirm remove ${member.teamName}`}
                                        className="inline-flex h-9 items-center justify-center rounded-md bg-[color:var(--league-danger)] px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-danger)] disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {removingUserId === member.userId ? 'Removing' : 'Confirm'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setPendingRemoveUserId(null)}
                                        disabled={removingUserId === member.userId}
                                        className="inline-flex h-9 items-center justify-center rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 text-xs font-semibold text-[color:var(--league-text)] transition-colors hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setPendingRemoveUserId(member.userId)}
                                      aria-label={`Remove ${member.teamName}`}
                                      className="inline-flex h-9 items-center justify-center rounded-md border border-[color:var(--league-danger)]/30 bg-[color:var(--league-surface)] px-3 text-xs font-semibold text-[color:var(--league-danger)] transition-colors hover:bg-[color:var(--league-danger-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-danger)]"
                                    >
                                      Remove
                                    </button>
                                  )
                                ) : (
                                  <span className="text-xs font-medium text-[color:var(--league-text-muted)]">
                                    -
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {activeTab === 'roster' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">My Roster</h2>
                <MyTeamRosterManager
                  league={league}
                  members={members}
                  currentUserId={currentUserId}
                />
              </div>
            )}

            {activeTab === 'matchups' && (
              <LeagueMatchupsPanel leagueId={league.id} currentUserId={currentUserId} />
            )}

            {activeTab === 'lineup' && (
              <LeagueLineupPanel leagueId={league.id} currentUserId={currentUserId} />
            )}

            {activeTab === 'standings' && (
              <LeagueStandingsPanel leagueId={league.id} currentUserId={currentUserId} />
            )}

            {activeTab === 'trades' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Trades</h2>
                  <button
                    type="button"
                    onClick={() => router.push(`/leagues/${league.id}/trades`)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Open trade centre
                  </button>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                  <p className="text-sm text-gray-600">
                    Review proposals, counters, and commissioner decisions in the league trade
                    centre.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'waivers' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Waiver Wire</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Submit claims, review your queue, and track league waiver activity.
                  </p>
                </div>
                <LeagueWaiversContainer
                  leagueId={league.id}
                  currentUserId={currentUserId}
                  membersIndex={waiverMembersIndex}
                  selectedCategories={league.categories}
                  initialPlayerId={selectedPlayerId}
                />
              </div>
            )}

            {activeTab === 'draft' && (
              <div className="space-y-4">
                {draftReadiness && (
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                          {draftRoomPath ? 'Draft room ready' : 'Draft setup status'}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                          {draftRoomPath
                            ? draftReadiness.lifecycle.isRunning
                              ? 'The draft is live now.'
                              : 'The lobby is available for this league.'
                            : (draftReadiness.blockers[0]?.message ??
                              'Save draft settings to prepare the draft room.')}
                        </p>
                      </div>
                      {draftRoomPath && (
                        <button
                          type="button"
                          onClick={() => router.push(draftRoomPath)}
                          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                        >
                          Enter draft room
                        </button>
                      )}
                    </div>
                    {!draftRoomPath && draftReadiness.blockers.length > 1 && (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
                        {draftReadiness.blockers.slice(1).map((blocker) => (
                          <li key={blocker.code}>{blocker.message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <DraftManager
                  league={league}
                  members={members}
                  currentUserId={currentUserId}
                  onDraftCreated={(draftId) => router.push(`/drafts/${draftId}`)}
                  onJoinDraftRoom={(draftId) => router.push(`/drafts/${draftId}`)}
                />
              </div>
            )}

            {activeTab === 'team-settings' && (
              <TeamSettingsPanel
                league={league}
                currentUserId={currentUserId}
                currentMember={currentMember}
                onMemberChange={(nextMember) => {
                  const nextMembers = members.map((member) =>
                    member.id === nextMember.id ? { ...member, ...nextMember } : member
                  );
                  onMembersChange?.(nextMembers);
                }}
              />
            )}

            {activeTab === 'league-settings' && (
              <LeagueSettingsPanel
                league={league}
                memberCount={members.length}
                isAdmin={isAdmin}
                canAccessCompetitionRules={canAccessCompetitionRules}
                isActive
                currentUserId={currentUserId}
              />
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

type LeagueSettingsDraftType = 'snake' | 'linear';
type LeagueSettingsWaiverRule = 'weekly' | 'rolling';

interface LeagueSettingsResponse {
  league: {
    id: string;
    name: string;
    code: string;
    maxTeams: number;
    locked: boolean;
  };
  scoring: {
    scoringFormat: 'nine-category';
    categories: FantasyCategoryKey[];
    scoringMode: LeagueScoringMode;
    fixtureGenerationMode: LeagueFixtureGenerationMode;
    lineupSlots: LeagueLineupSlotSettings;
    categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
    scoringSettingsLockedAt: string | null;
  };
  roster: {
    rosterSize: number;
    benchSize: number;
    positionLimits: DraftPositionLimits;
  };
  draft: {
    draftDate: string;
    draftType: LeagueSettingsDraftType;
    timePerPick: number;
    pickOrder: DraftPickOrderMode;
    timeZone: string;
    autoPickRules: DraftAutoPickRules;
  };
  waiver: {
    waiverRule: LeagueSettingsWaiverRule;
  };
}

type LeagueSettingsMessage = {
  type: 'success' | 'error';
  text: string;
};

const POSITION_LIMIT_LABELS: Record<PositionLimitKey, string> = {
  DEF: 'Defenders',
  MID: 'Midfielders',
  RUC: 'Rucks',
  FWD: 'Forwards',
  BENCH: 'Bench',
};

const CATEGORY_PRESET = [...REAL_DATA_NINE_CATEGORY_PRESET];
const FANTASY_CATEGORY_KEYS = new Set(Object.keys(FANTASY_CATEGORIES));
const DEFAULT_LINEUP_SLOTS: LeagueLineupSlotSettings = {
  FWD: 5,
  DEF: 5,
  MID: 5,
  RUC: 1,
  UTIL: 3,
};
const TEAM_SYMBOL_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEAM_SYMBOL_UPLOAD_MAX_BYTES = 2_000_000;
const TEAM_SYMBOL_CANVAS_SIZE = 256;
const DEFAULT_MEMBER_NOTIFICATION_SETTINGS: LeagueMemberNotificationSettings = {
  tradePush: true,
  waiverPush: true,
  draftReminder: true,
  scoringAlerts: true,
};

function normalizeFantasyCategoryList(
  value: unknown,
  fallback: readonly FantasyCategoryKey[] = CATEGORY_PRESET
): FantasyCategoryKey[] {
  if (!Array.isArray(value)) return [...fallback];

  const selectedCategories = value
    .map(String)
    .filter((category): category is FantasyCategoryKey => FANTASY_CATEGORY_KEYS.has(category));

  return selectedCategories.length > 0 ? selectedCategories : [...fallback];
}

function normalizeLineupSlotSettings(value: unknown): LeagueLineupSlotSettings {
  const source = isRecord(value) ? value : {};
  return {
    FWD: asNumber(source.FWD, DEFAULT_LINEUP_SLOTS.FWD),
    DEF: asNumber(source.DEF, DEFAULT_LINEUP_SLOTS.DEF),
    MID: asNumber(source.MID, DEFAULT_LINEUP_SLOTS.MID),
    RUC: asNumber(source.RUC, DEFAULT_LINEUP_SLOTS.RUC),
    UTIL: asNumber(source.UTIL, DEFAULT_LINEUP_SLOTS.UTIL),
  };
}

function normalizeCategoryDirectionSettings(
  categories: readonly FantasyCategoryKey[],
  value: unknown
): Partial<Record<FantasyCategoryKey, CategoryDirection>> {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    categories.map((category) => [
      category,
      source[category] === 'LOW_WINS' ? 'LOW_WINS' : 'HIGH_WINS',
    ])
  ) as Partial<Record<FantasyCategoryKey, CategoryDirection>>;
}

function createFallbackLeagueSettings(league: League): LeagueSettingsResponse {
  const draftDate =
    league.draftDate ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  return {
    league: {
      id: league.id,
      name: league.name,
      code: league.code,
      maxTeams: league.maxTeams,
      locked: false,
    },
    scoring: {
      scoringFormat: 'nine-category',
      categories: league.categories?.length ? league.categories : [...CATEGORY_PRESET],
      scoringMode: league.scoringMode ?? 'H2H_EACH_CATEGORY',
      fixtureGenerationMode: league.fixtureGenerationMode ?? 'AUTOMATIC',
      lineupSlots: league.lineupSlots ?? DEFAULT_LINEUP_SLOTS,
      categoryDirections: normalizeCategoryDirectionSettings(
        league.categories?.length ? league.categories : CATEGORY_PRESET,
        league.categoryDirections
      ),
      scoringSettingsLockedAt: league.scoringSettingsLockedAt ?? null,
    },
    roster: {
      rosterSize: 18,
      benchSize: DEFAULT_DRAFT_POSITION_LIMITS.BENCH,
      positionLimits: { ...DEFAULT_DRAFT_POSITION_LIMITS },
    },
    draft: {
      draftDate,
      draftType: league.draftType ?? 'snake',
      timePerPick: 120,
      pickOrder: league.pickOrder ?? 'random',
      timeZone: 'Australia/Melbourne',
      autoPickRules: { ...DEFAULT_DRAFT_AUTO_PICK_RULES },
    },
    waiver: {
      waiverRule: league.waiverRule ?? 'weekly',
    },
  };
}

function normalizeLeagueSettingsPayload(value: unknown, league: League): LeagueSettingsResponse {
  const fallback = createFallbackLeagueSettings(league);
  const source = isRecord(value) ? value : {};
  const leagueSource = isRecord(source.league) ? source.league : {};
  const rosterSource = isRecord(source.roster) ? source.roster : {};
  const scoringSource = isRecord(source.scoring) ? source.scoring : {};
  const draftSource = isRecord(source.draft) ? source.draft : {};
  const waiverSource = isRecord(source.waiver) ? source.waiver : {};

  return {
    league: {
      id: league.id,
      name: asString(leagueSource.name, fallback.league.name),
      code: asString(leagueSource.code, fallback.league.code),
      maxTeams: asNumber(leagueSource.maxTeams, fallback.league.maxTeams),
      locked: Boolean(leagueSource.locked ?? fallback.league.locked),
    },
    scoring: {
      scoringFormat: 'nine-category',
      categories: normalizeFantasyCategoryList(
        scoringSource.categories,
        fallback.scoring.categories
      ),
      scoringMode:
        scoringSource.scoringMode === 'H2H_MOST_CATEGORIES'
          ? 'H2H_MOST_CATEGORIES'
          : fallback.scoring.scoringMode,
      fixtureGenerationMode:
        scoringSource.fixtureGenerationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC',
      lineupSlots: normalizeLineupSlotSettings(scoringSource.lineupSlots),
      categoryDirections: normalizeCategoryDirectionSettings(
        normalizeFantasyCategoryList(scoringSource.categories, fallback.scoring.categories),
        scoringSource.categoryDirections
      ),
      scoringSettingsLockedAt:
        typeof scoringSource.scoringSettingsLockedAt === 'string'
          ? scoringSource.scoringSettingsLockedAt
          : null,
    },
    roster: {
      rosterSize: asNumber(rosterSource.rosterSize, fallback.roster.rosterSize),
      benchSize: asNumber(rosterSource.benchSize, fallback.roster.benchSize),
      positionLimits: normalizePositionLimits(rosterSource.positionLimits),
    },
    draft: {
      draftDate: asString(draftSource.draftDate, fallback.draft.draftDate),
      draftType: asDraftType(draftSource.draftType, fallback.draft.draftType),
      timePerPick: asNumber(draftSource.timePerPick, fallback.draft.timePerPick),
      pickOrder: asPickOrder(draftSource.pickOrder, fallback.draft.pickOrder),
      timeZone: asString(draftSource.timeZone, fallback.draft.timeZone),
      autoPickRules: normalizeAutoPickRules(draftSource.autoPickRules),
    },
    waiver: {
      waiverRule: asWaiverRule(waiverSource.waiverRule, fallback.waiver.waiverRule),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function getMemberNotificationSettings(member?: LeagueMember): LeagueMemberNotificationSettings {
  return {
    ...DEFAULT_MEMBER_NOTIFICATION_SETTINGS,
    ...member?.notificationSettings,
  };
}

function getLeagueMemberRoleLabel(member: LeagueMember, league: League): string {
  if (member.userId === league.ownerId || member.role?.toLowerCase() === 'owner') {
    return 'Owner';
  }

  if (member.role?.toLowerCase() === 'manager') {
    return 'Manager';
  }

  if (member.role?.toLowerCase() === 'commissioner') {
    return 'Commissioner';
  }

  return 'Member';
}

function formatLeagueMemberJoinedAt(value: string): string {
  if (!value) return 'Not recorded';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not recorded';

  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function getTeamInitials(teamName: string): string {
  const initials = teamName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return initials || 'T';
}

function getTeamLogoPositionValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 50;
}

function getTeamLogoZoomValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_TEAM_SYMBOL_ZOOM, Math.min(MAX_TEAM_SYMBOL_ZOOM, Math.round(value * 20) / 20))
    : DEFAULT_TEAM_SYMBOL_ZOOM;
}

function getTeamLogoObjectPosition(
  member: Pick<LeagueMember, 'teamLogoPositionX' | 'teamLogoPositionY'>
): string {
  return `${getTeamLogoPositionValue(member.teamLogoPositionX)}% ${getTeamLogoPositionValue(
    member.teamLogoPositionY
  )}%`;
}

function getTeamLogoImageStyle(
  member: Pick<LeagueMember, 'teamLogoPositionX' | 'teamLogoPositionY' | 'teamLogoZoom'>
): CSSProperties {
  const objectPosition = getTeamLogoObjectPosition(member);
  const zoom = getTeamLogoZoomValue(member.teamLogoZoom);
  return {
    objectPosition,
    transform: `scale(${zoom})`,
    transformOrigin: objectPosition,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Could not read image file.'));
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function resizeTeamSymbolDataUrl(
  dataUrl: string,
  positionX = 50,
  positionY = 50,
  zoom = DEFAULT_TEAM_SYMBOL_ZOOM
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TEAM_SYMBOL_CANVAS_SIZE;
      canvas.height = TEAM_SYMBOL_CANVAS_SIZE;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not prepare image.'));
        return;
      }

      const size = Math.min(image.naturalWidth, image.naturalHeight) / getTeamLogoZoomValue(zoom);
      const maxSourceX = Math.max(0, image.naturalWidth - size);
      const maxSourceY = Math.max(0, image.naturalHeight - size);
      const sourceX = Math.round(maxSourceX * (getTeamLogoPositionValue(positionX) / 100));
      const sourceY = Math.round(maxSourceY * (getTeamLogoPositionValue(positionY) / 100));
      context.drawImage(
        image,
        sourceX,
        sourceY,
        size,
        size,
        0,
        0,
        TEAM_SYMBOL_CANVAS_SIZE,
        TEAM_SYMBOL_CANVAS_SIZE
      );
      resolve(canvas.toDataURL('image/webp', 0.82));
    };
    image.onerror = () => reject(new Error('Could not load image file.'));
    image.src = dataUrl;
  });
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asDraftType(value: unknown, fallback: LeagueSettingsDraftType): LeagueSettingsDraftType {
  return String(value ?? fallback).toLowerCase() === 'linear' ? 'linear' : 'snake';
}

function asPickOrder(value: unknown, fallback: DraftPickOrderMode): DraftPickOrderMode {
  return String(value ?? fallback).toLowerCase() === 'manual' ? 'manual' : 'random';
}

function asWaiverRule(
  value: unknown,
  fallback: LeagueSettingsWaiverRule
): LeagueSettingsWaiverRule {
  return String(value ?? fallback).toLowerCase() === 'rolling' ? 'rolling' : 'weekly';
}

function normalizePositionLimits(value: unknown): DraftPositionLimits {
  const source = isRecord(value) ? value : {};
  return POSITION_LIMIT_KEYS.reduce<DraftPositionLimits>((limits, key) => {
    const parsed = asNumber(source[key], DEFAULT_DRAFT_POSITION_LIMITS[key]);
    limits[key] = Math.max(0, Math.min(parsed, key === 'BENCH' ? 20 : 30));
    return limits;
  }, {} as DraftPositionLimits);
}

function normalizeAutoPickRules(value: unknown): DraftAutoPickRules {
  const source = isRecord(value) ? value : {};
  const strategy = String(source.strategy ?? DEFAULT_DRAFT_AUTO_PICK_RULES.strategy).toLowerCase();

  return {
    enabled: source.enabled !== false,
    strategy:
      strategy === 'best-available' || strategy === 'fill-positions'
        ? strategy
        : DEFAULT_DRAFT_AUTO_PICK_RULES.strategy,
  };
}

function toDateTimeLocalValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function TeamSettingsPanel({
  league,
  currentUserId,
  currentMember,
  onMemberChange,
}: {
  league: League;
  currentUserId?: string;
  currentMember?: LeagueMember;
  onMemberChange?: (member: LeagueMember) => void;
}) {
  const [teamName, setTeamName] = useState(currentMember?.teamName ?? '');
  const [notificationSettings, setNotificationSettings] =
    useState<LeagueMemberNotificationSettings>(() => getMemberNotificationSettings(currentMember));
  const [teamSettingsMessage, setTeamSettingsMessage] = useState<LeagueSettingsMessage | null>(
    null
  );
  const [isSavingTeamSettings, setIsSavingTeamSettings] = useState(false);
  const [teamSymbolUrl, setTeamSymbolUrl] = useState(currentMember?.teamLogoUrl ?? '');
  const [teamSymbolPositionX, setTeamSymbolPositionX] = useState(
    getTeamLogoPositionValue(currentMember?.teamLogoPositionX)
  );
  const [teamSymbolPositionY, setTeamSymbolPositionY] = useState(
    getTeamLogoPositionValue(currentMember?.teamLogoPositionY)
  );
  const [teamSymbolZoom, setTeamSymbolZoom] = useState(
    getTeamLogoZoomValue(currentMember?.teamLogoZoom)
  );
  const [pendingTeamSymbolUploadDataUrl, setPendingTeamSymbolUploadDataUrl] = useState<
    string | null
  >(null);
  const [teamSymbolMessage, setTeamSymbolMessage] = useState<LeagueSettingsMessage | null>(null);
  const [isSavingTeamSymbol, setIsSavingTeamSymbol] = useState(false);

  useEffect(() => {
    setTeamName(currentMember?.teamName ?? '');
    setNotificationSettings(getMemberNotificationSettings(currentMember));
    setTeamSymbolUrl(currentMember?.teamLogoUrl ?? '');
    setTeamSymbolPositionX(getTeamLogoPositionValue(currentMember?.teamLogoPositionX));
    setTeamSymbolPositionY(getTeamLogoPositionValue(currentMember?.teamLogoPositionY));
    setTeamSymbolZoom(getTeamLogoZoomValue(currentMember?.teamLogoZoom));
    setPendingTeamSymbolUploadDataUrl(null);
  }, [
    currentMember?.notificationSettings,
    currentMember?.teamLogoPositionX,
    currentMember?.teamLogoPositionY,
    currentMember?.teamLogoUrl,
    currentMember?.teamLogoZoom,
    currentMember?.teamName,
  ]);

  const updateNotificationSetting = (key: TeamNotificationToggleKey, value: boolean) => {
    setNotificationSettings((current) => ({ ...current, [key]: value }));
  };

  const mergeMemberResponse = (payload: unknown, fallback: LeagueMember): LeagueMember => {
    return isRecord(payload) && isRecord(payload.data) && isRecord(payload.data.member)
      ? ({ ...fallback, ...payload.data.member } as LeagueMember)
      : fallback;
  };

  const saveTeamSettings = async () => {
    if (!currentUserId || !currentMember) return;

    try {
      setIsSavingTeamSettings(true);
      setTeamSettingsMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/members/me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamName,
            notificationSettings,
          }),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      const nextMember = mergeMemberResponse(payload, {
        ...currentMember,
        teamName: teamName.trim(),
        notificationSettings,
      });
      setTeamName(nextMember.teamName);
      setNotificationSettings(getMemberNotificationSettings(nextMember));
      onMemberChange?.(nextMember);
      setTeamSettingsMessage({ type: 'success', text: 'Team settings saved.' });
    } catch (error) {
      setTeamSettingsMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save team settings.',
      });
    } finally {
      setIsSavingTeamSettings(false);
    }
  };

  const saveTeamSymbol = async (
    nextTeamSymbolUrl: string,
    nextPositionX = teamSymbolPositionX,
    nextPositionY = teamSymbolPositionY,
    nextZoom = teamSymbolZoom
  ) => {
    if (!currentUserId || !currentMember) return;

    const normalizedPositionX = getTeamLogoPositionValue(nextPositionX);
    const normalizedPositionY = getTeamLogoPositionValue(nextPositionY);
    const normalizedZoom = getTeamLogoZoomValue(nextZoom);

    try {
      setIsSavingTeamSymbol(true);
      setTeamSymbolMessage(null);
      const shouldResizePendingUpload =
        pendingTeamSymbolUploadDataUrl && nextTeamSymbolUrl === pendingTeamSymbolUploadDataUrl;
      const teamLogoUrlForSave = shouldResizePendingUpload
        ? await resizeTeamSymbolDataUrl(
            pendingTeamSymbolUploadDataUrl,
            normalizedPositionX,
            normalizedPositionY,
            normalizedZoom
          )
        : nextTeamSymbolUrl;
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/members/me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamLogoUrl: teamLogoUrlForSave,
            teamLogoPositionX: normalizedPositionX,
            teamLogoPositionY: normalizedPositionY,
            teamLogoZoom: normalizedZoom,
          }),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      const nextMember = mergeMemberResponse(payload, {
        ...currentMember,
        teamLogoUrl: teamLogoUrlForSave || undefined,
        teamLogoPositionX: normalizedPositionX,
        teamLogoPositionY: normalizedPositionY,
        teamLogoZoom: normalizedZoom,
      });

      setTeamSymbolUrl(nextMember.teamLogoUrl ?? '');
      setTeamSymbolPositionX(getTeamLogoPositionValue(nextMember.teamLogoPositionX));
      setTeamSymbolPositionY(getTeamLogoPositionValue(nextMember.teamLogoPositionY));
      setTeamSymbolZoom(getTeamLogoZoomValue(nextMember.teamLogoZoom));
      setPendingTeamSymbolUploadDataUrl(null);
      onMemberChange?.(nextMember);
      setTeamSymbolMessage({ type: 'success', text: 'Team symbol saved.' });
    } catch (error) {
      setTeamSymbolMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save team symbol.',
      });
    } finally {
      setIsSavingTeamSymbol(false);
    }
  };

  const handleTeamSymbolUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!TEAM_SYMBOL_UPLOAD_TYPES.has(file.type)) {
      setTeamSymbolMessage({ type: 'error', text: 'Upload a PNG, JPEG, or WebP image.' });
      return;
    }
    if (file.size > TEAM_SYMBOL_UPLOAD_MAX_BYTES) {
      setTeamSymbolMessage({ type: 'error', text: 'Upload an image smaller than 2 MB.' });
      return;
    }

    try {
      setTeamSymbolMessage(null);
      const dataUrl = await readFileAsDataUrl(file);
      setPendingTeamSymbolUploadDataUrl(dataUrl);
      setTeamSymbolUrl(dataUrl);
    } catch (error) {
      setTeamSymbolMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to upload team symbol.',
      });
    }
  };

  if (!currentMember) {
    return (
      <div className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 text-sm text-[color:var(--league-text-muted)]">
        Join this league to manage team settings.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[color:var(--league-text)]">Team Settings</h2>
        <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
          Manage your team name, identity, and league notifications.
        </p>
      </div>

      {teamSettingsMessage && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            teamSettingsMessage.type === 'success'
              ? 'border-[color:var(--league-border)] bg-[color:var(--league-page)] text-[color:var(--league-text)]'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {teamSettingsMessage.text}
        </div>
      )}

      <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--league-text)]">
              Team details
            </h3>
            <div className="mt-4 grid gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                Team name
                <input
                  type="text"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['tradePush', 'Trade offers'],
                    ['waiverPush', 'Waiver updates'],
                    ['draftReminder', 'Draft reminders'],
                    ['scoringAlerts', 'Scoring alerts'],
                  ] satisfies Array<[TeamNotificationToggleKey, string]>
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex min-h-10 items-center gap-3 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-sm font-medium text-[color:var(--league-text)]"
                  >
                    <input
                      type="checkbox"
                      checked={notificationSettings[key]}
                      onChange={(event) => updateNotificationSetting(key, event.target.checked)}
                      className="size-4 rounded border-[color:var(--league-border)] text-[color:var(--league-primary)] focus:ring-[color:var(--league-primary)]"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void saveTeamSettings()}
                  disabled={isSavingTeamSettings}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
                >
                  {isSavingTeamSettings ? 'Saving...' : 'Save team settings'}
                </button>
              </div>
            </div>
          </div>

          <div className="relative flex aspect-square w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-page)] shadow-sm">
            {teamSymbolUrl ? (
              <img
                src={teamSymbolUrl}
                alt={`${currentMember.teamName} symbol preview`}
                referrerPolicy="no-referrer"
                style={getTeamLogoImageStyle({
                  teamLogoPositionX: teamSymbolPositionX,
                  teamLogoPositionY: teamSymbolPositionY,
                  teamLogoZoom: teamSymbolZoom,
                })}
                className="h-full w-full object-cover will-change-transform"
              />
            ) : (
              <span className="text-5xl font-semibold text-[color:var(--league-text)]">
                {getTeamInitials(currentMember.teamName)}
              </span>
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%+0.5px),transparent_calc(50%+0.5px)),linear-gradient(to_bottom,transparent_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%+0.5px),transparent_calc(50%+0.5px))] mix-blend-difference"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-4 rounded-xl border border-white/45 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-start">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--league-text)]">
              Team identity
            </h3>
            <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
              Position the image used for your team across {league.name}.
            </p>
          </div>

          <div className="flex flex-col gap-5">
            {teamSymbolMessage && (
              <div
                role="status"
                className={`rounded-lg border px-4 py-3 text-sm ${
                  teamSymbolMessage.type === 'success'
                    ? 'border-[color:var(--league-border)] bg-[color:var(--league-page)] text-[color:var(--league-text)]'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {teamSymbolMessage.text}
              </div>
            )}

            <div className="grid gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                Team symbol URL
                <input
                  type="url"
                  value={teamSymbolUrl.startsWith('data:') ? '' : teamSymbolUrl}
                  placeholder="https://example.com/team-symbol.png"
                  onChange={(event) => {
                    setPendingTeamSymbolUploadDataUrl(null);
                    setTeamSymbolUrl(event.target.value);
                  }}
                  className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                  Upload team symbol
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => void handleTeamSymbolUpload(event.target.files?.[0])}
                    className="block w-full text-sm text-[color:var(--league-text-muted)] file:mr-4 file:rounded-md file:border-0 file:bg-[color:var(--league-page)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[color:var(--league-text)]"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveTeamSymbol(teamSymbolUrl)}
                    disabled={isSavingTeamSymbol}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
                  >
                    {isSavingTeamSymbol ? 'Saving...' : 'Save team symbol'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveTeamSymbol('')}
                    disabled={isSavingTeamSymbol}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                Zoom
                <div className="flex items-center gap-3">
                  <span className="w-10 text-xs text-[color:var(--league-text-muted)]">1x</span>
                  <input
                    type="range"
                    min={MIN_TEAM_SYMBOL_ZOOM}
                    max={MAX_TEAM_SYMBOL_ZOOM}
                    step="0.05"
                    value={teamSymbolZoom}
                    onChange={(event) =>
                      setTeamSymbolZoom(getTeamLogoZoomValue(Number(event.target.value)))
                    }
                    className="w-full accent-[color:var(--league-primary)]"
                  />
                  <span className="w-12 text-right text-xs text-[color:var(--league-text-muted)]">
                    {teamSymbolZoom.toFixed(2)}x
                  </span>
                </div>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                Horizontal centre
                <div className="flex items-center gap-3">
                  <span className="w-10 text-xs text-[color:var(--league-text-muted)]">Left</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={teamSymbolPositionX}
                    onChange={(event) =>
                      setTeamSymbolPositionX(getTeamLogoPositionValue(Number(event.target.value)))
                    }
                    className="w-full accent-[color:var(--league-primary)]"
                  />
                  <span className="w-10 text-right text-xs text-[color:var(--league-text-muted)]">
                    Right
                  </span>
                </div>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
                Vertical centre
                <div className="flex items-center gap-3">
                  <span className="w-10 text-xs text-[color:var(--league-text-muted)]">Top</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={teamSymbolPositionY}
                    onChange={(event) =>
                      setTeamSymbolPositionY(getTeamLogoPositionValue(Number(event.target.value)))
                    }
                    className="w-full accent-[color:var(--league-primary)]"
                  />
                  <span className="w-10 text-right text-xs text-[color:var(--league-text-muted)]">
                    Bottom
                  </span>
                </div>
              </label>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function LeagueSettingsPanel({
  league,
  memberCount,
  isAdmin,
  canAccessCompetitionRules,
  isActive,
  currentUserId,
}: {
  league: League;
  memberCount: number;
  isAdmin: boolean;
  canAccessCompetitionRules: boolean;
  isActive: boolean;
  currentUserId?: string;
}) {
  const [settings, setSettings] = useState<LeagueSettingsResponse>(() =>
    createFallbackLeagueSettings(league)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<LeagueSettingsMessage | null>(null);
  const loadGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const saveAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSettings(createFallbackLeagueSettings(league));
  }, [league]);

  useEffect(() => {
    if (!isActive || !isAdmin) return;

    const controller = new AbortController();
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    saveAbortControllerRef.current?.abort();
    saveAbortControllerRef.current = null;
    saveGenerationRef.current += 1;
    setIsSaving(false);
    async function loadLeagueSettings() {
      try {
        setIsLoading(true);
        setMessage(null);
        const response = await authenticatedFetch(
          `/api/leagues/${league.id}/settings`,
          { signal: controller.signal },
          currentUserId
        );
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? `status ${response.status}`);
        }

        if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
        setSettings(normalizeLeagueSettingsPayload(payload.data, league));
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== loadGenerationRef.current ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to load league settings.',
        });
      } finally {
        if (!controller.signal.aborted && generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    }

    void loadLeagueSettings();
    return () => {
      controller.abort();
      if (generation === loadGenerationRef.current) loadGenerationRef.current += 1;
      saveAbortControllerRef.current?.abort();
      saveGenerationRef.current += 1;
    };
  }, [currentUserId, isActive, isAdmin, league]);

  const updateLeagueSettings = (updates: Partial<LeagueSettingsResponse['league']>) => {
    setSettings((current) => ({
      ...current,
      league: { ...current.league, ...updates },
    }));
  };

  const updateDraftSettings = (updates: Partial<LeagueSettingsResponse['draft']>) => {
    setSettings((current) => ({
      ...current,
      draft: { ...current.draft, ...updates },
    }));
  };

  const updatePositionLimit = (key: PositionLimitKey, value: number) => {
    setSettings((current) => ({
      ...current,
      roster: {
        ...current.roster,
        positionLimits: {
          ...current.roster.positionLimits,
          [key]: value,
        },
      },
    }));
  };

  const updateAutoPickRules = (updates: Partial<DraftAutoPickRules>) => {
    setSettings((current) => ({
      ...current,
      draft: {
        ...current.draft,
        autoPickRules: { ...current.draft.autoPickRules, ...updates },
      },
    }));
  };

  const handleSaveSettings = async () => {
    if (!isAdmin) return;

    const controller = new AbortController();
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;
    saveAbortControllerRef.current?.abort();
    saveAbortControllerRef.current = controller;
    try {
      setIsSaving(true);
      setMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/settings`,
        {
          method: 'PUT',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      if (controller.signal.aborted || generation !== saveGenerationRef.current) return;
      setSettings(normalizeLeagueSettingsPayload(payload.data, league));
      setMessage({ type: 'success', text: 'League settings saved.' });
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== saveGenerationRef.current ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return;
      }
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save league settings.',
      });
    } finally {
      if (generation === saveGenerationRef.current) {
        if (saveAbortControllerRef.current === controller) saveAbortControllerRef.current = null;
        setIsSaving(false);
      }
    }
  };

  const teamFillPercent = Math.min(100, Math.round((memberCount / settings.league.maxTeams) * 100));

  const updateFixtureGenerationMode = (fixtureGenerationMode: LeagueFixtureGenerationMode) => {
    setSettings((current) => ({
      ...current,
      scoring: { ...current.scoring, fixtureGenerationMode },
    }));
  };

  if (!isAdmin && canAccessCompetitionRules) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Competition Rules</h2>
          <p className="mt-1 text-sm text-muted-foreground">Co-commissioner controls</p>
        </div>
        <CompetitionSettingsPanel
          leagueId={league.id}
          currentUserId={currentUserId}
          fixtureGenerationMode={settings.scoring.fixtureGenerationMode}
          onFixtureGenerationModeChange={updateFixtureGenerationMode}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[color:var(--league-text)]">League Settings</h2>
          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
            {isAdmin ? 'Commissioner controls' : 'Read-only league settings'}
          </p>
        </div>
        {isLoading && (
          <span className="rounded-full border border-[color:var(--league-border)] px-3 py-1 text-sm text-[color:var(--league-text-muted)]">
            Loading
          </span>
        )}
      </div>

      {message && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-[color:var(--league-border)] bg-[color:var(--league-page)] text-[color:var(--league-text)]'
              : 'border-destructive/20 bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </div>
      )}

      <fieldset disabled={!isAdmin || isSaving} className="flex flex-col gap-6 disabled:opacity-75">
        <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
          <h3 className="text-base font-semibold text-[color:var(--league-text)]">
            Basic Information
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              League Name
              <input
                type="text"
                value={settings.league.name}
                onChange={(event) => updateLeagueSettings({ name: event.target.value })}
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:bg-[color:var(--league-surface-muted)]"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              League Code
              <input
                type="text"
                value={settings.league.code}
                readOnly
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 font-mono text-[color:var(--league-text-muted)]"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Max Teams
              <input
                type="number"
                min={MIN_LEAGUE_TEAMS}
                max={MAX_LEAGUE_TEAMS}
                value={settings.league.maxTeams}
                onChange={(event) =>
                  updateLeagueSettings({
                    maxTeams: Number.parseInt(event.target.value, 10) || MIN_LEAGUE_TEAMS,
                  })
                }
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              />
            </label>
            <div className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Team Count
              <div className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{memberCount} teams filled</span>
                  <span>{settings.league.maxTeams} max</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-[color:var(--league-surface-muted)]">
                  <div
                    className="h-2 rounded-full bg-[color:var(--league-primary)]"
                    style={{ width: `${teamFillPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <ScoringSettingsPanel
          value={settings.scoring}
          disabled={!isAdmin || isSaving}
          onChange={(scoring) => setSettings((current) => ({ ...current, scoring }))}
        />

        <CompetitionSettingsPanel
          leagueId={league.id}
          currentUserId={currentUserId}
          fixtureGenerationMode={settings.scoring.fixtureGenerationMode}
          onFixtureGenerationModeChange={updateFixtureGenerationMode}
        />

        <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
          <h3 className="text-base font-semibold text-[color:var(--league-text)]">
            Draft Settings
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Draft Date
              <input
                type="datetime-local"
                value={toDateTimeLocalValue(settings.draft.draftDate)}
                onChange={(event) =>
                  updateDraftSettings({ draftDate: fromDateTimeLocalValue(event.target.value) })
                }
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Draft Type
              <select
                value={settings.draft.draftType}
                onChange={(event) =>
                  updateDraftSettings({
                    draftType: event.target.value as LeagueSettingsDraftType,
                  })
                }
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                <option value="snake">Snake</option>
                <option value="linear">Linear</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Pick Order
              <select
                value={settings.draft.pickOrder}
                onChange={(event) =>
                  updateDraftSettings({ pickOrder: event.target.value as DraftPickOrderMode })
                }
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                <option value="random">Random</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Time Per Pick
              <select
                value={settings.draft.timePerPick}
                onChange={(event) =>
                  updateDraftSettings({
                    timePerPick: Number.parseInt(event.target.value, 10),
                  })
                }
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                {TIME_PER_PICK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Time Zone
              <input
                type="text"
                value={settings.draft.timeZone}
                onChange={(event) => updateDraftSettings({ timeZone: event.target.value })}
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
          <h3 className="text-base font-semibold text-[color:var(--league-text)]">
            Roster Settings
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {POSITION_LIMIT_KEYS.map((key) => (
              <label
                key={key}
                className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]"
              >
                {POSITION_LIMIT_LABELS[key]}
                <input
                  type="number"
                  min={0}
                  max={key === 'BENCH' ? 20 : 30}
                  value={settings.roster.positionLimits[key]}
                  onChange={(event) =>
                    updatePositionLimit(key, Number.parseInt(event.target.value, 10) || 0)
                  }
                  className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
          <h3 className="text-base font-semibold text-[color:var(--league-text)]">
            Auto-Pick And Waivers
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="flex min-h-10 items-center gap-3 text-sm font-medium text-[color:var(--league-text)]">
              <input
                type="checkbox"
                checked={settings.draft.autoPickRules.enabled}
                onChange={(event) => updateAutoPickRules({ enabled: event.target.checked })}
                className="size-4 rounded border-[color:var(--league-border)] text-[color:var(--league-primary)] focus:ring-[color:var(--league-primary)]"
              />
              Enable Auto-Pick
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Auto-Pick Strategy
              <select
                value={settings.draft.autoPickRules.strategy}
                onChange={(event) =>
                  updateAutoPickRules({
                    strategy: event.target.value as DraftAutoPickRules['strategy'],
                  })
                }
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                <option value="queue-first">Queue first</option>
                <option value="best-available">Best available</option>
                <option value="fill-positions">Fill positions</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--league-text)]">
              Waiver Rule
              <select
                value={settings.waiver.waiverRule}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    waiver: {
                      waiverRule: event.target.value as LeagueSettingsWaiverRule,
                    },
                  }))
                }
                className="h-10 rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 text-[color:var(--league-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                <option value="weekly">Weekly</option>
                <option value="rolling">Rolling</option>
              </select>
            </label>
          </div>
        </section>
      </fieldset>

      {isAdmin && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleSaveSettings()}
            disabled={isSaving}
            className="inline-flex h-10 items-center justify-center rounded-md bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save league settings'}
          </button>
        </div>
      )}
    </div>
  );
}

// Team Roster Manager Component that integrates MyTeamPanel with league data
interface MyTeamRosterManagerProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

type LeagueRosterRecord = Record<string, unknown> & {
  players?: Player[];
  playerIds?: Array<string | number>;
};

interface NormalizedLeagueRosterResponse {
  roster: LeagueRosterRecord | null;
  players: Player[];
  selectedCategories: FantasyCategoryKey[];
}

function normalizeLeagueRosterResponse(
  payload: unknown,
  fallbackCategories: readonly FantasyCategoryKey[] = CATEGORY_PRESET
): NormalizedLeagueRosterResponse {
  const responseBody =
    isRecord(payload) && isRecord(payload.data) ? payload.data : isRecord(payload) ? payload : null;
  const roster =
    responseBody && isRecord(responseBody.roster)
      ? (responseBody.roster as LeagueRosterRecord)
      : null;
  const leagueSettings =
    responseBody && isRecord(responseBody.leagueSettings) ? responseBody.leagueSettings : null;
  const rosterPlayers = roster && Array.isArray(roster.players) ? roster.players : [];
  const responsePlayers =
    responseBody && Array.isArray(responseBody.players) ? (responseBody.players as Player[]) : [];

  return {
    roster,
    players: rosterPlayers.length > 0 ? rosterPlayers : responsePlayers,
    selectedCategories: normalizeFantasyCategoryList(
      leagueSettings?.selectedCategories,
      fallbackCategories
    ),
  };
}

function getRosterPlayerIds(roster: LeagueRosterRecord | null, players: Player[]): string[] {
  if (roster && Array.isArray(roster.playerIds) && roster.playerIds.length > 0) {
    return roster.playerIds.map((playerId) => String(playerId));
  }

  return players.map((player) => String(player.id));
}

function MyTeamRosterManager({ league, members, currentUserId }: MyTeamRosterManagerProps) {
  const [_selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [lastAction, setLastAction] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<LeagueRosterRecord | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const rosterCategoryFallback = useMemo(
    () => normalizeFantasyCategoryList(league.categories, CATEGORY_PRESET),
    [league.categories]
  );
  const [selectedCategories, setSelectedCategories] = useState<FantasyCategoryKey[]>(() => [
    ...rosterCategoryFallback,
  ]);

  useEffect(() => {
    setSelectedCategories([...rosterCategoryFallback]);
  }, [rosterCategoryFallback]);

  // Get current user's team from league members
  const currentUserTeam = members.find((member) => member.userId === currentUserId);

  // Fetch roster data from real API
  useEffect(() => {
    if (!league?.id || !currentUserId) return;

    const fetchRosterData = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`);
        if (response.ok) {
          const rosterData = await response.json();
          const nextRoster = normalizeLeagueRosterResponse(rosterData, rosterCategoryFallback);
          setRoster(nextRoster.roster);
          setPlayers(nextRoster.players);
          setSelectedCategories(nextRoster.selectedCategories);
        } else {
          console.error('Failed to fetch roster data');
        }
      } catch (error) {
        console.error('Error fetching roster:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchRosterData();
  }, [league?.id, currentUserId, rosterCategoryFallback]);

  // Convert roster data to Team format for MyTeamPanel
  const teamPlayerIds = getRosterPlayerIds(roster, players);
  const team: Team | undefined = roster
    ? {
        id: String(roster.id ?? currentUserTeam?.id),
        name: currentUserTeam?.teamName || 'My Team',
        players: teamPlayerIds,
      }
    : undefined;

  const handlePlayerSelect = (player: Player) => {
    setSelectedPlayer(player);
    setLastAction(`Selected player: ${player.name}`);
  };

  const handleTeamAction = async (action: string, player?: Player) => {
    if (!league?.id || !currentUserId) return;

    setLoading(true);
    try {
      let actionData: Record<string, unknown> = {};

      switch (action) {
        case 'captain':
          if (player) {
            actionData = {
              actionType: 'SET_CAPTAIN',
              details: { playerId: player.id },
            };
            setLastAction(`Setting ${player.name} as captain...`);
          }
          break;
        case 'viceCaptain':
          if (player) {
            actionData = {
              actionType: 'SET_VICE_CAPTAIN',
              details: { playerId: player.id },
            };
            setLastAction(`Setting ${player.name} as vice-captain...`);
          }
          break;
        case 'optimize':
          actionData = {
            actionType: 'OPTIMIZE_LINEUP',
            details: {},
          };
          setLastAction('Optimizing lineup...');
          break;
        case 'drop':
          if (player) {
            actionData = {
              actionType: 'DROP_PLAYER',
              details: { playerId: player.id },
            };
            setLastAction(`Dropping ${player.name}...`);
          }
          break;
        case 'trade':
          setLastAction('Opening trade interface...');
          return; // Handle trade UI separately
        case 'waivers':
          setLastAction('Opening waiver claims...');
          return; // Handle waiver UI separately
        default: {
          const playerName = player ? player.name : '';
          setLastAction(`${action} action ${playerName ? `for ${playerName}` : ''}`);
          return;
        }
      }

      // Submit team action to API
      const response = await fetch(`/api/leagues/${league.id}/actions/${currentUserId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(actionData),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Team action submitted:', result);

        // Refresh roster data after successful action
        setTimeout(() => {
          const refreshRoster = async () => {
            try {
              const rosterResponse = await fetch(
                `/api/leagues/${league.id}/roster/${currentUserId}`
              );
              if (rosterResponse.ok) {
                const rosterData = await rosterResponse.json();
                const nextRoster = normalizeLeagueRosterResponse(
                  rosterData,
                  rosterCategoryFallback
                );
                setRoster(nextRoster.roster);
                setPlayers(nextRoster.players);
                setSelectedCategories(nextRoster.selectedCategories);
                setLastAction(`${action} completed successfully`);
              }
            } catch (error) {
              console.error('Failed to refresh roster:', error);
            }
          };
          void refreshRoster();
        }, 1000);
      } else {
        const error = await response.json();
        setLastAction(`Error: ${error.message || 'Action failed'}`);
      }
    } catch (error) {
      console.error('Team action failed:', error);
      setLastAction('Action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!league?.id || !currentUserId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`);
      if (response.ok) {
        const rosterData = await response.json();
        const nextRoster = normalizeLeagueRosterResponse(rosterData, rosterCategoryFallback);
        setRoster(nextRoster.roster);
        setPlayers(nextRoster.players);
        setSelectedCategories(nextRoster.selectedCategories);
        setLastAction('Team data refreshed');
      } else {
        setLastAction('Refresh failed');
      }
    } catch (error) {
      console.error('Failed to refresh roster:', error);
      setLastAction('Refresh failed');
    } finally {
      setLoading(false);
    }
  };

  if (!currentUserId) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600">Please sign in to manage your roster.</p>
      </div>
    );
  }

  if (!currentUserTeam) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600">You are not a member of this league.</p>
      </div>
    );
  }

  if (loading && !roster) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-blue-600">Loading roster...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* League Context Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-blue-900">{league.name}</h3>
            <p className="text-sm text-blue-700">
              Team: {currentUserTeam.teamName} • Members: {members.length}/{league.maxTeams}
            </p>
          </div>
          {lastAction && (
            <div className="text-sm text-blue-600 bg-blue-100 px-3 py-1 rounded">{lastAction}</div>
          )}
        </div>
      </div>

      {/* MyTeamPanel Integration */}
      <MyTeamPanel
        team={team}
        players={players}
        onPlayerSelect={handlePlayerSelect}
        onTeamAction={handleTeamAction}
        onRefresh={handleRefresh}
        showAdvancedFeatures={true}
        sortByValue={true}
        selectedCategories={selectedCategories}
        maxHeight="600px"
        isLoading={loading}
      />
    </div>
  );
}
