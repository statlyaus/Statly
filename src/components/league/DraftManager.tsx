'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  PlayIcon,
  CalendarIcon,
  UsersIcon,
  CogIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { fetchApi } from '@/lib/api';
import type { League, LeagueMember } from '@/types/leagues';
import { isConnectivityError, getConnectivityErrorMessage, isExpectedTestLeague404 } from '@/utils/errorHandling';

interface DraftParticipant {
  userId: string;
  memberId: string;
  displayName: string;
  draftOrder: number;
  isOwner: boolean;
}

interface DraftManagerProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

interface DraftSettings {
  scheduledTime: string;
  draftType: 'snake' | 'linear';
  timePerPick: number;
  timeZone: string;
  enableReminders: boolean;
}

interface ExistingDraft {
  id: string;
  status: 'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  startAt: string;
  createdAt: string;
}

export default function DraftManager({ league, members, currentUserId }: DraftManagerProps) {
  const router = useRouter();
  const [showDraftSettings, setShowDraftSettings] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [existingDraft, setExistingDraft] = useState<ExistingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [draftSettings, setDraftSettings] = useState<DraftSettings>({
    scheduledTime: '',
    draftType: 'snake',
    timePerPick: 120,
    timeZone: 'Australia/Melbourne',
    enableReminders: true,
  });

  const effectiveOwnerId = league.id === 'test-league-id' && currentUserId ? currentUserId : league.ownerId;
  const isOwner = currentUserId === effectiveOwnerId;
  const hasEnoughMembers = members.length >= 4;
  const canCreateDraft = isOwner && hasEnoughMembers && !existingDraft;

  // Initialize check on mount
  useEffect(() => {
    // Normalize timezone to the user's actual system timezone to match server conversion
    try {
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (userTimeZone && userTimeZone !== draftSettings.timeZone) {
        setDraftSettings((prev) => ({ ...prev, timeZone: userTimeZone }));
      }
    } catch {
      // Ignore if not available
    }

    // Prefill a default scheduled time 10 minutes from now (local time)
    if (!draftSettings.scheduledTime) {
      const nowPlusTen = new Date(Date.now() + 10 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const localStr = `${nowPlusTen.getFullYear()}-${pad(nowPlusTen.getMonth() + 1)}-${pad(
        nowPlusTen.getDate()
      )}T${pad(nowPlusTen.getHours())}:${pad(nowPlusTen.getMinutes())}`;
      setDraftSettings((prev) => ({ ...prev, scheduledTime: localStr }));
    }

    const checkDraft = async () => {
      try {
        const response = await fetchApi(`leagues/${league.id}/draft`);
        if (response.success && response.data?.hasDraft) {
          setExistingDraft({
            id: response.data.draftId,
            status: response.data.status || 'SCHEDULED',
            startAt: response.data.startAt,
            createdAt: response.data.createdAt,
          });
        }
      } catch (error) {
        // Handle different types of errors
        if (error instanceof Error) {
          if (isConnectivityError(error)) {
            console.warn('Development server not running or API unreachable');
            setError(getConnectivityErrorMessage());
          } else if (isExpectedTestLeague404(error, league.id)) {
            // Expected for test leagues, don't show error
            console.debug('Test league draft check - 404 expected');
          } else {
            console.error('Error checking existing draft:', error);
            setError(`Failed to check draft status: ${error.message}`);
          }
        } else {
          console.error('Unknown error checking draft:', error);
          setError('An unexpected error occurred while checking draft status');
        }
      }
    };

    checkDraft();
  }, [league.id]);

  const createDraft = async () => {
    if (!canCreateDraft) return;

    setSavingDraft(true);
    setError(null);

    try {
      // Client-side validation to avoid server rejection due to clock skew/timezone issues
      const selected = new Date(draftSettings.scheduledTime);
      if (Number.isNaN(selected.getTime())) {
        setError('Please choose a valid draft start time.');
        setSavingDraft(false);
        return;
      }
      if (selected.getTime() <= Date.now()) {
        setError('Scheduled time must be in the future.');
        setSavingDraft(false);
        return;
      }

      // Step 1: Create the draft with league synchronization
      // Build participants; ensure current user is included for test leagues
      
      let participants: DraftParticipant[] = members.map((member, index) => ({
        userId: member.userId,
        memberId: member.id,
        displayName: member.teamName || `Team ${index + 1}`,
        draftOrder: index + 1,
        isOwner: member.userId === league.ownerId,
      }));

      if (league.id === 'test-league-id' && currentUserId) {
        const alreadyIncluded = participants.some((p) => p.userId === currentUserId);
        if (!alreadyIncluded) {
          // Replace the last bot with the current user
          const lastIndex = participants.length - 1;
          const replacement = {
            userId: currentUserId,
            memberId: 'self',
            displayName: 'Your Team',
            draftOrder: participants[lastIndex]?.draftOrder || participants.length,
            isOwner: true,
          };
          if (lastIndex >= 0) participants[lastIndex] = replacement;
          else participants.push(replacement);
        }
        // Ensure only the current user is marked owner in test mode
        participants = participants.map((p) => ({ ...p, isOwner: p.userId === currentUserId }));
      }

      const draftPayloadBase = {
        name: `${league.name} Draft`,
        leagueSize: members.length,
        draftType: draftSettings.draftType,
        timePerPick: draftSettings.timePerPick,
        scheduledTime: draftSettings.scheduledTime,
        timeZone: draftSettings.timeZone,
        enableReminders: draftSettings.enableReminders,
        // Sync league data
        leagueData: {
          name: league.name,
          maxTeams: league.maxTeams,
          categories: league.categories,
          ownerId: league.id === 'test-league-id' && currentUserId ? currentUserId : league.ownerId,
        },
        // Sync member data
        participants,
      } as const;

      const draftPayload =
        league.id === 'test-league-id'
          ? { ...draftPayloadBase }
          : { ...draftPayloadBase, leagueId: league.id };

      const response = await fetchApi('drafts', {
        method: 'POST',
        body: JSON.stringify(draftPayload),
      });

      if (response.success) {
        // Step 2: Update league with draft reference (skip for test league)
        if (league.id !== 'test-league-id') {
          await fetchApi(`leagues/${league.id}/link-draft`, {
            method: 'POST',
            body: JSON.stringify({
              draftId: response.data.id,
            }),
          });
        }

        setExistingDraft({
          id: response.data.id,
          status: response.data.status,
          startAt: response.data.startAt,
          createdAt: response.data.createdAt,
        });

        setShowDraftSettings(false);

        // Navigate to draft room
        router.push(`/drafts/${response.data.id}`);
      } else {
        throw new Error(response.error || 'Failed to create draft');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (isConnectivityError(error)) {
          setError(getConnectivityErrorMessage());
        } else {
          setError(error.message);
        }
      } else {
        setError('Failed to create draft');
      }
      console.error('Draft creation error:', error);
    } finally {
      setSavingDraft(false);
    }
  };

  const joinDraftRoom = () => {
    if (existingDraft) {
      router.push(`/drafts/${existingDraft.id}`);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusColors = {
      SCHEDULED: 'bg-blue-100 text-blue-800',
      LOBBY: 'bg-yellow-100 text-yellow-800',
      COUNTDOWN: 'bg-orange-100 text-orange-800',
      LIVE: 'bg-green-100 text-green-800',
      PAUSED: 'bg-gray-100 text-gray-800',
      COMPLETED: 'bg-purple-100 text-purple-800',
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[status as keyof typeof statusColors] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  const formatDateTime = (dateTime: string) => {
    return new Date(dateTime).toLocaleString('en-AU', {
      timeZone: draftSettings.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <PlayIcon className="h-6 w-6 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-900">Draft Management</h2>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
          <span className="text-red-700">{error}</span>
        </div>
      )}

      {/* Existing Draft Display */}
      {existingDraft && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <CheckCircleIcon className="h-5 w-5 text-green-600" />
                <h3 className="font-semibold text-gray-900">Draft Created</h3>
                {getStatusBadge(existingDraft.status)}
              </div>
              <p className="text-sm text-gray-600 mb-1">
                Draft ID: <span className="font-mono text-xs">{existingDraft.id}</span>
              </p>
              <p className="text-sm text-gray-600">
                Scheduled: {formatDateTime(existingDraft.startAt)}
              </p>
            </div>
            <button
              onClick={joinDraftRoom}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
            >
              <PlayIcon className="h-4 w-4" />
              <span>Join Draft Room</span>
            </button>
          </div>
        </motion.div>
      )}

      {/* Draft Creation Section */}
      {!existingDraft && (
        <div className="space-y-4">
          {/* Prerequisites Check */}
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <UsersIcon className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">
                League Members: {members.length}/{league.maxTeams}
              </span>
              {hasEnoughMembers ? (
                <CheckCircleIcon className="h-5 w-5 text-green-500" />
              ) : (
                <span className="text-xs text-red-500">Need at least 4 members</span>
              )}
            </div>
            
            <div className="flex items-center space-x-3">
              <CogIcon className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">League Owner Access</span>
              {isOwner ? (
                <CheckCircleIcon className="h-5 w-5 text-green-500" />
              ) : (
                <span className="text-xs text-red-500">Owner only</span>
              )}
            </div>
          </div>

          {/* Create Draft Button */}
          {canCreateDraft && (
            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={() => setShowDraftSettings(true)}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
              >
                <CalendarIcon className="h-5 w-5" />
                <span>Create Draft for League</span>
              </button>
            </div>
          )}

          {!canCreateDraft && (
            <div className="pt-4 border-t border-gray-200">
              <div className="p-3 bg-gray-50 rounded-lg text-center">
                <span className="text-sm text-gray-500">
                  {!isOwner 
                    ? 'Only the league owner can create a draft'
                    : !hasEnoughMembers 
                    ? 'Need at least 4 members to create a draft'
                    : 'Draft requirements not met'
                  }
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Draft Settings Modal */}
      {showDraftSettings && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
          >
            <h3 className="text-lg font-semibold mb-4">Draft Settings</h3>
            
            <div className="space-y-4">
              {/* Scheduled Time */}
              <div>
                <label htmlFor="scheduledTime" className="block text-sm font-medium text-gray-700 mb-1">
                  Draft Start Time
                </label>
                <input
                  id="scheduledTime"
                  type="datetime-local"
                  value={draftSettings.scheduledTime}
                  onChange={(e) => setDraftSettings(prev => ({ ...prev, scheduledTime: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)} // At least 5 minutes from now
                />
              </div>

              {/* Draft Type */}
              <div>
                <label htmlFor="draftType" className="block text-sm font-medium text-gray-700 mb-1">
                  Draft Type
                </label>
                <select
                  id="draftType"
                  value={draftSettings.draftType}
                  onChange={(e) => setDraftSettings(prev => ({ ...prev, draftType: e.target.value as 'snake' | 'linear' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="snake">Snake Draft</option>
                  <option value="linear">Linear Draft</option>
                </select>
              </div>

              {/* Time Per Pick */}
              <div>
                <label htmlFor="timePerPick" className="block text-sm font-medium text-gray-700 mb-1">
                  Time Per Pick (seconds)
                </label>
                <select
                  id="timePerPick"
                  value={draftSettings.timePerPick}
                  onChange={(e) => setDraftSettings(prev => ({ ...prev, timePerPick: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value={60}>1 minute</option>
                  <option value={90}>1.5 minutes</option>
                  <option value={120}>2 minutes</option>
                  <option value={180}>3 minutes</option>
                  <option value={300}>5 minutes</option>
                </select>
              </div>

              {/* Enable Reminders */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="reminders"
                  checked={draftSettings.enableReminders}
                  onChange={(e) => setDraftSettings(prev => ({ ...prev, enableReminders: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="reminders" className="ml-2 text-sm text-gray-700">
                  Send draft reminders to league members
                </label>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowDraftSettings(false)}
                disabled={savingDraft}
                className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createDraft}
                disabled={savingDraft || !draftSettings.scheduledTime}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {savingDraft ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-4 w-4" />
                    <span>Create Draft</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
