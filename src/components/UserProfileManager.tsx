/**
 * User Profile Management Component
 * React component for managing user profiles and league memberships
 */

'use client';

import React, { useState, useMemo } from 'react';
import { useUserProfile } from '@/hooks/useUserProfile';
import type { 
  LeagueSpecificSettings, 
  UserProfile, 
  LeagueMembership, 
  UserWatchlist 
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

interface WatchlistManagementProps {
  watchlists: UserWatchlist[];
  leagues: LeagueMembership[];
  onUpdateWatchlist: (params: {
    leagueId?: string;
    watchlistId?: string;
    name: string;
    playerIds: string[];
    isDefault?: boolean;
  }) => void;
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
    updateWatchlist,
    leaveLeague,
    filterLeagues,
  } = useUserProfile(userId);

  const [selectedTab, setSelectedTab] = useState<'profile' | 'leagues' | 'watchlists'>('profile');
  const [editingLeague, setEditingLeague] = useState<string | null>(null);

  // Filter leagues by status
  const activeLeagues = useMemo(() => 
    filterLeagues({ status: ['ACTIVE'] }), [filterLeagues]
  );

  const pendingInvites = useMemo(() => 
    filterLeagues({ status: ['INVITED'] }), [filterLeagues]
  );

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

  const handleUpdateLeagueSettings = async (leagueId: string, settings: Partial<LeagueSpecificSettings>) => {
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
            { id: 'watchlists', label: 'Watchlists', count: watchlists.length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as 'profile' | 'leagues' | 'watchlists')}
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
          <ProfileSettings 
            profile={profile} 
            onUpdate={handleUpdateProfile}
            updating={updating}
          />
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

        {selectedTab === 'watchlists' && (
          <WatchlistManagement
            watchlists={watchlists}
            leagues={activeLeagues}
            onUpdateWatchlist={updateWatchlist}
            updating={updating}
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
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">Display Name</label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label htmlFor="timezone" className="block text-sm font-medium text-gray-700">Timezone</label>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="Australia/Sydney">Sydney</option>
            <option value="Australia/Melbourne">Melbourne</option>
            <option value="Australia/Brisbane">Brisbane</option>
            <option value="Australia/Perth">Perth</option>
            <option value="Australia/Adelaide">Adelaide</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={updating}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {updating ? 'Updating...' : 'Update Profile'}
        </button>
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
  updating 
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
                      onSave={(settings: Partial<LeagueSpecificSettings>) => onUpdateSettings(league.leagueId, settings)}
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

function WatchlistManagement({ watchlists, leagues, onUpdateWatchlist, updating }: WatchlistManagementProps) {
  const [_editingWatchlist, setEditingWatchlist] = useState<string | null>(null);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [selectedLeague, setSelectedLeague] = useState<string>('');

  const handleCreateWatchlist = async () => {
    if (!newWatchlistName.trim()) return;

    try {
      await onUpdateWatchlist({
        name: newWatchlistName,
        leagueId: selectedLeague || undefined,
        playerIds: [],
      });
      setNewWatchlistName('');
      setSelectedLeague('');
    } catch (err) {
      console.error('Failed to create watchlist:', err);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Watchlists</h2>
      
      {/* Create New Watchlist */}
      <div className="border-b border-gray-200 pb-4 mb-4">
        <div className="flex space-x-3">
          <input
            type="text"
            placeholder="Watchlist name"
            value={newWatchlistName}
            onChange={(e) => setNewWatchlistName(e.target.value)}
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
          <select
            value={selectedLeague}
            onChange={(e) => setSelectedLeague(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Global Watchlist</option>
            {leagues.map((league: LeagueMembership) => (
              <option key={league.leagueId} value={league.leagueId}>
                {league.league.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleCreateWatchlist}
            disabled={!newWatchlistName.trim() || updating}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>

      {/* Existing Watchlists */}
      {watchlists.length === 0 ? (
        <p className="text-gray-500">No watchlists created yet.</p>
      ) : (
        <div className="space-y-3">
          {watchlists.map((watchlist: UserWatchlist) => (
            <div key={watchlist.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-900">{watchlist.name}</h4>
                  <p className="text-sm text-gray-600">
                    {watchlist.leagueId ? `League specific` : 'Global'} • {watchlist.playerIds.length} players
                  </p>
                </div>
                <button
                  onClick={() => setEditingWatchlist(watchlist.id)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeagueSettingsForm({ league, onSave, onCancel, updating }: LeagueSettingsFormProps) {
  const [format, setFormat] = useState(league.leagueSettings.format);
  const [autopickEnabled, setAutopickEnabled] = useState(league.leagueSettings.waiverSettings.system === 'FAAB');

  const handleSave = () => {
    onSave({
      format,
      waiverSettings: {
        ...league.leagueSettings.waiverSettings,
        system: autopickEnabled ? 'FAAB' : 'ROLLING',
      },
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="leagueFormat" className="block text-sm font-medium text-gray-700">League Format</label>
        <select
          id="leagueFormat"
          value={format}
          onChange={(e) => setFormat(e.target.value as 'CLASSIC' | 'DRAFT' | 'KEEPER' | 'DYNASTY')}
          className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="CLASSIC">Classic</option>
          <option value="DRAFT">Draft</option>
          <option value="KEEPER">Keeper</option>
          <option value="DYNASTY">Dynasty</option>
        </select>
      </div>

      <div className="flex items-center">
        <input
          id="autopickEnabled"
          type="checkbox"
          checked={autopickEnabled}
          onChange={(e) => setAutopickEnabled(e.target.checked)}
          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <label htmlFor="autopickEnabled" className="ml-2 text-sm text-gray-700">Enable FAAB Waivers</label>
      </div>

      <div className="flex space-x-3">
        <button
          onClick={handleSave}
          disabled={updating}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {updating ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default UserProfileManager;
