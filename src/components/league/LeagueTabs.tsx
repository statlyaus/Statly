'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { League, LeagueMember } from '@/types/leagues';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import LeagueOverview from '@/components/league/LeagueOverview';
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

const TABS: Tab[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'teams', name: 'Teams' },
  { id: 'roster', name: 'My Roster' },
  { id: 'trades', name: 'Trades', badge: 2 },
  { id: 'waivers', name: 'Waivers' },
  { id: 'draft', name: 'Draft' },
  { id: 'settings', name: 'Settings' },
];

const TAB_IDS = new Set<TabType>(TABS.map((tab) => tab.id));

type DraftReadiness = NonNullable<League['draftReadiness']>;

function isTabType(value: string | null | undefined): value is TabType {
  return Boolean(value && TAB_IDS.has(value as TabType));
}

export default function LeagueTabs({
  league,
  members,
  currentUserId,
}: LeagueTabsProps): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams?.get('tab');
    if (isTabType(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (tabId: TabType): void => {
    setActiveTab(tabId);
    // Update URL without full page reload
    const newUrl = `${pathname}?tab=${tabId}`;
    router.push(newUrl, { scroll: false });
  };

  const isAdmin = members.find((m) => m.userId === currentUserId)?.role === 'owner';
  const draftReadiness = league.draftReadiness ?? null;
  const draftRoomPath =
    draftReadiness?.draftId && draftReadiness.lifecycle.canEnterRoom
      ? `/drafts/${draftReadiness.draftId}`
      : null;

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-lg">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {TABS.map((tab) => (
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
                  {tab.badge ? (
                    <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">
                      {tab.badge}
                    </span>
                  ) : null}
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
            <LeagueTabPanel
              activeTab={activeTab}
              league={league}
              members={members}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              draftReadiness={draftReadiness}
              draftRoomPath={draftRoomPath}
              onNavigate={(href) => router.push(href)}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

interface LeagueTabPanelProps extends LeagueTabsProps {
  activeTab: TabType;
  isAdmin: boolean;
  draftReadiness: DraftReadiness | null;
  draftRoomPath: string | null;
  onNavigate: (href: string) => void;
}

function LeagueTabPanel({
  activeTab,
  league,
  members,
  currentUserId,
  isAdmin,
  draftReadiness,
  draftRoomPath,
  onNavigate,
}: LeagueTabPanelProps): React.JSX.Element | null {
  switch (activeTab) {
    case 'overview':
      return <LeagueOverview league={league} members={members} currentUserId={currentUserId} />;
    case 'teams':
      return <TeamsTab league={league} members={members} />;
    case 'roster':
      return <RosterTab league={league} members={members} currentUserId={currentUserId} />;
    case 'trades':
      return (
        <ComingSoonTab
          title="Trades"
          actionLabel="Propose Trade"
          message="Trade interface coming soon..."
        />
      );
    case 'waivers':
      return (
        <ComingSoonTab
          title="Waiver Wire"
          actionLabel="Submit Claim"
          message="Waiver wire interface coming soon..."
        />
      );
    case 'draft':
      return (
        <DraftTab
          league={league}
          members={members}
          currentUserId={currentUserId}
          draftReadiness={draftReadiness}
          draftRoomPath={draftRoomPath}
          onNavigate={onNavigate}
        />
      );
    case 'settings':
      return <SettingsTab league={league} isAdmin={isAdmin} />;
    default:
      return null;
  }
}

function TeamsTab({
  league,
  members,
}: Pick<LeagueTabsProps, 'league' | 'members'>): React.JSX.Element {
  return (
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
            {league.status !== 'preseason' && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="text-sm">
                  <span className="text-gray-600">Record: </span>
                  <span className="font-medium">4-3</span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-600">Points: </span>
                  <span className="font-medium">823.1</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RosterTab({ league, members, currentUserId }: LeagueTabsProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">My Roster</h2>
      <MyTeamRosterManager league={league} members={members} currentUserId={currentUserId} />
    </div>
  );
}

function ComingSoonTab({
  title,
  actionLabel,
  message,
}: {
  title: string;
  actionLabel: string;
  message: string;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          {actionLabel}
        </button>
      </div>
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  );
}

interface DraftTabProps extends LeagueTabsProps {
  draftReadiness: DraftReadiness | null;
  draftRoomPath: string | null;
  onNavigate: (href: string) => void;
}

function DraftTab({
  league,
  members,
  currentUserId,
  draftReadiness,
  draftRoomPath,
  onNavigate,
}: DraftTabProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      {draftReadiness && (
        <DraftStatusPanel
          draftReadiness={draftReadiness}
          draftRoomPath={draftRoomPath}
          onNavigate={onNavigate}
        />
      )}
      <DraftManager
        league={league}
        members={members}
        currentUserId={currentUserId}
        onDraftCreated={(draftId) => onNavigate(`/drafts/${draftId}`)}
        onJoinDraftRoom={(draftId) => onNavigate(`/drafts/${draftId}`)}
      />
    </div>
  );
}

function DraftStatusPanel({
  draftReadiness,
  draftRoomPath,
  onNavigate,
}: {
  draftReadiness: DraftReadiness;
  draftRoomPath: string | null;
  onNavigate: (href: string) => void;
}): React.JSX.Element {
  return (
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
            onClick={() => onNavigate(draftRoomPath)}
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
  );
}

function SettingsTab({ league, isAdmin }: { league: League; isAdmin: boolean }): React.JSX.Element {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900">League Settings</h2>

      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="font-medium text-gray-900 mb-4">Basic Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="league-name" className="block text-sm font-medium text-gray-700 mb-1">
              League Name
            </label>
            <input
              id="league-name"
              type="text"
              value={league.name}
              disabled={!isAdmin}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100"
            />
          </div>
          <div>
            <label htmlFor="league-code" className="block text-sm font-medium text-gray-700 mb-1">
              League Code
            </label>
            <input
              id="league-code"
              type="text"
              value={league.code}
              disabled
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100"
            />
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="font-medium text-gray-900 mb-4">Scoring Categories</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {league.categories.map((category) => {
            const categoryData = FANTASY_CATEGORIES[category];
            return (
              <div key={category} className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg">
                <span className="text-sm font-medium text-blue-900">
                  {categoryData?.label || category}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="font-medium text-gray-900 mb-4">Trade Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="trade-limit" className="block text-sm font-medium text-gray-700 mb-1">
              Trade Limit
            </label>
            <input
              id="trade-limit"
              type="number"
              value={league.tradeSettings.tradeLimit}
              disabled={!isAdmin}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100"
            />
          </div>
          <div>
            <label htmlFor="trade-review" className="block text-sm font-medium text-gray-700 mb-1">
              Review Process
            </label>
            <select
              id="trade-review"
              value={league.tradeSettings.tradeReview}
              disabled={!isAdmin}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white disabled:bg-gray-100"
            >
              <option value="none">None</option>
              <option value="admin">Admin Review</option>
              <option value="veto">League Veto</option>
            </select>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="flex justify-end space-x-3">
          <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Save Changes
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
