'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import type { League, LeagueMember } from '@/types/leagues';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import LeagueOverview from '@/components/league/LeagueOverview';
import MyTeamPanel from '@/components/MyTeamPanel';
import type { Player, Team } from '@/types/players';

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
    { id: 'trades', name: 'Trades', badge: 2 },
    { id: 'waivers', name: 'Waivers' },
    { id: 'draft', name: 'Draft' },
    { id: 'settings', name: 'Settings' },
  ];

  const isAdmin = members.find((m) => m.userId === currentUserId)?.role === 'owner';

  return (
    <div className="space-y-6">
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
              <LeagueOverview league={league} members={members} currentUserId={currentUserId} />
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
                  <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                    Propose Trade
                  </button>
                </div>
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600">Trade interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === 'waivers' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Waiver Wire</h2>
                  <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                    Submit Claim
                  </button>
                </div>
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600">Waiver wire interface coming soon...</p>
                </div>
              </div>
            )}

            {activeTab === 'draft' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">Draft</h2>
                {league.draftDate ? (
                  <div className="bg-blue-50 rounded-lg p-6">
                    <h3 className="font-medium text-blue-900 mb-2">Draft Scheduled</h3>
                    <p className="text-blue-700 mb-4">
                      {new Date(league.draftDate).toLocaleString()}
                    </p>
                    <div className="space-y-3">
                      <button
                        onClick={() => router.push(`/drafts/${league.id}`)}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors mr-3"
                      >
                        Enter Draft Room
                      </button>
                      <button
                        onClick={() => router.push('/players')}
                        className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
                      >
                        Preview Players
                      </button>
                    </div>
                    <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                      <h4 className="font-medium text-blue-900 text-sm mb-1">
                        Draft Preparation Tips:
                      </h4>
                      <ul className="text-blue-700 text-sm space-y-1">
                        <li>• Test your device connection before the draft</li>
                        <li>• Research players and create a watchlist</li>
                        <li>• Review league scoring categories</li>
                        <li>• Have backup picks ready for each round</li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-8 text-center">
                      <h3 className="font-medium text-gray-900 mb-2">No Draft Scheduled</h3>
                      <p className="text-gray-600 mb-4">
                        Set up a draft for this league to start your fantasy season.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-2">Create New Draft</h4>
                        <p className="text-gray-600 text-sm mb-3">
                          Set up a draft room with all league members and draft settings.
                        </p>
                        <button
                          onClick={() => router.push('/drafts/create')}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors w-full"
                        >
                          Create Draft Room
                        </button>
                      </div>

                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-2">Practice Draft</h4>
                        <p className="text-gray-600 text-sm mb-3">
                          Try a practice draft to test the system and get familiar with the
                          interface.
                        </p>
                        <button
                          onClick={() => router.push('/players')}
                          className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors w-full"
                        >
                          Browse Players
                        </button>
                      </div>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <h4 className="font-medium text-yellow-900 mb-2">📋 Draft Setup Checklist</h4>
                      <ul className="text-yellow-800 text-sm space-y-1">
                        <li>
                          ✓ League created with {members.length} member
                          {members.length !== 1 ? 's' : ''}
                        </li>
                        <li>
                          ✓ Scoring categories configured ({league.categories.length} categories)
                        </li>
                        <li>• Schedule draft date and time</li>
                        <li>• Invite remaining members (max {league.maxTeams})</li>
                        <li>• Set roster and bench sizes</li>
                        <li>• Configure draft order (snake vs linear)</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-gray-900">League Settings</h2>

                {/* Basic Info */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-medium text-gray-900 mb-4">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="league-name"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
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
                      <label
                        htmlFor="league-code"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
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

                {/* Scoring Categories */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-medium text-gray-900 mb-4">Scoring Categories</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {league.categories.map((category) => {
                      const categoryData = FANTASY_CATEGORIES[category];
                      return (
                        <div
                          key={category}
                          className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg"
                        >
                          <span className="text-sm font-medium text-blue-900">
                            {categoryData?.label || category}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Trade Settings */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-medium text-gray-900 mb-4">Trade Settings</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="trade-limit"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
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
                      <label
                        htmlFor="trade-review"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
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
            )}
          </motion.div>
        </div>
      </div>
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
