/**
 * Custom hook for draft management
 * Consolidates draft-related state and actions
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import { isConnectivityError, getConnectivityErrorMessage } from '@/utils/errorHandling';
import type { League, LeagueMember } from '@/types/leagues';

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

export const DEFAULT_DRAFT_SETTINGS: DraftSettings = {
  scheduledTime: '',
  draftType: 'snake',
  timePerPick: 120,
  timeZone: 'Australia/Melbourne',
  enableReminders: true,
};

// Minimum number of league members required to create a draft (business requirement for fair competition)
export const MIN_MEMBERS_FOR_DRAFT = 4;

interface UseDraftManagerReturn {
  // State
  existingDraft: ExistingDraft | null;
  draftSettings: DraftSettings;
  showDraftSettings: boolean;
  savingDraft: boolean;
  error: string | null;

  // Computed values
  canCreateDraft: boolean;

  // Actions
  setDraftSettings: (settings: DraftSettings) => void;
  setShowDraftSettings: (show: boolean) => void;
  createDraft: () => Promise<void>;
  joinDraftRoom: () => void;
  checkExistingDraft: () => Promise<void>;
  clearError: () => void;
}

export const useDraftManager = (
  league: League,
  members: LeagueMember[],
  currentUserId?: string
): UseDraftManagerReturn => {
  const router = useRouter();

  const [existingDraft, setExistingDraft] = useState<ExistingDraft | null>(null);
  const [showDraftSettings, setShowDraftSettings] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draftSettings, setDraftSettings] = useState<DraftSettings>(DEFAULT_DRAFT_SETTINGS);

  // Computed values
  const isOwner = currentUserId === league.ownerId;
  const hasEnoughMembers = members.length >= MIN_MEMBERS_FOR_DRAFT;
  const canCreateDraft = isOwner && hasEnoughMembers && !existingDraft;

  const checkExistingDraft = useCallback(async () => {
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
      if (error instanceof Error) {
        if (isConnectivityError(error)) {
          console.warn('Development server not running or API unreachable');
          setError(getConnectivityErrorMessage());
        } else {
          console.error('Error checking existing draft:', error);
          setError(`Failed to check draft status: ${error.message}`);
        }
      } else {
        console.error('Unknown error checking draft:', error);
        setError('An unexpected error occurred while checking draft status');
      }
    }
  }, [league.id]);

  const createDraft = useCallback(async () => {
    if (!canCreateDraft) return;

    setSavingDraft(true);
    setError(null);

    try {
      // Step 1: Create the draft with league synchronization
      const draftPayload = {
        name: `${league.name} Draft`,
        leagueId: league.id,
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
          ownerId: league.ownerId,
        },
        // Sync member data
        participants: members.map((member, index) => ({
          userId: member.userId,
          memberId: member.id,
          displayName: member.teamName,
          draftOrder: index + 1,
          isOwner: member.userId === league.ownerId,
        })),
      };

      const response = await fetchApi('drafts', {
        method: 'POST',
        body: JSON.stringify(draftPayload),
      });

      if (response.success) {
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
  }, [canCreateDraft, league, members, draftSettings, router]);

  const joinDraftRoom = useCallback(() => {
    if (existingDraft) {
      router.push(`/drafts/${existingDraft.id}`);
    }
  }, [existingDraft, router]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    existingDraft,
    draftSettings,
    showDraftSettings,
    savingDraft,
    error,

    // Computed values
    canCreateDraft,

    // Actions
    setDraftSettings,
    setShowDraftSettings,
    createDraft,
    joinDraftRoom,
    checkExistingDraft,
    clearError,
  };
};
