'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { League, LeagueMember } from '@/types/leagues';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { logger } from '@/lib/logger';
import { SectionErrorBoundary } from '@/components/ui/ErrorBoundary';
import {
  formatLeagueMemberJoinedAt,
  getLeagueMemberRoleLabel,
  getTeamInitials,
  getTeamLogoImageStyle,
  isRecord,
} from './leagueTabPanelUtils';
import { createIntentPreloader } from './leagueTabPreloader';
import type {
  LeagueTradeCentreSnapshot,
  LeagueTradeDigest,
} from '@/server/leagues/trades/tradeContracts';

interface LeagueTabsProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
  onMembersChange?: (members: LeagueMember[]) => void;
  initialTradeCentre?: LeagueTradeCentreSnapshot | null;
  initialTradeCentreError?: string | null;
  initialTradeDigest?: LeagueTradeDigest | null;
  initialTab?: string;
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

function LeaguePanelLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="min-h-48 rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-6 text-sm text-[color:var(--league-text-muted)]"
    >
      Loading {label}…
    </div>
  );
}

const CHUNK_LOAD_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed|module factory is not available/i;

function isChunkLoadError(error: Error | undefined): boolean {
  return Boolean(error && CHUNK_LOAD_ERROR_PATTERN.test(`${error.name}: ${error.message}`));
}

function LeaguePanelError({
  error,
  resetError,
  retryCount,
  maxRetries,
  onReturnToOverview,
}: {
  error?: Error;
  resetError: () => void;
  retryCount: number;
  maxRetries: number;
  onReturnToOverview: () => void;
}) {
  const requiresReload = isChunkLoadError(error) || retryCount >= maxRetries;

  return (
    <section
      role="alert"
      aria-labelledby="league-panel-error-heading"
      className="flex min-h-48 flex-col justify-center rounded-xl border border-[color:var(--league-danger)]/30 bg-[color:var(--league-danger-soft)] p-6"
    >
      <h2
        id="league-panel-error-heading"
        className="text-lg font-semibold text-[color:var(--league-text)]"
      >
        This league section could not be loaded
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-[color:var(--league-text-muted)]">
        Your league navigation is still available. Retry this section or return to the overview.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={requiresReload ? () => window.location.reload() : resetError}
          className="inline-flex h-10 items-center justify-center rounded-full bg-[color:var(--league-primary)] px-4 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--league-danger-soft)]"
        >
          {requiresReload ? 'Reload page' : 'Try section again'}
        </button>
        <button
          type="button"
          onClick={onReturnToOverview}
          className="inline-flex h-10 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition-colors hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--league-danger-soft)]"
        >
          Return to overview
        </button>
      </div>
    </section>
  );
}

const loadRosterPanel = () =>
  import('./MyTeamRosterManager').then((module) => module.MyTeamRosterManager);
const loadMatchupsPanel = () =>
  import('./matchups/LeagueMatchupsPanel').then((module) => module.LeagueMatchupsPanel);
const loadLineupPanel = () =>
  import('./matchups/LeagueLineupPanel').then((module) => module.LeagueLineupPanel);
const loadStandingsPanel = () =>
  import('./matchups/LeagueStandingsPanel').then((module) => module.LeagueStandingsPanel);
const loadTradeCentrePanel = () =>
  import('./trades/LeagueTradeCentrePanel').then((module) => module.LeagueTradeCentrePanel);
const loadWaiversPanel = () => import('@/components/waivers/LeagueWaiversContainer');
const loadDraftPanel = () => import('./DraftManager');
const loadTeamSettingsPanel = () =>
  import('./LeagueSettingsPanels').then((module) => module.TeamSettingsPanel);
const loadLeagueSettingsPanel = () =>
  import('./LeagueSettingsPanels').then((module) => module.LeagueSettingsPanel);

const MyTeamRosterManager = dynamic(
  () => import('./MyTeamRosterManager').then((module) => module.MyTeamRosterManager),
  {
    loading: () => <LeaguePanelLoading label="your roster" />,
  }
);
const LeagueMatchupsPanel = dynamic(
  () => import('./matchups/LeagueMatchupsPanel').then((module) => module.LeagueMatchupsPanel),
  {
    loading: () => <LeaguePanelLoading label="matchups" />,
  }
);
const LeagueLineupPanel = dynamic(
  () => import('./matchups/LeagueLineupPanel').then((module) => module.LeagueLineupPanel),
  {
    loading: () => <LeaguePanelLoading label="your lineup" />,
  }
);
const LeagueStandingsPanel = dynamic(
  () => import('./matchups/LeagueStandingsPanel').then((module) => module.LeagueStandingsPanel),
  {
    loading: () => <LeaguePanelLoading label="standings" />,
  }
);
const LeagueTradeCentrePanel = dynamic(
  () => import('./trades/LeagueTradeCentrePanel').then((module) => module.LeagueTradeCentrePanel),
  {
    loading: () => <LeaguePanelLoading label="trades" />,
  }
);
const LeagueWaiversContainer = dynamic(
  () => import('@/components/waivers/LeagueWaiversContainer'),
  {
    loading: () => <LeaguePanelLoading label="waivers" />,
  }
);
const DraftManager = dynamic(() => import('./DraftManager'), {
  loading: () => <LeaguePanelLoading label="draft management" />,
});
const TeamSettingsPanel = dynamic(
  () => import('./LeagueSettingsPanels').then((module) => module.TeamSettingsPanel),
  {
    loading: () => <LeaguePanelLoading label="team settings" />,
  }
);
const LeagueSettingsPanel = dynamic(
  () => import('./LeagueSettingsPanels').then((module) => module.LeagueSettingsPanel),
  {
    loading: () => <LeaguePanelLoading label="league settings" />,
  }
);

const TAB_PANEL_PRELOADERS: Partial<Record<TabType, () => Promise<unknown>>> = {
  roster: loadRosterPanel,
  matchups: loadMatchupsPanel,
  lineup: loadLineupPanel,
  standings: loadStandingsPanel,
  trades: loadTradeCentrePanel,
  waivers: loadWaiversPanel,
  draft: loadDraftPanel,
  'team-settings': loadTeamSettingsPanel,
  'league-settings': loadLeagueSettingsPanel,
};

const preloadLeagueTab = createIntentPreloader(TAB_PANEL_PRELOADERS, (tabId, error) => {
  logger.warn('League tab preload failed', {
    tabId,
    error: error instanceof Error ? error.message : String(error),
  });
});

interface Tab {
  id: TabType;
  name: string;
  icon?: React.ReactNode;
  badge?: number;
}

interface TabGroup {
  id: 'play' | 'league' | 'social' | 'settings';
  name: string;
  tabs: Tab[];
}

type OverviewWaiverClaim = {
  id: string;
  playerId: string;
  playerName: string;
  bidAmount?: number;
};

type LeagueSettingsMessage = {
  type: 'success' | 'error';
  text: string;
};

const LEAGUE_TAB_GROUPS = [
  {
    id: 'play',
    name: 'Play',
    tabIds: ['overview', 'roster', 'lineup', 'matchups', 'trades', 'waivers', 'draft'],
  },
  { id: 'league', name: 'League', tabIds: ['teams', 'standings'] },
  { id: 'social', name: 'Social', tabIds: ['social'] },
  { id: 'settings', name: 'Settings', tabIds: ['team-settings', 'league-settings'] },
] as const satisfies ReadonlyArray<{
  id: TabGroup['id'];
  name: string;
  tabIds: readonly TabType[];
}>;

type GroupedLeagueTabId = (typeof LEAGUE_TAB_GROUPS)[number]['tabIds'][number];
const allLeagueTabsAreGrouped: Exclude<TabType, GroupedLeagueTabId> extends never ? true : never =
  true;
void allLeagueTabsAreGrouped;

const TAB_IDS: readonly TabType[] = LEAGUE_TAB_GROUPS.flatMap((group) => group.tabIds);

function groupLeagueTabs(tabs: readonly Tab[]): TabGroup[] {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));

  return LEAGUE_TAB_GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    tabs: group.tabIds
      .map((tabId) => tabsById.get(tabId))
      .filter((tab): tab is Tab => Boolean(tab)),
  })).filter((group) => group.tabs.length > 0);
}

function getTabOptionLabel(tab: Tab): string {
  return tab.badge ? `${tab.name} (${tab.badge} unread)` : tab.name;
}

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

function getDraftStatusLabel(status: string | null | undefined): string {
  return `Draft ${(status ?? 'not started').replace(/_/g, ' ')}`;
}

export default function LeagueTabs({
  league,
  members,
  currentUserId,
  onMembersChange,
  initialTradeCentre = null,
  initialTradeCentreError = null,
  initialTradeDigest = null,
  initialTab,
}: LeagueTabsProps): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const requestedTab = searchParams?.get('tab') ?? null;
  const initialCompetitionRulesAccess =
    currentUserId === league.ownerId ||
    members.some(
      (member) =>
        member.userId === currentUserId &&
        (member.role === 'owner' || member.role === 'manager' || member.isCoCommissioner === true)
    );
  const [activeTab, setActiveTab] = useState<TabType>(
    () =>
      getLeagueTabFromSearch(initialTab ?? requestedTab, initialCompetitionRulesAccess) ??
      'overview'
  );
  const [teamActionMessage, setTeamActionMessage] = useState<LeagueSettingsMessage | null>(null);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [overviewWaiverClaims, setOverviewWaiverClaims] = useState<OverviewWaiverClaim[]>([]);
  const [overviewWaiversStatus, setOverviewWaiversStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [socialUnread, setSocialUnread] = useState({ chat: 0, board: 0, activity: 0 });
  const hasReconciledUrl = useRef(false);

  const currentMember = members.find((member) => member.userId === currentUserId);
  const selectedPlayerId = searchParams?.get('playerId') ?? null;
  const selectedPlayerOwnerMemberId = searchParams?.get('ownerMemberId') ?? null;
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
          data?: { unread?: { chat?: number; board?: number; activity?: number } };
        };
      })
      .then((body) => {
        if (cancelled || !body?.data?.unread) return;
        setSocialUnread({
          chat: body.data.unread.chat ?? 0,
          board: body.data.unread.board ?? 0,
          activity: body.data.unread.activity ?? 0,
        });
      })
      .catch(() => {
        // Social has its own retry state; league navigation remains available.
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, league.id]);

  useEffect(() => {
    if (!hasReconciledUrl.current && initialTab && requestedTab === null) {
      hasReconciledUrl.current = true;
      return;
    }

    hasReconciledUrl.current = true;
    const urlTab = getLeagueTabFromSearch(requestedTab, canAccessCompetitionRules) ?? 'overview';
    setActiveTab((currentTab) => (currentTab === urlTab ? currentTab : urlTab));
  }, [canAccessCompetitionRules, initialTab, requestedTab]);

  const handleTabChange = (tabId: TabType) => {
    void preloadLeagueTab(tabId);
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
    {
      id: 'trades',
      name: 'Trades',
      badge:
        initialTradeCentre && initialTradeCentre.counts.inbox + initialTradeCentre.counts.review > 0
          ? initialTradeCentre.counts.inbox + initialTradeCentre.counts.review
          : undefined,
    },
    { id: 'waivers', name: 'Waivers' },
    { id: 'draft', name: 'Draft' },
    {
      id: 'social',
      name: 'Social',
      badge: socialUnread.chat + socialUnread.board + socialUnread.activity || undefined,
    },
    { id: 'team-settings', name: 'Team Settings' },
  ];
  const tabs: Tab[] = canAccessCompetitionRules
    ? [
        ...baseTabs,
        { id: 'league-settings', name: isAdmin ? 'League Settings' : 'Competition Rules' },
      ]
    : baseTabs;
  const tabGroups = groupLeagueTabs(tabs);
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
          <nav className="max-w-full px-3 py-3" aria-label="League sections">
            <div className="md:hidden">
              <label
                htmlFor="league-section-select"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]"
              >
                League section
              </label>
              <select
                id="league-section-select"
                value={activeTab}
                onChange={(event) => {
                  const tabId = event.target.value as TabType;
                  handleTabChange(tabId);
                }}
                className="block h-11 w-full rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 text-sm font-semibold text-[color:var(--league-text)] focus:border-[color:var(--league-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--league-primary)]/25"
              >
                {tabGroups.map((group) => (
                  <optgroup key={group.id} label={group.name}>
                    {group.tabs.map((tab) => (
                      <option key={tab.id} value={tab.id}>
                        {getTabOptionLabel(tab)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="hidden max-w-full scroll-px-3 gap-4 overflow-x-auto overscroll-x-contain md:flex [scrollbar-width:thin]">
              {tabGroups.map((group) => (
                <div
                  key={group.id}
                  role="group"
                  aria-label={`${group.name} sections`}
                  className="shrink-0"
                >
                  <span className="mb-1.5 block px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--league-text-muted)]">
                    {group.name}
                  </span>
                  <div className="flex gap-1">
                    {group.tabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => handleTabChange(tab.id)}
                        onPointerEnter={() => void preloadLeagueTab(tab.id)}
                        onPointerDown={() => void preloadLeagueTab(tab.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            void preloadLeagueTab(tab.id);
                          }
                        }}
                        onFocus={(event) => {
                          event.currentTarget.scrollIntoView({
                            block: 'nearest',
                            inline: 'nearest',
                          });
                        }}
                        aria-current={activeTab === tab.id ? 'page' : undefined}
                        className={`scroll-mx-3 inline-flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--league-page)] ${
                          activeTab === tab.id
                            ? 'bg-[color:var(--league-primary)] text-[color:var(--league-primary-foreground)] shadow-sm'
                            : 'text-[color:var(--league-text-muted)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{tab.name}</span>
                          {tab.badge && (
                            <span
                              aria-label={`${tab.badge} unread`}
                              className="rounded-full bg-[color:var(--league-danger-soft)] px-2 py-0.5 text-xs font-semibold text-[color:var(--league-danger)]"
                            >
                              {tab.badge}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-5 sm:p-6">
          <SectionErrorBoundary
            name={`League ${activeTab} panel`}
            resetKeys={[activeTab]}
            maxRetries={2}
            fallback={({ error, resetError, retryCount, maxRetries }) => (
              <LeaguePanelError
                error={error}
                resetError={resetError}
                retryCount={retryCount}
                maxRetries={maxRetries}
                onReturnToOverview={() => handleTabChange('overview')}
              />
            )}
          >
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <section
                      aria-labelledby="league-overview-heading"
                      className="rounded-[22px] bg-[color:var(--league-primary)] p-5 text-[color:var(--league-primary-foreground)] shadow-[0_24px_70px_-48px_rgba(15,23,42,0.7)] sm:p-6"
                    >
                      <div className="flex flex-col gap-6">
                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                          <div>
                            <p className="text-sm font-medium text-white/85">League overview</p>
                            <h1
                              id="league-overview-heading"
                              className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl"
                            >
                              {league.name}
                            </h1>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/85">
                              <span>
                                {league.type === 'private' ? 'Private' : 'Public'} ·{' '}
                                {activeMembers.length}/{league.maxTeams} teams
                              </span>
                              <span className="inline-flex min-h-7 items-center rounded-full border border-white/35 bg-white/10 px-3 text-xs font-semibold text-white">
                                {getDraftStatusLabel(draftReadiness?.status)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-white/75">
                              {openTeamSlots === 0
                                ? 'League is full'
                                : `${openTeamSlots} team ${openTeamSlots === 1 ? 'slot' : 'slots'} open`}
                            </p>
                          </div>

                          <dl className="grid gap-5 sm:grid-cols-2 lg:min-w-[22rem]">
                            <div>
                              <dt className="text-sm font-medium text-white/85">Your team</dt>
                              <dd className="mt-2 flex flex-wrap items-center gap-2 text-lg font-semibold text-white">
                                <span>{currentMember?.teamName ?? 'Team not set'}</span>
                                {canAccessCompetitionRules && (
                                  <span className="inline-flex min-h-7 items-center rounded-full border border-white/35 bg-white/10 px-3 text-xs font-semibold text-white">
                                    Commissioner
                                  </span>
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm font-medium text-white/85">Waiver position</dt>
                              <dd className="mt-2 text-white">
                                <span className="block text-lg font-semibold">
                                  {waiverPriorityLabel}
                                </span>
                                <span className="mt-1 block text-sm capitalize text-white/80">
                                  {waiverPolicyLabel} order
                                </span>
                              </dd>
                            </div>
                          </dl>
                        </div>

                        <div className="border-t border-white/15 pt-5">
                          <h2 className="text-sm font-semibold text-white/90">
                            Scoring categories
                          </h2>
                          <p className="mt-2 text-sm leading-6 text-white/85">
                            {categoryLabels.join(' · ')}
                          </p>
                        </div>
                      </div>
                    </section>

                    <section
                      aria-labelledby="overview-teams-heading"
                      className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h2
                            id="overview-teams-heading"
                            className="text-lg font-semibold text-[color:var(--league-text)]"
                          >
                            Teams
                          </h2>
                          <p className="mt-1 text-sm text-[color:var(--league-text-muted)]">
                            {league.maxTeams}-team league
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleTabChange('teams')}
                          className="inline-flex h-9 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                        >
                          View teams
                        </button>
                      </div>

                      <ul
                        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
                        aria-label="League teams"
                      >
                        {overviewTeams.map((member) => {
                          const isCurrentTeam = member.userId === currentUserId;

                          return (
                            <li
                              key={member.id}
                              className={`group flex min-h-32 flex-col items-center justify-center rounded-2xl border px-3 py-3 text-center transition hover:-translate-y-0.5 hover:border-[color:var(--league-primary)] hover:bg-[color:var(--league-surface)] hover:shadow-md ${
                                isCurrentTeam
                                  ? 'border-[color:var(--league-primary)] bg-[color:var(--league-primary-soft)] ring-2 ring-[color:var(--league-primary)]/15'
                                  : 'border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)]'
                              }`}
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
                              {isCurrentTeam && (
                                <span className="mt-2 inline-flex min-h-7 items-center rounded-full bg-[color:var(--league-primary)] px-3 text-xs font-semibold text-[color:var(--league-primary-foreground)]">
                                  Your team
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <section
                      aria-labelledby="overview-trades-heading"
                      className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_18px_55px_-48px_rgba(15,23,42,0.35)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <h2
                          id="overview-trades-heading"
                          className="text-lg font-semibold text-[color:var(--league-text)]"
                        >
                          Trade offers
                        </h2>
                        <button
                          type="button"
                          onClick={() => handleTabChange('trades')}
                          className="inline-flex h-10 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                        >
                          Trade centre
                        </button>
                      </div>
                      <div className="mt-4 space-y-3">
                        {initialTradeDigest?.recent.length ? (
                          initialTradeDigest.recent.map((trade) => (
                            <div
                              key={trade.id}
                              className="rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-3"
                            >
                              <p className="text-sm font-semibold text-[color:var(--league-text)]">
                                {trade.teamNames.join(' ↔ ')}
                              </p>
                              <p className="mt-1 text-xs text-[color:var(--league-text-muted)]">
                                {trade.playerNames.length > 0
                                  ? trade.playerNames.join(', ')
                                  : 'Player details available in trade centre'}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-xl border border-dashed border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-4 text-sm text-[color:var(--league-text-muted)]">
                            No pending trade offers.
                          </p>
                        )}
                      </div>
                    </section>

                    <section
                      aria-labelledby="overview-waivers-heading"
                      className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_18px_55px_-48px_rgba(15,23,42,0.35)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <h2
                          id="overview-waivers-heading"
                          className="text-lg font-semibold text-[color:var(--league-text)]"
                        >
                          Waiver position
                        </h2>
                        <button
                          type="button"
                          onClick={() => handleTabChange('waivers')}
                          className="inline-flex h-10 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-4 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                        >
                          Waivers
                        </button>
                      </div>
                      <div className="mt-4 rounded-xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-4">
                        <p className="text-lg font-semibold text-[color:var(--league-text)]">
                          {waiverPriorityIndex >= 0 ? waiverPriorityLabel : 'Waiver order pending'}
                        </p>
                        <p className="mt-1 text-sm capitalize text-[color:var(--league-text-muted)]">
                          {waiverPolicyLabel} waiver order
                        </p>
                        {overviewWaiversStatus === 'loading' ? (
                          <p className="mt-3 text-sm text-[color:var(--league-text-muted)]">
                            Checking waiver bids...
                          </p>
                        ) : overviewWaiverClaims.length > 0 ? (
                          <div className="mt-4 space-y-2">
                            {overviewWaiverClaims.map((claim) => (
                              <div
                                key={claim.id}
                                className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-2"
                              >
                                <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--league-text)]">
                                  {claim.playerName}
                                </p>
                                <p className="shrink-0 text-xs font-semibold text-[color:var(--league-text-muted)]">
                                  {typeof claim.bidAmount === 'number'
                                    ? `$${claim.bidAmount}`
                                    : 'Claim'}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-[color:var(--league-text-muted)]">
                            {waiverPriorityIndex >= 0
                              ? 'No pending waiver bids.'
                              : 'Your position will appear when the order is set.'}
                          </p>
                        )}
                      </div>
                    </section>
                  </div>
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
                          const canRemoveMember =
                            canRemoveTeams && member.userId !== league.ownerId;

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
                                          {removingUserId === member.userId
                                            ? 'Removing'
                                            : 'Confirm'}
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
                <LeagueTradeCentrePanel
                  leagueId={league.id}
                  currentUserId={currentUserId}
                  initialSnapshot={initialTradeCentre}
                  initialError={initialTradeCentreError}
                  requestedPlayerId={selectedPlayerId}
                  ownerMemberId={selectedPlayerOwnerMemberId}
                />
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
                            <li key={blocker.id ?? `${blocker.code}:${blocker.message}`}>
                              {blocker.message}
                            </li>
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
          </SectionErrorBoundary>
        </div>
      </div>
    </div>
  );
}
