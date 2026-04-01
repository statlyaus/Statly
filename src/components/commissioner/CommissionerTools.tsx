'use client';

import React, { useState } from 'react';

import {
  CogIcon,
  UserGroupIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  EnvelopeIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import { motion, AnimatePresence } from 'framer-motion';

import Button from '@/components/Button';
import FormField from '@/components/FormField';
import { UIInput, UISelect } from '@/components/ui';
import type { League } from '@/types/leagues';

// Types
interface LeagueSettings {
  scoring: {
    disposal: number;
    kick: number;
    handball: number;
    mark: number;
    tackle: number;
    goal: number;
    behind: number;
    hitout: number;
    freeFor: number;
    freeAgainst: number;
  };
  roster: {
    totalPlayers: number;
    forwards: number;
    midfielders: number;
    defenders: number;
    rucks: number;
    bench: number;
    emergencies: number;
  };
  waivers: {
    enabled: boolean;
    processingDay: string;
    processingTime: string;
    fAABBudget: number;
    minimumBid: number;
  };
  playoffs: {
    enabled: boolean;
    teams: number;
    startWeek: number;
    format: 'single' | 'double';
  };
  trades: {
    enabled: boolean;
    deadline: string;
    reviewPeriod: number; // hours
    vetoVotes: number;
  };
}

interface Member {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  status: 'active' | 'inactive' | 'pending';
  role: 'owner' | 'manager' | 'viewer';
  joinedAt: Date;
  lastActive: Date;
  teamName: string;
}

interface Invitation {
  id: string;
  email: string;
  sentAt: Date;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
}

interface CommissionerToolsProps {
  league?: League;
  leagueSettings?: LeagueSettings;
  members?: Member[];
  invitations?: Invitation[];
  onUpdateSettings?: (settings: Partial<LeagueSettings>) => void;
  onInviteMember?: (email: string) => void;
  onRemoveMember?: (memberId: string) => void;
  onUpdateMemberRole?: (memberId: string, role: string) => void;
  isCommissioner?: boolean;
}

// Mock data
const mockSettings: LeagueSettings = {
  scoring: {
    disposal: 1,
    kick: 3,
    handball: 2,
    mark: 3,
    tackle: 4,
    goal: 6,
    behind: 1,
    hitout: 1,
    freeFor: 1,
    freeAgainst: -1,
  },
  roster: {
    totalPlayers: 30,
    forwards: 8,
    midfielders: 10,
    defenders: 8,
    rucks: 4,
    bench: 6,
    emergencies: 4,
  },
  waivers: {
    enabled: true,
    processingDay: 'Wednesday',
    processingTime: '09:00',
    fAABBudget: 100,
    minimumBid: 1,
  },
  playoffs: {
    enabled: true,
    teams: 8,
    startWeek: 20,
    format: 'single',
  },
  trades: {
    enabled: true,
    deadline: '2025-08-15',
    reviewPeriod: 48,
    vetoVotes: 4,
  },
};

const mockMembers: Member[] = [
  {
    id: '1',
    name: 'John Smith',
    email: 'john@example.com',
    status: 'active',
    role: 'owner',
    joinedAt: new Date('2025-01-15'),
    lastActive: new Date(),
    teamName: 'The Bulldogs',
  },
  {
    id: '2',
    name: 'Sarah Wilson',
    email: 'sarah@example.com',
    status: 'active',
    role: 'manager',
    joinedAt: new Date('2025-01-16'),
    lastActive: new Date('2025-08-13'),
    teamName: 'Eagles Soaring',
  },
  {
    id: '3',
    name: 'Mike Johnson',
    email: 'mike@example.com',
    status: 'inactive',
    role: 'manager',
    joinedAt: new Date('2025-02-01'),
    lastActive: new Date('2025-07-15'),
    teamName: 'Tiger Power',
  },
];

export default function CommissionerTools({
  league,
  leagueSettings = mockSettings,
  members = mockMembers,
  invitations = [],
  onUpdateSettings,
  onInviteMember,
  onRemoveMember,
  onUpdateMemberRole,
  isCommissioner = true,
}: CommissionerToolsProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'members' | 'invites' | 'advanced'>(
    'settings'
  );
  const [settings, setSettings] = useState(leagueSettings);
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [showConfirmation, setShowConfirmation] = useState<string | null>(null);

  // Use actual league data if available
  const displayName = league?.name || 'League';
  // const displayMembers = league ? [] : members; // TODO: Fetch actual members
  const displayCategories = league?.categories || [];
  const leagueCode = league?.code || 'N/A';
  const maxTeams = league?.maxTeams || 12;
  const currentTeams = league?.currentTeams || 0;

  if (!isCommissioner) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <ShieldCheckIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Commissioner Access Required</h2>
          <p className="text-gray-600">You need commissioner permissions to access these tools.</p>
        </div>
      </div>
    );
  }

  const handleSettingsUpdate = (
    category: keyof LeagueSettings,
    updates: Record<string, unknown>
  ) => {
    const newSettings = {
      ...settings,
      [category]: { ...settings[category], ...updates },
    };
    setSettings(newSettings);
    onUpdateSettings?.(newSettings);
  };

  const handleInvite = () => {
    if (newInviteEmail) {
      onInviteMember?.(newInviteEmail);
      setNewInviteEmail('');
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-purple-100 text-purple-800';
      case 'manager':
        return 'bg-blue-100 text-blue-800';
      case 'viewer':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Commissioner Tools</h1>
          <p className="text-gray-600 mt-1">
            {league ? `Managing ${league.name}` : 'Manage league settings and members'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-purple-600" />
          <span className="text-sm font-medium text-purple-600">Commissioner Access</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        {[
          { id: 'settings', label: 'League Settings', icon: CogIcon },
          { id: 'members', label: 'Manage Members', icon: UserGroupIcon },
          { id: 'invites', label: 'Invitations', icon: EnvelopeIcon },
          { id: 'advanced', label: 'Advanced Tools', icon: ChartBarIcon },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* League Information */}
            {league && (
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">League Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <FormField label="League Name">
                      <UIInput id="league-name" type="text" value={displayName} readOnly />
                    </FormField>
                    <FormField label="League Code">
                      <UIInput
                        id="league-code"
                        type="text"
                        value={leagueCode}
                        className="bg-muted"
                        readOnly
                      />
                    </FormField>
                    <FormField label="League Type">
                      <UISelect
                        id="league-type"
                        value={league.type}
                        onChange={(e) => {
                          // TODO: Handle league type change
                          console.log('League type changed to:', e.target.value);
                        }}
                      >
                        <option value="public">Public</option>
                        <option value="private">Private</option>
                      </UISelect>
                    </FormField>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="draftDate"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Team Count
                      </label>
                      <div className="text-sm text-gray-600">
                        {currentTeams} / {maxTeams} teams filled
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${(currentTeams / maxTeams) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                    <FormField label="Draft Date">
                      <UIInput
                        id="draft-date"
                        type="datetime-local"
                        value={
                          league.draftDate
                            ? new Date(league.draftDate).toISOString().slice(0, 16)
                            : ''
                        }
                        onChange={(e) => {
                          // TODO: Handle draft date change
                          console.log('Draft date changed to:', e.target.value);
                        }}
                      />
                    </FormField>
                    <div>
                      <div className="block text-sm font-medium text-gray-700 mb-1">
                        Categories ({displayCategories.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {displayCategories.map((category) => (
                          <span
                            key={category}
                            className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Scoring Settings */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Scoring Settings</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {Object.entries(settings.scoring).map(([stat, value]) => (
                  <div key={stat}>
                    <FormField
                      label={stat.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      className="space-y-1"
                    >
                      <UIInput
                        type="number"
                        value={value}
                        onChange={(e) =>
                          handleSettingsUpdate('scoring', {
                            [stat]: parseFloat(e.target.value) || 0,
                          })
                        }
                        step="0.5"
                      />
                    </FormField>
                  </div>
                ))}
              </div>
            </div>

            {/* Roster Settings */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Roster Configuration</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {Object.entries(settings.roster).map(([position, count]) => (
                  <div key={position}>
                    <FormField
                      label={position.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      className="space-y-1"
                    >
                      <UIInput
                        type="number"
                        value={count}
                        onChange={(e) =>
                          handleSettingsUpdate('roster', {
                            [position]: parseInt(e.target.value) || 0,
                          })
                        }
                        min="0"
                      />
                    </FormField>
                  </div>
                ))}
              </div>
            </div>

            {/* Waivers & FAAB */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Waivers & FAAB</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="waivers-enabled"
                      checked={settings.waivers.enabled}
                      onChange={(e) =>
                        handleSettingsUpdate('waivers', { enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                    />
                    <label htmlFor="waivers-enabled" className="text-sm font-medium text-gray-700">
                      Enable Waivers System
                    </label>
                  </div>

                  <FormField label="Processing Day">
                    <UISelect
                      id="waiverProcessingDay"
                      value={settings.waivers.processingDay}
                      onChange={(e) =>
                        handleSettingsUpdate('waivers', { processingDay: e.target.value })
                      }
                    >
                      <option value="Wednesday">Wednesday</option>
                      <option value="Thursday">Thursday</option>
                      <option value="Friday">Friday</option>
                      <option value="Saturday">Saturday</option>
                      <option value="Sunday">Sunday</option>
                    </UISelect>
                  </FormField>
                </div>

                <div className="space-y-4">
                  <FormField label="FAAB Budget">
                    <UIInput
                      id="faabBudget"
                      type="number"
                      value={settings.waivers.fAABBudget}
                      onChange={(e) =>
                        handleSettingsUpdate('waivers', {
                          fAABBudget: parseInt(e.target.value) || 0,
                        })
                      }
                      min="0"
                    />
                  </FormField>

                  <FormField label="Minimum Bid">
                    <UIInput
                      id="minimumBid"
                      type="number"
                      value={settings.waivers.minimumBid}
                      onChange={(e) =>
                        handleSettingsUpdate('waivers', {
                          minimumBid: parseInt(e.target.value) || 0,
                        })
                      }
                      min="0"
                    />
                  </FormField>
                </div>
              </div>
            </div>

            {/* Playoffs */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Playoffs Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="playoffs-enabled"
                      checked={settings.playoffs.enabled}
                      onChange={(e) =>
                        handleSettingsUpdate('playoffs', { enabled: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                    />
                    <label htmlFor="playoffs-enabled" className="text-sm font-medium text-gray-700">
                      Enable Playoffs
                    </label>
                  </div>

                  <FormField label="Teams in Playoffs">
                    <UISelect
                      id="playoffTeams"
                      value={settings.playoffs.teams}
                      onChange={(e) =>
                        handleSettingsUpdate('playoffs', { teams: parseInt(e.target.value) })
                      }
                    >
                      <option value={4}>4 Teams</option>
                      <option value={6}>6 Teams</option>
                      <option value={8}>8 Teams</option>
                    </UISelect>
                  </FormField>
                </div>

                <div className="space-y-4">
                  <FormField label="Start Week">
                    <UIInput
                      id="playoffStartWeek"
                      type="number"
                      value={settings.playoffs.startWeek}
                      onChange={(e) =>
                        handleSettingsUpdate('playoffs', {
                          startWeek: parseInt(e.target.value) || 20,
                        })
                      }
                      min="1"
                      max="23"
                    />
                  </FormField>

                  <FormField label="Format">
                    <UISelect
                      id="playoffFormat"
                      value={settings.playoffs.format}
                      onChange={(e) =>
                        handleSettingsUpdate('playoffs', {
                          format: e.target.value as 'single' | 'double',
                        })
                      }
                    >
                      <option value="single">Single Elimination</option>
                      <option value="double">Double Elimination</option>
                    </UISelect>
                  </FormField>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'members' && (
          <motion.div
            key="members"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-xl shadow-lg overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">League Members</h3>
              <p className="text-sm text-gray-600">
                {league ? `${currentTeams} / ${maxTeams} members` : `${members.length} members`}
              </p>
              {league && (
                <div className="mt-2 text-sm text-gray-500">
                  League Code: <span className="font-mono">{leagueCode}</span>
                </div>
              )}
            </div>

            <div className="divide-y divide-gray-100">
              {league && members.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <UserGroupIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p className="mb-2">Member details loading...</p>
                  <p className="text-sm">
                    This league has {currentTeams} members, but detailed member information is being
                    loaded.
                  </p>
                </div>
              ) : members.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <UserGroupIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No members found</p>
                </div>
              ) : (
                members.map((member, index) => (
                  <motion.div
                    key={member.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-gray-600">
                            {member.name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')}
                          </span>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{member.name}</div>
                          <div className="text-sm text-gray-600">{member.teamName}</div>
                          <div className="text-xs text-gray-500">{member.email}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(member.role)}`}
                          >
                            {member.role}
                          </span>
                          <div className="text-xs text-gray-500 mt-1">
                            Last active: {member.lastActive.toLocaleDateString()}
                          </div>
                        </div>

                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(member.status)}`}
                        >
                          {member.status}
                        </span>

                        {member.role !== 'owner' && (
                          <div className="flex items-center gap-2">
                            <UISelect
                              value={member.role}
                              onChange={(e) => onUpdateMemberRole?.(member.id, e.target.value)}
                              className="h-9 min-w-32 text-sm"
                            >
                              <option value="manager">Manager</option>
                              <option value="viewer">Viewer</option>
                            </UISelect>

                            <Button
                              onClick={() => setShowConfirmation(member.id)}
                              variant="ghost"
                              className="text-red-600 hover:text-red-800"
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'invites' && (
          <motion.div
            key="invites"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Send Invitation */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Send Invitation</h3>
              <div className="flex gap-4">
                <UIInput
                  type="email"
                  value={newInviteEmail}
                  onChange={(e) => setNewInviteEmail(e.target.value)}
                  placeholder="Enter email address"
                  className="flex-1"
                />
                <Button onClick={handleInvite} disabled={!newInviteEmail}>
                  Send Invite
                </Button>
              </div>
            </div>

            {/* Pending Invitations */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Pending Invitations</h3>
              </div>

              {invitations.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <EnvelopeIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No pending invitations</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {invitations.map((invite, index) => (
                    <motion.div
                      key={invite.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="p-6 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-gray-900">{invite.email}</div>
                        <div className="text-sm text-gray-500">
                          Sent {invite.sentAt.toLocaleDateString()}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(invite.status)}`}
                      >
                        {invite.status}
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
                <h3 className="text-lg font-semibold text-gray-900">Remove Member</h3>
              </div>

              <p className="text-gray-600 mb-6">
                Are you sure you want to remove this member from the league? This action cannot be
                undone.
              </p>

              <div className="flex gap-3">
                <Button
                  onClick={() => setShowConfirmation(null)}
                  variant="secondary"
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    onRemoveMember?.(showConfirmation);
                    setShowConfirmation(null);
                  }}
                  variant="danger"
                  className="flex-1"
                >
                  Remove
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
