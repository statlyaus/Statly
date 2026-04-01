/**
 * League Dashboard Component
 * Demonstrates proper league-isolated data flow with real-time synchronization
 */

'use client';

import React, { useState, useEffect } from 'react';

import { useLeagueData } from '@/hooks/useLeagueData';
import type { LeagueRoster, LeagueMember } from '@/services/leagueDataService';

interface LeagueDashboardProps {
  leagueId: string;
  userId: string;
  onLeagueChange?: (leagueId: string) => void;
}

interface RosterDisplayProps {
  roster: LeagueRoster;
  owner: LeagueMember | null;
  isUserTeam: boolean;
  onUpdateRoster?: (updates: Partial<LeagueRoster>) => void;
}

interface MemberListProps {
  members: LeagueMember[];
  currentUserId: string;
}

export function LeagueDashboard({ leagueId, userId, onLeagueChange }: LeagueDashboardProps) {
  const [activeTab, setActiveTab] = useState<'rosters' | 'draft' | 'trades' | 'waivers'>('rosters');
  const [_selectedRoster, _setSelectedRoster] = useState<LeagueRoster | null>(null);

  const {
    rosters,
    userRoster,
    members,
    draftPicks,
    trades,
    waiverClaims,
    loading,
    errors,
    updateRoster,
    submitWaiverClaim,
    proposeTrade: _proposeTrade,
    subscribe,
    unsubscribe,
    isSubscribed,
    getUserTeam: _getUserTeam,
    getTeamOwner,
    getUserTrades,
    getUserWaivers,
  } = useLeagueData({
    leagueId,
    userId,
    autoSubscribe: true, // Automatically subscribe to basic collections
  });

  // Subscribe to additional collections based on active tab
  useEffect(() => {
    const subscriptions: string[] = [];

    switch (activeTab) {
      case 'draft':
        if (!isSubscribed('draft')) {
          subscriptions.push('draft');
        }
        break;
      case 'trades':
        if (!isSubscribed('trades')) {
          subscriptions.push('trades');
        }
        break;
      case 'waivers':
        if (!isSubscribed('waivers')) {
          subscriptions.push('waivers');
        }
        break;
    }

    if (subscriptions.length > 0) {
      subscribe(subscriptions);
    }
  }, [activeTab, isSubscribed, subscribe]);

  // Clean up subscriptions when component unmounts
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  const handleRosterUpdate = async (teamId: string, updates: Partial<LeagueRoster>) => {
    try {
      await updateRoster(teamId, updates);
    } catch (error) {
      console.error('Failed to update roster:', error);
      // Show user-friendly error message
    }
  };

  const handleWaiverClaim = async (
    playerId: string,
    dropPlayerId?: string,
    _bidAmount?: number
  ) => {
    if (!userRoster) {
      console.error('User roster not found');
      return;
    }

    try {
      await submitWaiverClaim({
        userId,
        teamId: userRoster.id,
        playerId,
        dropPlayerId,
        priority:
          waiverClaims.filter((c) => c.userId === userId && c.status === 'PENDING').length + 1,
        status: 'PENDING',
        processingAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to submit waiver claim:', error);
    }
  };

  if (loading.rosters || loading.members) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading league data...</span>
      </div>
    );
  }

  if (errors.rosters || errors.members) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error Loading League Data</h3>
        <p className="text-red-600 text-sm mt-1">
          {errors.rosters?.message || errors.members?.message || 'Unknown error occurred'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-red-600 hover:text-red-800 text-sm font-medium underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* League Header */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">League Dashboard</h1>
            <p className="text-gray-600">
              League ID: {leagueId} • {members.length} teams • Real-time sync active
            </p>
          </div>

          {/* League switching could go here */}
          {onLeagueChange && (
            <button
              onClick={() => onLeagueChange('different-league')}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              Switch League
            </button>
          )}
        </div>

        {/* Subscription Status Indicator */}
        <div className="mt-4 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-gray-600">
              Subscriptions: Rosters, Members
              {isSubscribed('draft') && ', Draft'}
              {isSubscribed('trades') && ', Trades'}
              {isSubscribed('waivers') && ', Waivers'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'rosters', label: 'Rosters', count: rosters.length },
            { id: 'draft', label: 'Draft', count: draftPicks.length },
            { id: 'trades', label: 'Trades', count: trades.length },
            { id: 'waivers', label: 'Waivers', count: waiverClaims.length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {activeTab === 'rosters' && (
        <div
          id="panel-rosters"
          role="tabpanel"
          aria-labelledby="tab-rosters"
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
           {/* Rosters List */}
           <div className="lg:col-span-2 space-y-4">
             <h2 className="text-lg font-medium text-gray-900">Team Rosters</h2>

             {rosters.map((roster) => (
               <RosterDisplay
                 key={roster.id}
                 roster={roster}
                 owner={getTeamOwner(roster.id)}
                 isUserTeam={roster.userId === userId}
                 onUpdateRoster={(updates) => handleRosterUpdate(roster.id, updates)}
               />
             ))}
           </div>

           {/* Members Sidebar */}
           <div>
             <MemberList members={members} currentUserId={userId} />
           </div>
        </div>
        )}

        {activeTab === 'draft' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Draft Board</h2>
              {loading.draft && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  Loading draft picks...
                </div>
              )}
            </div>

            <div className="bg-white shadow rounded-lg p-6">
              {draftPicks.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No draft picks available</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {draftPicks.slice(0, 12).map((pick) => (
                    <div key={pick.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="text-sm font-medium text-gray-900">
                        Round {pick.round}, Pick {pick.pick}
                      </div>
                      <div className="text-xs text-gray-500">
                        Team: {getTeamOwner(pick.teamId)?.teamName || 'Unknown'}
                      </div>
                      {pick.playerId ? (
                        <div className="text-sm text-green-600 mt-1">
                          Player {pick.playerId.slice(-4)} selected
                        </div>
                      ) : (
                        <div className="text-sm text-yellow-600 mt-1">
                          {pick.timeRemaining}s remaining
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'trades' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Trade Activity</h2>
              {loading.trades && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  Loading trades...
                </div>
              )}
            </div>

            <div className="bg-white shadow rounded-lg">
              {trades.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No trades in this league</p>
              ) : (
                <div className="divide-y divide-gray-200">
                  {getUserTrades(userId).map((trade) => (
                    <div key={trade.id} className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium text-gray-900">
                            Trade with{' '}
                            {trade.fromUserId === userId ? trade.toUserId : trade.fromUserId}
                          </h3>
                          <p className="text-sm text-gray-500">
                            Status: {trade.status} • {trade.createdAt.toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${
                            trade.status === 'COMPLETED'
                              ? 'bg-green-100 text-green-800'
                              : trade.status === 'PENDING'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {trade.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'waivers' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Waiver Claims</h2>
              {loading.waivers && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                  Loading waivers...
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* User's Waiver Claims */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="font-medium text-gray-900 mb-4">My Waiver Claims</h3>
                {getUserWaivers(userId).length === 0 ? (
                  <p className="text-gray-500">No active waiver claims</p>
                ) : (
                  <div className="space-y-3">
                    {getUserWaivers(userId).map((claim) => (
                      <div
                        key={claim.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div>
                          <div className="font-medium text-sm">
                            Player {claim.playerId.slice(-4)}
                          </div>
                          {claim.dropPlayerId && (
                            <div className="text-xs text-gray-500">
                              Drop: Player {claim.dropPlayerId.slice(-4)}
                            </div>
                          )}
                        </div>
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${
                            claim.status === 'SUCCESSFUL'
                              ? 'bg-green-100 text-green-800'
                              : claim.status === 'PENDING'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {claim.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Waiver Claim Form */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => handleWaiverClaim('sample-player-id')}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 text-sm"
                  >
                    Submit Test Waiver Claim
                  </button>
                </div>
              </div>

              {/* All League Waivers */}
              <div className="bg-white shadow rounded-lg p-6">
                <h3 className="font-medium text-gray-900 mb-4">League Waiver Queue</h3>
                {waiverClaims.length === 0 ? (
                  <p className="text-gray-500">No waiver claims in queue</p>
                ) : (
                  <div className="space-y-2">
                    {waiverClaims.slice(0, 10).map((claim) => (
                      <div key={claim.id} className="flex items-center justify-between text-sm">
                        <span>{getTeamOwner(claim.teamId)?.teamName || 'Unknown Team'}</span>
                        <span>Player {claim.playerId.slice(-4)}</span>
                        <span className="text-gray-500">Priority {claim.priority}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Activity Feed */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="font-medium text-gray-900 mb-4">Recent Activity</h3>
        <p className="text-sm text-gray-600">Activity feed coming soon.</p>
      </div>
    </div>
  );
}

// Sub-components
function RosterDisplay({ roster, owner, isUserTeam, onUpdateRoster }: RosterDisplayProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className={`bg-white shadow rounded-lg p-6 ${isUserTeam ? 'ring-2 ring-blue-500' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium text-gray-900">{roster.teamName}</h3>
          <p className="text-sm text-gray-500">
            Owner: {owner?.teamName || 'Unknown'} {isUserTeam && '(You)'}
          </p>
        </div>

        {isUserTeam && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            {isEditing ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-medium text-gray-700">
            Starting Lineup ({roster.playerIds.length})
          </h4>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {roster.playerIds.slice(0, 8).map((playerId, _index) => (
              <div key={playerId} className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                Player {playerId.slice(-4)}
              </div>
            ))}
          </div>
        </div>

        {roster.bench.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700">Bench ({roster.bench.length})</h4>
            <div className="flex flex-wrap gap-2 mt-2">
              {roster.bench.map((playerId) => (
                <span
                  key={playerId}
                  className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded"
                >
                  Player {playerId.slice(-4)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {isEditing && onUpdateRoster && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={() => {
              onUpdateRoster({ teamName: `${roster.teamName} (Updated)` });
              setIsEditing(false);
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm"
          >
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}

function MemberList({ members, currentUserId }: MemberListProps) {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h3 className="font-medium text-gray-900 mb-4">League Members</h3>

      <div className="space-y-3">
        {members.map((member) => (
          <div key={member.id} className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">
                {member.teamName} {member.userId === currentUserId && '(You)'}
              </div>
              <div className="text-xs text-gray-500">
                {member.role} • Joined {member.joinedAt.toLocaleDateString()}
              </div>
            </div>

            <span
              className={`px-2 py-1 text-xs rounded-full ${
                member.status === 'ACTIVE'
                  ? 'bg-green-100 text-green-800'
                  : member.status === 'INVITED'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-red-100 text-red-800'
              }`}
            >
              {member.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LeagueDashboard;
