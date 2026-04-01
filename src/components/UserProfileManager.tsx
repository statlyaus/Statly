/**
 * User Profile Management Component
 * React component for managing user profiles and league memberships
 */

'use client';

import React, { useState, useMemo } from 'react';

import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { LeagueDashboard } from '@/components/LeagueDashboard';
import { WaiverManager } from '@/components/WaiverManager';
import { WatchlistManager } from '@/components/WatchlistManager';
import { UIInput, UISelect, UISwitch } from '@/components/ui';
import { useUserProfile } from '@/hooks/useUserProfile';
import type {
  LeagueSpecificSettings,
  UserProfile,
  LeagueMembership,
} from '@/services/userProfileService';

interface UserProfileManagerProps {
  userId: string;
  onProfileUpdate?: () => void;
}

interface ProfileSettingsProps {
  profile: UserProfile;
  onUpdate: (updates: Partial<UserProfile>) => void;
  updating: boolean;
}

interface LeagueManagementProps {
  activeLeagues: LeagueMembership[];
  pendingInvites: LeagueMembership[];
  onUpdateSettings: (leagueId: string, settings: Partial<LeagueSpecificSettings>) => void;
  onLeaveLeague: (leagueId: string) => void;
  editingLeague: string | null;
  setEditingLeague: (leagueId: string | null) => void;
  updating: boolean;
}

interface LeagueSettingsFormProps {
  league: LeagueMembership;
  onSave: (settings: Partial<LeagueSpecificSettings>) => void;
  onCancel: () => void;
  updating: boolean;
}

export function UserProfileManager({ userId, onProfileUpdate }: UserProfileManagerProps) {
  const {
    profile,
    watchlists,
    loading,
    updating,
    error,
    updateProfile,
    updateLeagueSettings,
    leaveLeague,
    filterLeagues,
  } = useUserProfile(userId);

  const [selectedTab, setSelectedTab] = useState<
    'profile' | 'leagues' | 'dashboard' | 'waivers' | 'watchlists'
  >('profile');
  const [editingLeague, setEditingLeague] = useState<string | null>(null);
  const [selectedLeagueForWaivers, setSelectedLeagueForWaivers] = useState<string | null>(null);

  // Filter leagues by status
  const activeLeagues = useMemo(() => filterLeagues({ status: ['ACTIVE'] }), [filterLeagues]);

  const pendingInvites = useMemo(() => filterLeagues({ status: ['INVITED'] }), [filterLeagues]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading profile...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error Loading Profile</h3>
        <p className="text-red-600 text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <h3 className="text-gray-800 font-medium">Profile Not Found</h3>
        <p className="text-gray-600 text-sm mt-1">User profile could not be loaded.</p>
      </div>
    );
  }

  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    try {
      await updateProfile(updates);
      onProfileUpdate?.();
    } catch (err) {
      console.error('Failed to update profile:', err);
    }
  };

  // Remove unused handleJoinLeague function since it's not used in the interface

  const handleUpdateLeagueSettings = async (
    leagueId: string,
    settings: Partial<LeagueSpecificSettings>
  ) => {
    try {
      await updateLeagueSettings(leagueId, settings);
      setEditingLeague(null);
      onProfileUpdate?.();
    } catch (err) {
      console.error('Failed to update league settings:', err);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center space-x-4">
          {profile.avatar && (
            <img
              src={profile.avatar}
              alt={profile.displayName}
              className="w-16 h-16 rounded-full object-cover"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{profile.displayName}</h1>
            <p className="text-gray-600">{profile.email}</p>
            <p className="text-sm text-gray-500">
              Member since {new Date(profile.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'profile', label: 'Profile', count: null },
            { id: 'leagues', label: 'Leagues', count: activeLeagues.length },
            { id: 'dashboard', label: 'Dashboard', count: null },
            { id: 'waivers', label: 'Waivers', count: null },
            { id: 'watchlists', label: 'Watchlists', count: watchlists.length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() =>
                setSelectedTab(
                  tab.id as 'profile' | 'leagues' | 'dashboard' | 'waivers' | 'watchlists'
                )
              }
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
              {tab.count !== null && (
                <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="space-y-6">
        {selectedTab === 'profile' && (
          <ProfileSettings profile={profile} onUpdate={handleUpdateProfile} updating={updating} />
        )}

        {selectedTab === 'leagues' && (
          <LeagueManagement
            activeLeagues={activeLeagues}
            pendingInvites={pendingInvites}
            onUpdateSettings={handleUpdateLeagueSettings}
            onLeaveLeague={leaveLeague}
            editingLeague={editingLeague}
            setEditingLeague={setEditingLeague}
            updating={updating}
          />
        )}

        {selectedTab === 'dashboard' && (
          <div className="space-y-4">
            {activeLeagues.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <h3 className="text-gray-800 font-medium">No Active Leagues</h3>
                <p className="text-gray-600 text-sm mt-1">Join a league to view the dashboard.</p>
              </div>
            ) : (
              <>
                {/* League Selection for Dashboard */}
                <div className="bg-white shadow rounded-lg p-6">
                  <h2 className="text-lg font-medium text-gray-900 mb-4">
                    Select League Dashboard
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeLeagues.map((league) => (
                      <button
                        key={league.leagueId}
                        onClick={() => setSelectedLeagueForWaivers(league.leagueId)}
                        className={`p-4 rounded-lg border-2 text-left transition-colors ${
                          selectedLeagueForWaivers === league.leagueId
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <h3 className="font-medium text-gray-900">{league.league.name}</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {league.leagueSettings.format} • {league.role}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Real-time league data & sync</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* League Dashboard for Selected League */}
                {selectedLeagueForWaivers && (
                  <LeagueDashboard
                    leagueId={selectedLeagueForWaivers}
                    userId={userId}
                    onLeagueChange={(newLeagueId) => setSelectedLeagueForWaivers(newLeagueId)}
                  />
                )}
              </>
            )}
          </div>
        )}

        {selectedTab === 'waivers' && (
          <div className="space-y-4">
            {activeLeagues.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <h3 className="text-gray-800 font-medium">No Active Leagues</h3>
                <p className="text-gray-600 text-sm mt-1">Join a league to manage waivers.</p>
              </div>
            ) : (
              <>
                {/* League Selection for Waivers */}
                <div className="bg-white shadow rounded-lg p-6">
                  <h2 className="text-lg font-medium text-gray-900 mb-4">
                    Select League for Waiver Management
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeLeagues.map((league) => (
                      <button
                        key={league.leagueId}
                        onClick={() => setSelectedLeagueForWaivers(league.leagueId)}
                        className={`p-4 rounded-lg border-2 text-left transition-colors ${
                          selectedLeagueForWaivers === league.leagueId
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <h3 className="font-medium text-gray-900">{league.league.name}</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {league.leagueSettings.format} • {league.role}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Waiver System: {league.leagueSettings.waiverRules.system}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Waiver Manager for Selected League */}
                {selectedLeagueForWaivers && (
                  <WaiverManager
                    leagueId={selectedLeagueForWaivers}
                    userId={userId}
                    isCommissioner={
                      activeLeagues.find((l) => l.leagueId === selectedLeagueForWaivers)?.role ===
                      'COMMISSIONER'
                    }
                    systemType={(() => {
                      const sys = activeLeagues.find((l) => l.leagueId === selectedLeagueForWaivers)
                        ?.leagueSettings.waiverRules.system;
                      // Map legacy/alternative naming to component-accepted types
                      if (sys === 'PRIORITY_LIST') return 'ROLLING_LIST';
                      return (sys as 'ROLLING_LIST' | 'FAAB' | 'FREE_AGENCY') ?? 'ROLLING_LIST';
                    })()}
                  />
                )}
              </>
            )}
          </div>
        )}

        {selectedTab === 'watchlists' && (
          <WatchlistManager
            userId={userId}
            selectedLeagueId={selectedLeagueForWaivers || undefined}
            leagues={activeLeagues}
          />
        )}
      </div>
    </div>
  );
}

// Sub-components
function ProfileSettings({ profile, onUpdate, updating }: ProfileSettingsProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [timezone, setTimezone] = useState(profile.timezone);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      displayName,
      timezone,
    });
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Profile Settings</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Display Name">
          <UIInput
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </FormField>

        <FormField label="Timezone">
          <UISelect id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="Australia/Sydney">Sydney</option>
            <option value="Australia/Melbourne">Melbourne</option>
            <option value="Australia/Brisbane">Brisbane</option>
            <option value="Australia/Perth">Perth</option>
            <option value="Australia/Adelaide">Adelaide</option>
          </UISelect>
        </FormField>

        <Button type="submit" disabled={updating} loading={updating}>
          {updating ? 'Updating...' : 'Update Profile'}
        </Button>
      </form>
    </div>
  );
}

function LeagueManagement({
  activeLeagues,
  pendingInvites,
  onUpdateSettings,
  onLeaveLeague,
  editingLeague,
  setEditingLeague,
  updating,
}: LeagueManagementProps) {
  return (
    <div className="space-y-6">
      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="text-yellow-800 font-medium mb-2">Pending League Invites</h3>
          <div className="space-y-2">
            {pendingInvites.map((league: LeagueMembership) => (
              <div key={league.id} className="flex items-center justify-between">
                <span className="text-yellow-700">{league.league.name}</span>
                <div className="space-x-2">
                  <button className="text-green-600 hover:text-green-800 text-sm font-medium">
                    Accept
                  </button>
                  <button className="text-red-600 hover:text-red-800 text-sm font-medium">
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Leagues */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Active Leagues</h2>

        {activeLeagues.length === 0 ? (
          <p className="text-gray-500">No active leagues found.</p>
        ) : (
          <div className="space-y-4">
            {activeLeagues.map((league: LeagueMembership) => (
              <div key={league.leagueId} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">{league.league.name}</h3>
                    <p className="text-sm text-gray-600">
                      {league.leagueSettings.format} • {league.role}
                    </p>
                  </div>
                  <div className="space-x-2">
                    <button
                      onClick={() => setEditingLeague(league.leagueId)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Settings
                    </button>
                    <button
                      onClick={() => onLeaveLeague(league.leagueId)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Leave
                    </button>
                  </div>
                </div>

                {editingLeague === league.leagueId && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <LeagueSettingsForm
                      league={league}
                      onSave={(settings: Partial<LeagueSpecificSettings>) =>
                        onUpdateSettings(league.leagueId, settings)
                      }
                      onCancel={() => setEditingLeague(null)}
                      updating={updating}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LeagueSettingsForm({ league, onSave, onCancel, updating }: LeagueSettingsFormProps) {
  const [format, setFormat] = useState(league.leagueSettings.format);
  const [rosterSettings, setRosterSettings] = useState(league.leagueSettings.rosterSettings);
  const [draftSettings, setDraftSettings] = useState(league.leagueSettings.draftSettings);
  const [scoringFormat, setScoringFormat] = useState(league.leagueSettings.scoringFormat);
  const [waiverRules, setWaiverRules] = useState(league.leagueSettings.waiverRules);
  const [activeTab, setActiveTab] = useState<'basic' | 'roster' | 'draft' | 'scoring' | 'waivers'>(
    'basic'
  );

  const handleSave = () => {
    onSave({
      format,
      rosterSettings,
      draftSettings,
      scoringFormat,
      waiverRules,
    });
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'basic', label: 'Basic Settings' },
            { id: 'roster', label: 'Roster Settings' },
            { id: 'draft', label: 'Draft Settings' },
            { id: 'scoring', label: 'Scoring Format' },
            { id: 'waivers', label: 'Waiver Rules' },
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
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {activeTab === 'basic' && (
          <div className="space-y-4">
            <FormField label="League Format">
              <UISelect
                id="leagueFormat"
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as 'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY')
                }
              >
                <option value="CLASSIC">Classic</option>
                <option value="DRAFT">Draft</option>
                <option value="KEEPER">Keeper</option>
                <option value="DYNASTY">Dynasty</option>
              </UISelect>
            </FormField>
          </div>
        )}

        {activeTab === 'roster' && (
          <div className="space-y-4">
            <div>
              <fieldset className="border border-gray-200 rounded-md p-4">
                <legend className="block text-sm font-medium text-gray-700 px-2">
                  Starting Lineup
                </legend>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <FormField label="Defenders" className="space-y-1">
                      <UIInput
                        id="def-count"
                        type="number"
                        min="1"
                        max="15"
                        value={rosterSettings.startingLineup.DEF}
                        onChange={(e) =>
                          setRosterSettings({
                            ...rosterSettings,
                            startingLineup: {
                              ...rosterSettings.startingLineup,
                              DEF: parseInt(e.target.value),
                            },
                          })
                        }
                        className="text-sm"
                      />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="Midfielders" className="space-y-1">
                      <UIInput
                        id="mid-count"
                        type="number"
                        min="1"
                        max="15"
                        value={rosterSettings.startingLineup.MID}
                        onChange={(e) =>
                          setRosterSettings({
                            ...rosterSettings,
                            startingLineup: {
                              ...rosterSettings.startingLineup,
                              MID: parseInt(e.target.value),
                            },
                          })
                        }
                        className="text-sm"
                      />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="Forwards" className="space-y-1">
                      <UIInput
                        id="fwd-count"
                        type="number"
                        min="1"
                        max="15"
                        value={rosterSettings.startingLineup.FWD}
                        onChange={(e) =>
                          setRosterSettings({
                            ...rosterSettings,
                            startingLineup: {
                              ...rosterSettings.startingLineup,
                              FWD: parseInt(e.target.value),
                            },
                          })
                        }
                        className="text-sm"
                      />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="Rucks" className="space-y-1">
                      <UIInput
                        id="ruck-count"
                        type="number"
                        min="1"
                        max="4"
                        value={rosterSettings.startingLineup.RUCK}
                        onChange={(e) =>
                          setRosterSettings({
                            ...rosterSettings,
                            startingLineup: {
                              ...rosterSettings.startingLineup,
                              RUCK: parseInt(e.target.value),
                            },
                          })
                        }
                        className="text-sm"
                      />
                    </FormField>
                  </div>
                </div>
              </fieldset>
            </div>
            <FormField label="Total Roster Size">
              <UIInput
                id="roster-size"
                type="number"
                min="20"
                max="50"
                value={rosterSettings.totalRosterSize}
                onChange={(e) =>
                  setRosterSettings({
                    ...rosterSettings,
                    totalRosterSize: parseInt(e.target.value),
                  })
                }
                className="w-32"
              />
            </FormField>
          </div>
        )}

        {activeTab === 'draft' && (
          <div className="space-y-4">
            <FormField label="Draft Type">
              <UISelect
                id="draft-type"
                value={draftSettings.draftType}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    draftType: e.target.value as 'SNAKE' | 'LINEAR' | 'AUCTION',
                  })
                }
              >
                <option value="SNAKE">Snake Draft</option>
                <option value="LINEAR">Linear Draft</option>
                <option value="AUCTION">Auction Draft</option>
              </UISelect>
            </FormField>
            <FormField label="Pick Time Limit (seconds)">
              <UIInput
                id="pick-time-limit"
                type="number"
                min="30"
                max="300"
                value={draftSettings.pickTimeLimit}
                onChange={(e) =>
                  setDraftSettings({
                    ...draftSettings,
                    pickTimeLimit: parseInt(e.target.value),
                  })
                }
                className="w-32"
              />
            </FormField>
            <div className="flex items-center gap-3">
              <UISwitch
                checked={draftSettings.autodraftSettings.enabled}
                onCheckedChange={(checked) =>
                  setDraftSettings({
                    ...draftSettings,
                    autodraftSettings: {
                      ...draftSettings.autodraftSettings,
                      enabled: checked,
                    },
                  })
                }
                aria-labelledby="autodraftEnabled"
              />
              <label id="autodraftEnabled" className="text-sm text-gray-700">
                Enable Autodraft
              </label>
            </div>
          </div>
        )}

        {activeTab === 'scoring' && (
          <div className="space-y-4">
            <FormField label="Scoring System">
              <UISelect
                id="scoring-system"
                value={scoringFormat.systemType}
                onChange={(e) =>
                  setScoringFormat({
                    ...scoringFormat,
                    systemType: e.target.value as 'H2H_POINTS' | 'H2H_CATEGORIES' | 'ROTISSERIE',
                  })
                }
              >
                <option value="H2H_POINTS">Head-to-Head Points</option>
                <option value="H2H_CATEGORIES">Head-to-Head Categories</option>
                <option value="ROTISSERIE">Rotisserie</option>
              </UISelect>
            </FormField>
            <div>
              <fieldset className="border border-gray-200 rounded-md p-4">
                <legend className="block text-sm font-medium text-gray-700 px-2">
                  Point Values
                </legend>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <label htmlFor="kicks-points" className="block text-xs text-gray-600">
                      Kicks
                    </label>
                    <UIInput
                      id="kicks-points"
                      type="number"
                      step="0.1"
                      value={scoringFormat.pointsSystem?.baseScoring.kicks ?? 3}
                      onChange={(e) =>
                        setScoringFormat({
                          ...scoringFormat,
                          pointsSystem: {
                            ...scoringFormat.pointsSystem,
                            baseScoring: {
                              ...scoringFormat.pointsSystem?.baseScoring,
                              kicks: parseFloat(e.target.value),
                            },
                            bonusRules: scoringFormat.pointsSystem?.bonusRules ?? [],
                            penaltyRules: scoringFormat.pointsSystem?.penaltyRules ?? [],
                            captainMultiplier: scoringFormat.pointsSystem?.captainMultiplier ?? 2,
                            viceCaptainMultiplier:
                              scoringFormat.pointsSystem?.viceCaptainMultiplier ?? 1.5,
                            emergencyScoring: scoringFormat.pointsSystem?.emergencyScoring ?? true,
                          },
                        })
                      }
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <label htmlFor="handballs-points" className="block text-xs text-gray-600">
                      Handballs
                    </label>
                    <UIInput
                      id="handballs-points"
                      type="number"
                      step="0.1"
                      value={scoringFormat.pointsSystem?.baseScoring.handballs ?? 2}
                      onChange={(e) =>
                        setScoringFormat({
                          ...scoringFormat,
                          pointsSystem: {
                            ...scoringFormat.pointsSystem,
                            baseScoring: {
                              ...scoringFormat.pointsSystem?.baseScoring,
                              handballs: parseFloat(e.target.value),
                            },
                            bonusRules: scoringFormat.pointsSystem?.bonusRules ?? [],
                            penaltyRules: scoringFormat.pointsSystem?.penaltyRules ?? [],
                            captainMultiplier: scoringFormat.pointsSystem?.captainMultiplier ?? 2,
                            viceCaptainMultiplier:
                              scoringFormat.pointsSystem?.viceCaptainMultiplier ?? 1.5,
                            emergencyScoring: scoringFormat.pointsSystem?.emergencyScoring ?? true,
                          },
                        })
                      }
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <label htmlFor="goals-points" className="block text-xs text-gray-600">
                      Goals
                    </label>
                    <UIInput
                      id="goals-points"
                      type="number"
                      step="0.1"
                      value={scoringFormat.pointsSystem?.baseScoring.goals ?? 6}
                      onChange={(e) =>
                        setScoringFormat({
                          ...scoringFormat,
                          pointsSystem: {
                            ...scoringFormat.pointsSystem,
                            baseScoring: {
                              ...scoringFormat.pointsSystem?.baseScoring,
                              goals: parseFloat(e.target.value),
                            },
                            bonusRules: scoringFormat.pointsSystem?.bonusRules ?? [],
                            penaltyRules: scoringFormat.pointsSystem?.penaltyRules ?? [],
                            captainMultiplier: scoringFormat.pointsSystem?.captainMultiplier ?? 2,
                            viceCaptainMultiplier:
                              scoringFormat.pointsSystem?.viceCaptainMultiplier ?? 1.5,
                            emergencyScoring: scoringFormat.pointsSystem?.emergencyScoring ?? true,
                          },
                        })
                      }
                      className="mt-1 h-9"
                    />
                  </div>
                  <div>
                    <label htmlFor="tackles-points" className="block text-xs text-gray-600">
                      Tackles
                    </label>
                    <UIInput
                      id="tackles-points"
                      type="number"
                      step="0.1"
                      value={scoringFormat.pointsSystem?.baseScoring.tackles ?? 4}
                      onChange={(e) =>
                        setScoringFormat({
                          ...scoringFormat,
                          pointsSystem: {
                            ...scoringFormat.pointsSystem,
                            baseScoring: {
                              ...scoringFormat.pointsSystem?.baseScoring,
                              tackles: parseFloat(e.target.value),
                            },
                            bonusRules: scoringFormat.pointsSystem?.bonusRules ?? [],
                            penaltyRules: scoringFormat.pointsSystem?.penaltyRules ?? [],
                            captainMultiplier: scoringFormat.pointsSystem?.captainMultiplier ?? 2,
                            viceCaptainMultiplier:
                              scoringFormat.pointsSystem?.viceCaptainMultiplier ?? 1.5,
                            emergencyScoring: scoringFormat.pointsSystem?.emergencyScoring ?? true,
                          },
                        })
                      }
                      className="mt-1 h-9"
                    />
                  </div>
                </div>
              </fieldset>
            </div>
          </div>
        )}

        {activeTab === 'waivers' && (
          <div className="space-y-4">
            <FormField label="Waiver System">
              <UISelect
                id="waiver-system"
                value={waiverRules.system}
                onChange={(e) =>
                  setWaiverRules({
                    ...waiverRules,
                    system: e.target.value as 'ROLLING_LIST' | 'FAAB' | 'FREE_AGENCY',
                  })
                }
              >
                <option value="ROLLING_LIST">Rolling List</option>
                <option value="FAAB">Free Agent Acquisition Budget (FAAB)</option>
                <option value="FREE_AGENCY">Free Agency</option>
              </UISelect>
            </FormField>
            <FormField label="Process Time">
              <UISelect
                id="process-time"
                value={waiverRules.processTime}
                onChange={(e) =>
                  setWaiverRules({
                    ...waiverRules,
                    processTime: e.target.value as
                      | 'DAILY'
                      | 'TWICE_WEEKLY'
                      | 'WEEKLY'
                      | 'CONTINUOUS',
                  })
                }
              >
                <option value="DAILY">Daily</option>
                <option value="TWICE_WEEKLY">Twice Weekly</option>
                <option value="WEEKLY">Weekly</option>
                <option value="CONTINUOUS">Continuous</option>
              </UISelect>
            </FormField>
            <FormField label="Waiver Period (hours)">
              <UIInput
                id="waiver-period"
                type="number"
                min="0"
                max="168"
                value={waiverRules.waiverPeriod}
                onChange={(e) =>
                  setWaiverRules({
                    ...waiverRules,
                    waiverPeriod: parseInt(e.target.value),
                  })
                }
                className="w-32"
              />
            </FormField>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-3 pt-4 border-t border-gray-200">
        <Button onClick={handleSave} disabled={updating} loading={updating}>
          {updating ? 'Saving...' : 'Save Settings'}
        </Button>
        <Button onClick={onCancel} variant="secondary">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default UserProfileManager;
