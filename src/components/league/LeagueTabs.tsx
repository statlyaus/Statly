'use client';

import React, { useState, useEffect } from 'react';

import Link from 'next/link';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';

import { motion } from 'framer-motion';

import { useAuth } from '@/AuthContext';
import LeagueOverview from '@/components/league/LeagueOverview';
import MyTeamPanel from '@/components/MyTeamPanel';
import { isAuthBypassEnabled } from '@/lib/authBypass';
import { FANTASY_CATEGORIES } from '@/types/fantasyCategories';
import type { League, LeagueMember } from '@/types/leagues';
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

export default function LeagueTabs({ league, members, currentUserId }: LeagueTabsProps): React.ReactElement {
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
  const totalTeams = members.length;
  const maxTeams = league.maxTeams || 0;
  const openSlots = Math.max(0, maxTeams - totalTeams);
  const fillPercent = maxTeams > 0 ? Math.min(100, Math.round((totalTeams / maxTeams) * 100)) : 0;
  const roleBadgeClass = (role: LeagueMember['role']) => {
    if (role === 'owner') return 'bg-amber-100 text-amber-700';
    if (role === 'manager') return 'bg-blue-100 text-blue-700';
    return 'bg-slate-100 text-slate-600';
  };


  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-lg">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => (
              <Link
                key={tab.id}
                href={`${pathname}?tab=${tab.id}`}
                role="button"
                type="button"
                aria-label={`Switch to ${tab.name} tab`}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                onClick={() => handleTabChange(tab.id)}
              >
                <div className="flex items-center space-x-2">
                  <span>{tab.name}</span>
                  {tab.badge && (
                    <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">
                      {tab.badge}
                    </span>
                  )}
                </div>
              </Link>
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
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Teams</p>
                      <h2 className="text-2xl font-semibold text-slate-900">League Teams</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        Track every roster and keep a pulse on who is in the race.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                        {league.status}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {totalTeams}/{maxTeams} teams
                      </span>
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                        {openSlots} open
                      </span>
                    </div>
                  </div>
                  <div className="px-6 py-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Capacity</span>
                      <span>{fillPercent}% full</span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-500"
                        style={{ width: `${fillPercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {members.map((member) => (
                    <Link
                      key={member.id}
                      href={`/leagues/${league.id}/teams/${member.userId}`}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label={`View roster for ${member.teamName}`}
                    >
                      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-500" />
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                              {member.teamName
                                .split(' ')
                                .map((word) => word.charAt(0))
                                .join('')
                                .slice(0, 2)
                                .toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Team</p>
                              <h3 className="text-lg font-semibold text-slate-900">{member.teamName}</h3>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${roleBadgeClass(
                                member.role
                              )}`}
                            >
                              {member.role}
                            </span>
                            {member.userId === currentUserId && (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                                You
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-400">Joined</p>
                            <p className="mt-1 font-medium text-slate-700">
                              {new Date(member.joinedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-400">Status</p>
                            <p className="mt-1 font-medium text-slate-700 capitalize">{league.status}</p>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-blue-600">
                          <span>View roster</span>
                          <span aria-hidden="true">→</span>
                        </div>
                      </div>
                    </Link>
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
                      <Link
                        href={`/drafts/${league.id}`}
                        className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors mr-3"
                        aria-label="Enter the draft room for this league"
                      >
                        Enter Draft Room
                      </Link>
                      <Link
                        href="/players"
                        className="inline-block bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
                        aria-label="Preview available players"
                      >
                        Preview Players
                      </Link>
                    </div>
                    <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                      <h4 className="font-medium text-blue-900 text-sm mb-1">
                        Draft Preparation Tips:
                      </h4>
                      <ul className="text-blue-700 text-sm space-y-1">
                        <li>Test your device connection before the draft</li>
                        <li>Research players and create a watchlist</li>
                        <li>Review league scoring categories</li>
                        <li>Have backup picks ready for each round</li>
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
                        <Link
                          href="/drafts/create"
                          className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors w-full text-center"
                          aria-label="Create a new draft room for this league"
                        >
                          Create Draft Room
                        </Link>
                      </div>

                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium text-gray-900 mb-2">Practice Draft</h4>
                        <p className="text-gray-600 text-sm mb-3">
                          Try a practice draft to test the system and get familiar with the
                          interface.
                        </p>
                        <Link
                          href="/players"
                          className="inline-block bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors w-full text-center"
                          aria-label="Browse available players"
                        >
                          Browse Players
                        </Link>
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
                        <li>Schedule draft date and time</li>
                        <li>Invite remaining members (max {league.maxTeams})</li>
                        <li>Set roster and bench sizes</li>
                        <li>Configure draft order (snake vs linear)</li>
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
  const { user: authUser, loading: authLoading } = useAuth();
  const [_selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [lastAction, setLastAction] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<Record<string, unknown> | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);

  // Get current user's team from league members
  const currentUserTeam = members.find((member) => member.userId === currentUserId);

  // Fetch roster data from real API
  useEffect(() => {
    if (!league?.id || !currentUserId || authLoading) return;
    if (!authUser && !isAuthBypassEnabled()) return;

    const fetchRosterData = async () => {
      setLoading(true);
      try {
        const token =
          authUser && typeof authUser.getIdToken === 'function'
            ? await authUser.getIdToken()
            : null;
        const response = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (response.ok) {
          const rosterData = await response.json();
          const payload = rosterData?.data ?? rosterData;
          setRoster(payload?.roster ?? null);
          setPlayers(payload?.roster?.players || payload?.players || []);
        } else {
          const errorBody = await response.text().catch(() => '');
          console.error('Failed to fetch roster data', {
            status: response.status,
            statusText: response.statusText,
            body: errorBody,
          });
        }
      } catch (error) {
        console.error('Error fetching roster:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchRosterData();
  }, [league?.id, currentUserId, authUser, authLoading]);

  // Convert roster data to Team format for MyTeamPanel
  const team: Team | undefined = roster
    ? {
        id: String(roster.id),
        name: currentUserTeam?.teamName || 'My Team',
        players: Array.isArray((roster as { players?: Array<{ id: string | number }> }).players)
          ? (roster as { players?: Array<{ id: string | number }> }).players!.map((p) => String(p.id))
          : [],
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
      const token = authUser ? await authUser.getIdToken() : null;
      const response = await fetch(`/api/leagues/${league.id}/actions/${currentUserId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
              const token = authUser ? await authUser.getIdToken() : null;
              const rosterResponse = await fetch(
                `/api/leagues/${league.id}/roster/${currentUserId}`,
                {
                  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                }
              );
              if (rosterResponse.ok) {
                const rosterData = await rosterResponse.json();
                const payload = rosterData?.data ?? rosterData;
                setRoster(payload?.roster ?? null);
                setPlayers(payload?.roster?.players || payload?.players || []);
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
      const token = authUser ? await authUser.getIdToken() : null;
      const response = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (response.ok) {
        const rosterData = await response.json();
        const payload = rosterData?.data ?? rosterData;
        setRoster(payload?.roster ?? null);
        setPlayers(payload?.roster?.players || payload?.players || []);
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
      {/* League Context Header */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Roster Command</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">
              {currentUserTeam.teamName}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {league.name} • Members {members.length}/{league.maxTeams}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {lastAction && (
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {lastAction}
              </div>
            )}
            <button
              onClick={() => handleTeamAction('optimize')}
              disabled={loading}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500 disabled:opacity-50"
            >
              Optimize
            </button>
            <button
              onClick={() => handleTeamAction('trade')}
              disabled={loading}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50"
            >
              Propose Trade
            </button>
          </div>
        </div>
        <div className="grid gap-3 border-t border-slate-100 px-6 py-4 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Roster Size</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{players.length}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Average Score</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {typeof (roster as { averageScore?: number } | null)?.averageScore === 'number'
                ? Math.round((roster as { averageScore: number }).averageScore)
                : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Refresh Data</p>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
            >
              Sync Now
            </button>
          </div>
        </div>
      </div>

      {/* MyTeamPanel Integration */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
      </div>

      {/* Additional League-specific Team Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <button
          onClick={() => handleTeamAction('optimize')}
          disabled={loading}
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          Optimize Lineup
        </button>
        <button
          onClick={() => handleTeamAction('trade')}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Propose Trade
        </button>
        <button
          onClick={() => handleTeamAction('waivers')}
          disabled={loading}
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          Waiver Claims
        </button>
      </div>
    </div>
  );
}
