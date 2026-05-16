/**
 * League Dashboard Component
 * Demonstrates proper league-isolated data flow with real-time synchronization
 */

'use client';

import React, { useState, useEffect } from 'react';

import { useLeagueData } from '@/hooks/useLeagueData';
import type { LeagueRoster, LeagueMember } from '@/services/leagueDataService';
import { leagueStatusTonePatterns, leagueSurfacePatterns } from '@/styles/leagueDesignSystem';

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

const dashboardStatusBadgeClass =
  'inline-flex rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide';

function getDashboardStatusTone(status: string): string {
  if (status === 'COMPLETED' || status === 'SUCCESSFUL' || status === 'ACTIVE') {
    return leagueStatusTonePatterns.success;
  }

  if (status === 'PENDING' || status === 'INVITED') {
    return leagueStatusTonePatterns.warning;
  }

  return leagueStatusTonePatterns.danger;
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
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[color:var(--league-accent)]"></div>
        <span className="ml-3 text-[color:var(--league-text-muted)]">Loading league data...</span>
      </div>
    );
  }

  if (errors.rosters || errors.members) {
    return (
      <div className={`rounded-lg p-4 ${leagueStatusTonePatterns.danger}`}>
        <h3 className="font-medium">Error Loading League Data</h3>
        <p className="mt-1 text-sm">
          {errors.rosters?.message || errors.members?.message || 'Unknown error occurred'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm font-medium underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* League Header */}
      <div className={leagueSurfacePatterns.panelSection}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[color:var(--league-text)]">League Dashboard</h1>
            <p className="text-[color:var(--league-text-muted)]">
              League ID: {leagueId} • {members.length} teams • Real-time sync active
            </p>
          </div>

          {/* League switching could go here */}
          {onLeagueChange && (
            <button
              onClick={() => onLeagueChange('different-league')}
              className="text-sm font-medium text-[color:var(--league-accent)] hover:text-[color:var(--league-text)]"
            >
              Switch League
            </button>
          )}
        </div>

        {/* Subscription Status Indicator */}
        <div className="mt-4 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-[color:var(--league-success)]"></div>
            <span className="text-[color:var(--league-text-muted)]">
              Subscriptions: Rosters, Members
              {isSubscribed('draft') && ', Draft'}
              {isSubscribed('trades') && ', Trades'}
              {isSubscribed('waivers') && ', Waivers'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-[color:var(--league-border)]">
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
                  ? 'border-[color:var(--league-accent)] text-[color:var(--league-accent)]'
                  : 'border-transparent text-[color:var(--league-text-muted)] hover:border-[color:var(--league-border)] hover:text-[color:var(--league-text)]'
              }`}
            >
              {tab.label}
              <span className="ml-2 rounded-full bg-[color:var(--league-surface-muted)] px-2 py-0.5 text-xs text-[color:var(--league-text-muted)]">
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
              <h2 className="text-lg font-medium text-[color:var(--league-text)]">Team Rosters</h2>

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
              <h2 className="text-lg font-medium text-[color:var(--league-text)]">Draft Board</h2>
              {loading.draft && (
                <div className="flex items-center gap-2 text-sm text-[color:var(--league-text-muted)]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--league-accent)] border-t-transparent"></div>
                  Loading draft picks...
                </div>
              )}
            </div>

            <div className={leagueSurfacePatterns.panelSection}>
              {draftPicks.length === 0 ? (
                <p className="py-8 text-center text-[color:var(--league-text-muted)]">
                  No draft picks available
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {draftPicks.slice(0, 12).map((pick) => (
                    <div key={pick.id} className={leagueSurfacePatterns.subpanel}>
                      <div className="text-sm font-medium text-[color:var(--league-text)]">
                        Round {pick.round}, Pick {pick.pick}
                      </div>
                      <div className="text-xs text-[color:var(--league-text-muted)]">
                        Team: {getTeamOwner(pick.teamId)?.teamName || 'Unknown'}
                      </div>
                      {pick.playerId ? (
                        <div className="mt-1 text-sm text-[color:var(--league-success)]">
                          Player {pick.playerId.slice(-4)} selected
                        </div>
                      ) : (
                        <div className="mt-1 text-sm text-[color:var(--league-warning)]">
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
              <h2 className="text-lg font-medium text-[color:var(--league-text)]">
                Trade Activity
              </h2>
              {loading.trades && (
                <div className="flex items-center gap-2 text-sm text-[color:var(--league-text-muted)]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--league-accent)] border-t-transparent"></div>
                  Loading trades...
                </div>
              )}
            </div>

            <div className={leagueSurfacePatterns.panel}>
              {trades.length === 0 ? (
                <p className="py-8 text-center text-[color:var(--league-text-muted)]">
                  No trades in this league
                </p>
              ) : (
                <div className={leagueSurfacePatterns.dividedList}>
                  {getUserTrades(userId).map((trade) => (
                    <div key={trade.id} className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium text-[color:var(--league-text)]">
                            Trade with{' '}
                            {trade.fromUserId === userId ? trade.toUserId : trade.fromUserId}
                          </h3>
                          <p className="text-sm text-[color:var(--league-text-muted)]">
                            Status: {trade.status} • {trade.createdAt.toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`${dashboardStatusBadgeClass} ${getDashboardStatusTone(
                            trade.status
                          )}`}
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
              <h2 className="text-lg font-medium text-[color:var(--league-text)]">Waiver Claims</h2>
              {loading.waivers && (
                <div className="flex items-center gap-2 text-sm text-[color:var(--league-text-muted)]">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--league-accent)] border-t-transparent"></div>
                  Loading waivers...
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* User's Waiver Claims */}
              <div className={leagueSurfacePatterns.panelSection}>
                <h3 className="mb-4 font-medium text-[color:var(--league-text)]">
                  My Waiver Claims
                </h3>
                {getUserWaivers(userId).length === 0 ? (
                  <p className="text-[color:var(--league-text-muted)]">No active waiver claims</p>
                ) : (
                  <div className="space-y-3">
                    {getUserWaivers(userId).map((claim) => (
                      <div
                        key={claim.id}
                        className={`${leagueSurfacePatterns.subpanelCompact} flex items-center justify-between`}
                      >
                        <div>
                          <div className="font-medium text-sm">
                            Player {claim.playerId.slice(-4)}
                          </div>
                          {claim.dropPlayerId && (
                            <div className="text-xs text-[color:var(--league-text-muted)]">
                              Drop: Player {claim.dropPlayerId.slice(-4)}
                            </div>
                          )}
                        </div>
                        <span
                          className={`${dashboardStatusBadgeClass} ${getDashboardStatusTone(
                            claim.status
                          )}`}
                        >
                          {claim.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Waiver Claim Form */}
                <div className="mt-4 border-t border-[color:var(--league-border)] pt-4">
                  <button
                    onClick={() => handleWaiverClaim('sample-player-id')}
                    className="w-full rounded-md bg-[color:var(--league-accent)] px-4 py-2 text-sm text-white hover:bg-[color:var(--league-primary)]"
                  >
                    Submit Test Waiver Claim
                  </button>
                </div>
              </div>

              {/* All League Waivers */}
              <div className={leagueSurfacePatterns.panelSection}>
                <h3 className="mb-4 font-medium text-[color:var(--league-text)]">
                  League Waiver Queue
                </h3>
                {waiverClaims.length === 0 ? (
                  <p className="text-[color:var(--league-text-muted)]">No waiver claims in queue</p>
                ) : (
                  <div className="space-y-2">
                    {waiverClaims.slice(0, 10).map((claim) => (
                      <div key={claim.id} className="flex items-center justify-between text-sm">
                        <span>{getTeamOwner(claim.teamId)?.teamName || 'Unknown Team'}</span>
                        <span>Player {claim.playerId.slice(-4)}</span>
                        <span className="text-[color:var(--league-text-muted)]">
                          Priority {claim.priority}
                        </span>
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
      <div className={leagueSurfacePatterns.panelSection}>
        <h3 className="mb-4 font-medium text-[color:var(--league-text)]">Recent Activity</h3>
        <p className="text-sm text-[color:var(--league-text-muted)]">Activity feed coming soon.</p>
      </div>
    </div>
  );
}

// Sub-components
function RosterDisplay({ roster, owner, isUserTeam, onUpdateRoster }: RosterDisplayProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className={`${leagueSurfacePatterns.panelSection} ${
        isUserTeam ? 'ring-2 ring-[color:var(--league-accent)]' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium text-[color:var(--league-text)]">{roster.teamName}</h3>
          <p className="text-sm text-[color:var(--league-text-muted)]">
            Owner: {owner?.teamName || 'Unknown'} {isUserTeam && '(You)'}
          </p>
        </div>

        {isUserTeam && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="text-sm font-medium text-[color:var(--league-accent)] hover:text-[color:var(--league-text)]"
          >
            {isEditing ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-medium text-[color:var(--league-text)]">
            Starting Lineup ({roster.playerIds.length})
          </h4>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {roster.playerIds.slice(0, 8).map((playerId, _index) => (
              <div
                key={playerId}
                className="rounded bg-[color:var(--league-surface-muted)] p-2 text-sm text-[color:var(--league-text-muted)]"
              >
                Player {playerId.slice(-4)}
              </div>
            ))}
          </div>
        </div>

        {roster.bench.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-[color:var(--league-text)]">
              Bench ({roster.bench.length})
            </h4>
            <div className="flex flex-wrap gap-2 mt-2">
              {roster.bench.map((playerId) => (
                <span
                  key={playerId}
                  className="rounded bg-[color:var(--league-surface-muted)] px-2 py-1 text-xs text-[color:var(--league-text-muted)]"
                >
                  Player {playerId.slice(-4)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {isEditing && onUpdateRoster && (
        <div className="mt-4 border-t border-[color:var(--league-border)] pt-4">
          <button
            onClick={() => {
              onUpdateRoster({ teamName: `${roster.teamName} (Updated)` });
              setIsEditing(false);
            }}
            className="rounded-md bg-[color:var(--league-accent)] px-4 py-2 text-sm text-white hover:bg-[color:var(--league-primary)]"
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
    <div className={leagueSurfacePatterns.panelSection}>
      <h3 className="mb-4 font-medium text-[color:var(--league-text)]">League Members</h3>

      <div className="space-y-3">
        {members.map((member) => (
          <div key={member.id} className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">
                {member.teamName} {member.userId === currentUserId && '(You)'}
              </div>
              <div className="text-xs text-[color:var(--league-text-muted)]">
                {member.role} • Joined {member.joinedAt.toLocaleDateString()}
              </div>
            </div>

            <span
              className={`${dashboardStatusBadgeClass} ${getDashboardStatusTone(member.status)}`}
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
