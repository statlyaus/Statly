'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { League, LeagueMember } from '@/types/leagues';
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
import MyTeamPanel from '@/components/MyTeamPanel';
import type { Player, Team } from '@/types/players';
import DraftManager from './DraftManager';

interface LeagueTabsProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

type TabType = 'overview' | 'teams' | 'roster' | 'trades' | 'waivers' | 'draft' | 'settings';

interface Tab {
  id: TabType;
  name: string;
  icon?: React.ReactNode;
  badge?: number;
}

export default function LeagueTabs({ league, members, currentUserId }: LeagueTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams?.get('tab') as TabType;
    if (
      tabParam &&
      ['overview', 'teams', 'roster', 'trades', 'waivers', 'draft', 'settings'].includes(tabParam)
    ) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (tabId: TabType) => {
    setActiveTab(tabId);
    // Update URL without full page reload
    const newUrl = `${pathname}?tab=${tabId}`;
    router.push(newUrl, { scroll: false });
  };

  const tabs: Tab[] = [
    { id: 'overview', name: 'Overview' },
    { id: 'teams', name: 'Teams' },
    { id: 'roster', name: 'My Roster' },
    { id: 'trades', name: 'Trades' },
    { id: 'waivers', name: 'Waivers' },
    { id: 'draft', name: 'Draft' },
    { id: 'settings', name: 'Settings' },
  ];

  const currentMember = members.find((member) => member.userId === currentUserId);
  const isAdmin = currentMember?.role === 'owner' || currentMember?.role === 'manager';
  const draftReadiness = league.draftReadiness ?? null;
  const draftRoomPath =
    draftReadiness?.draftId && draftReadiness.lifecycle.canEnterRoom
      ? `/drafts/${draftReadiness.draftId}`
      : null;
  const draftDate = league.draftDate ? new Date(league.draftDate) : null;
  const formattedDraftDate =
    draftDate && !Number.isNaN(draftDate.getTime())
      ? new Intl.DateTimeFormat('en-AU', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(draftDate)
      : 'Not scheduled';

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-[0_22px_70px_-46px_rgba(23,34,48,0.35)] sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
              League command center
            </p>
            <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight text-[color:var(--league-text)] sm:text-4xl">
              {league.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[color:var(--league-text-muted)]">
              <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-3 py-1 font-semibold capitalize text-[color:var(--league-text)]">
                {league.type}
              </span>
              <span>
                {members.length}/{league.maxTeams} teams
              </span>
              <span>Draft: {formattedDraftDate}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {draftRoomPath ? (
              <button
                type="button"
                onClick={() => router.push(draftRoomPath)}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                Enter draft room
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleTabChange('draft')}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[color:var(--league-primary)] px-5 text-sm font-semibold text-[color:var(--league-primary-foreground)] transition hover:bg-[color:var(--league-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
              >
                Prepare draft
              </button>
            )}
            <button
              type="button"
              onClick={() => handleTabChange('teams')}
              className="inline-flex h-11 items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-page)] px-5 text-sm font-semibold text-[color:var(--league-text)] transition hover:bg-[color:var(--league-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
            >
              Manage teams
            </button>
          </div>
        </div>
      </section>

      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-lg">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span>{tab.name}</span>
                  {tab.badge && (
                    <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">
                      {tab.badge}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <section className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Your team
                    </p>
                    <p className="mt-2 text-lg font-semibold text-gray-900">
                      {currentMember?.teamName ?? 'Team not set'}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {currentMember?.role === 'owner' || currentMember?.role === 'manager'
                        ? 'Commissioner access'
                        : 'Member access'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Draft status
                    </p>
                    <p className="mt-2 text-lg font-semibold text-gray-900">
                      {draftReadiness?.status ?? 'Not prepared'}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {draftRoomPath
                        ? 'Room is available for this league.'
                        : (draftReadiness?.blockers[0]?.message ??
                          'Configure draft settings to prepare the room.')}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Scoring
                    </p>
                    <p className="mt-2 text-lg font-semibold text-gray-900">
                      {league.categories.length} categories
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      {league.categories
                        .slice(0, 3)
                        .map((category) => FANTASY_CATEGORIES[category]?.label ?? category)
                        .join(', ')}
                    </p>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Next action</h2>
                      <p className="mt-1 text-sm text-gray-600">
                        {draftRoomPath
                          ? 'Enter the draft room to manage readiness, queue, watchlist, and picks.'
                          : 'Open the draft tab to configure the draft room and commissioner settings.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        draftRoomPath ? router.push(draftRoomPath) : handleTabChange('draft')
                      }
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      {draftRoomPath ? 'Enter draft room' : 'Prepare draft'}
                    </button>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'teams' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">League Teams</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {members.map((member) => (
                    <div key={member.id} className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{member.teamName}</h3>
                        {member.role === 'owner' && (
                          <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">
                            Owner
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        Joined {new Date(member.joinedAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
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
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Waiver Wire</h2>
                  <button
                    type="button"
                    onClick={() => router.push(`/leagues/${league.id}/waivers`)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Open waivers
                  </button>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                  <p className="text-sm text-gray-600">
                    Submit claims, review waiver order, and process league waiver activity from the
                    dedicated waiver workspace.
                  </p>
                </div>
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

            {activeTab === 'settings' && (
              <LeagueSettingsPanel
                league={league}
                memberCount={members.length}
                isAdmin={isAdmin}
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
      categories: [...CATEGORY_PRESET],
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
      categories: [...CATEGORY_PRESET],
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

function LeagueSettingsPanel({
  league,
  memberCount,
  isAdmin,
  isActive,
  currentUserId,
}: {
  league: League;
  memberCount: number;
  isAdmin: boolean;
  isActive: boolean;
  currentUserId?: string;
}) {
  const [settings, setSettings] = useState<LeagueSettingsResponse>(() =>
    createFallbackLeagueSettings(league)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<LeagueSettingsMessage | null>(null);

  useEffect(() => {
    setSettings(createFallbackLeagueSettings(league));
  }, [league]);

  useEffect(() => {
    if (!isActive) return;

    let mounted = true;
    async function loadLeagueSettings() {
      try {
        setIsLoading(true);
        setMessage(null);
        const response = await authenticatedFetch(
          `/api/leagues/${league.id}/settings`,
          {},
          currentUserId
        );
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? `status ${response.status}`);
        }

        if (mounted) {
          setSettings(normalizeLeagueSettingsPayload(payload.data, league));
        }
      } catch (error) {
        if (mounted) {
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : 'Failed to load league settings.',
          });
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void loadLeagueSettings();
    return () => {
      mounted = false;
    };
  }, [currentUserId, isActive, league]);

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

    try {
      setIsSaving(true);
      setMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      setSettings(normalizeLeagueSettingsPayload(payload.data, league));
      setMessage({ type: 'success', text: 'League settings saved.' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save league settings.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const teamFillPercent = Math.min(100, Math.round((memberCount / settings.league.maxTeams) * 100));

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
              : 'border-red-200 bg-red-50 text-red-700'
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
                min={4}
                max={20}
                value={settings.league.maxTeams}
                onChange={(event) =>
                  updateLeagueSettings({ maxTeams: Number.parseInt(event.target.value, 10) || 4 })
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

        <section className="rounded-lg border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5">
          <h3 className="text-base font-semibold text-[color:var(--league-text)]">
            Scoring Categories
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_PRESET.map((category) => {
              const categoryData = FANTASY_CATEGORIES[category];
              const isSelected = settings.scoring.categories.includes(category);

              return (
                <div
                  key={category}
                  className="rounded-md border border-[color:var(--league-border)] bg-[color:var(--league-page)] p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-[color:var(--league-text)]">
                      {categoryData?.label ?? category}
                    </span>
                    <span className="rounded-full bg-[color:var(--league-surface-muted)] px-2 py-0.5 text-xs font-semibold text-[color:var(--league-text-muted)]">
                      {categoryData?.abbrev ?? category}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[color:var(--league-text-muted)]">
                    {isSelected ? 'Selected' : 'Available'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

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

function MyTeamRosterManager({ league, members, currentUserId }: MyTeamRosterManagerProps) {
  const [_selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [lastAction, setLastAction] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<Record<string, unknown> | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);

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
          setRoster(rosterData.roster);
          setPlayers(rosterData.players || []);
        } else {
          console.error('Failed to fetch roster data');
        }
      } catch (error) {
        console.error('Error fetching roster:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRosterData();
  }, [league?.id, currentUserId]);

  // Convert roster data to Team format for MyTeamPanel
  const team: Team | undefined = roster
    ? {
        id: String(roster.id),
        name: currentUserTeam?.teamName || 'My Team',
        players: (roster.playerIds as string[]) || [],
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
                setRoster(rosterData.roster);
                setPlayers(rosterData.players || []);
                setLastAction(`${action} completed successfully`);
              }
            } catch (error) {
              console.error('Failed to refresh roster:', error);
            }
          };
          refreshRoster();
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
        setRoster(rosterData.roster);
        setPlayers(rosterData.players || []);
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
        maxHeight="600px"
        isLoading={loading}
      />

      {/* Additional League-specific Team Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => handleTeamAction('optimize')}
          disabled={loading}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          Optimize Lineup
        </button>
        <button
          onClick={() => handleTeamAction('trade')}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          Propose Trade
        </button>
        <button
          onClick={() => handleTeamAction('waivers')}
          disabled={loading}
          className="bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-yellow-700 transition-colors disabled:opacity-50"
        >
          Waiver Claims
        </button>
      </div>
    </div>
  );
}
