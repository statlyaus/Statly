import { useState, useEffect, useCallback } from 'react';
import { serverTimestamp } from 'firebase/firestore';
import { draftPersistence, type DraftState, type DraftPick } from '@/services/draftPersistence';

interface PersistentDraftHookProps {
  draftId: string;
  currentUserId?: string;
}

export interface PersistentDraftData {
  // Core draft state from Firestore
  draftState: DraftState | null;

  // Loading states
  isLoading: boolean;
  isRecovering: boolean;
  error: string | null;

  // Last sync info
  lastSyncTime?: Date;

  // Recent activity
  recentActivity: Array<{
    id: string;
    type: 'pick' | 'join' | 'leave' | 'recovery';
    message: string;
    timestamp: Date;
    participantId?: string;
  }>;
}

export interface PersistentDraftActions {
  // Pick management with auto-save
  makePick: (playerId: string, playerName: string, position: string, club: string) => Promise<void>;

  // Queue management with auto-save
  updateQueue: (queue: string[]) => Promise<void>;

  // Recovery and sync
  forceSync: () => Promise<void>;
  recoverDraftState: () => Promise<void>;

  // Participant management
  markOnline: () => Promise<void>;
  markOffline: () => Promise<void>;
}

export function usePersistentDraft({
  draftId,
  currentUserId,
}: PersistentDraftHookProps): PersistentDraftData & PersistentDraftActions {
  // State management
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date>();
  const [recentActivity, setRecentActivity] = useState<PersistentDraftData['recentActivity']>([]);

  // Add activity to feed
  const addActivity = useCallback((activity: PersistentDraftData['recentActivity'][0]) => {
    setRecentActivity((prev) => [...prev, activity].slice(-10)); // Keep last 10
  }, []);

  // Load draft state from Firestore
  const loadDraftState = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const state = await draftPersistence.getDraftState(draftId);

      if (state) {
        setDraftState(state);
        setLastSyncTime(new Date());

        addActivity({
          id: `load-${Date.now()}`,
          type: 'recovery',
          message: `Draft loaded: ${state.picks.length} picks made, currently pick ${state.currentPick}`,
          timestamp: new Date(),
        });

        console.log('✅ Draft state loaded from Firestore');
      } else {
        setError('Draft not found');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load draft';
      setError(errorMessage);
      console.error('❌ Failed to load draft state:', err);
    } finally {
      setIsLoading(false);
    }
  }, [draftId, addActivity]);

  // Subscribe to real-time Firestore updates
  const subscribeToUpdates = useCallback(() => {
    try {
      const unsubscribe = draftPersistence.subscribeToDraftUpdates(draftId, (updatedState) => {
        setDraftState(updatedState);
        setLastSyncTime(new Date());
        setError(null);

        // Check for new picks since last update
        if (draftState && updatedState.picks.length > draftState.picks.length) {
          const newPicks = updatedState.picks.slice(draftState.picks.length);
          newPicks.forEach((pick) => {
            addActivity({
              id: `pick-${pick.id}`,
              type: 'pick',
              message: `${pick.member.displayName} picked ${pick.player.name}`,
              timestamp: new Date(),
              participantId: pick.member.id,
            });
          });
        }

        console.log('🔄 Real-time update received from Firestore');
      });

      return unsubscribe;
    } catch (err) {
      console.error('❌ Failed to subscribe to Firestore updates:', err);
      return () => {};
    }
  }, [draftId, draftState, addActivity]);

  // Make a pick with automatic persistence
  const makePick = useCallback(
    async (playerId: string, playerName: string, position: string, club: string) => {
      if (!draftState || !currentUserId) {
        throw new Error('Draft not ready or user not identified');
      }

      try {
        const currentParticipant = draftState.participants.find((p) => p.id === currentUserId);
        if (!currentParticipant) {
          throw new Error('You are not a participant in this draft');
        }

        const pick: DraftPick = {
          id: `pick-${Date.now()}-${currentUserId}`,
          overall: draftState.currentPick,
          round: draftState.currentRound,
          slot: draftState.currentTurn + 1,
          player: {
            id: playerId,
            name: playerName,
            position,
            club,
          },
          member: {
            id: currentUserId,
            displayName: currentParticipant.displayName,
          },
          auto: false,
          madeAt: new Date().toISOString(),
          timestamp: serverTimestamp(), // Firestore will set this
        };

        // Save to Firestore (triggers real-time updates)
        await draftPersistence.savePick(draftId, pick);

        addActivity({
          id: `local-pick-${pick.id}`,
          type: 'pick',
          message: `You picked ${playerName}`,
          timestamp: new Date(),
          participantId: currentUserId,
        });

        console.log(`✅ Pick saved: ${playerName} (Pick ${draftState.currentPick})`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to make pick';
        setError(errorMessage);
        console.error('❌ Failed to make pick:', err);
        throw err;
      }
    },
    [draftState, currentUserId, draftId, addActivity]
  );

  // Update queue with automatic persistence
  const updateQueue = useCallback(
    async (queue: string[]) => {
      if (!currentUserId) {
        throw new Error('User not identified');
      }

      try {
        await draftPersistence.updateParticipant(draftId, currentUserId, { queue });

        addActivity({
          id: `queue-${Date.now()}`,
          type: 'pick',
          message: `Updated your queue (${queue.length} players)`,
          timestamp: new Date(),
          participantId: currentUserId,
        });

        console.log(`✅ Queue updated: ${queue.length} players`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to update queue';
        setError(errorMessage);
        console.error('❌ Failed to update queue:', err);
        throw err;
      }
    },
    [draftId, currentUserId, addActivity]
  );

  // Force sync from Firestore
  const forceSync = useCallback(async () => {
    await loadDraftState();
  }, [loadDraftState]);

  // Recover draft state (for reconnection)
  const recoverDraftState = useCallback(async () => {
    if (!currentUserId) return;

    try {
      setIsRecovering(true);
      setError(null);

      const recoveredState = await draftPersistence.recoverDraftState(draftId, currentUserId);

      if (recoveredState) {
        setDraftState(recoveredState);
        setLastSyncTime(new Date());

        addActivity({
          id: `recovery-${Date.now()}`,
          type: 'recovery',
          message: `Successfully recovered draft state`,
          timestamp: new Date(),
          participantId: currentUserId,
        });

        console.log('🔄 Draft state successfully recovered');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to recover draft';
      setError(errorMessage);
      console.error('❌ Failed to recover draft state:', err);
    } finally {
      setIsRecovering(false);
    }
  }, [draftId, currentUserId, addActivity]);

  // Mark participant as online
  const markOnline = useCallback(async () => {
    if (!currentUserId) return;

    try {
      await draftPersistence.updateParticipant(draftId, currentUserId, { isOnline: true });
      console.log('👤 Marked as online');
    } catch (err) {
      console.error('❌ Failed to mark as online:', err);
    }
  }, [draftId, currentUserId]);

  // Mark participant as offline
  const markOffline = useCallback(async () => {
    if (!currentUserId) return;

    try {
      await draftPersistence.markParticipantOffline(draftId, currentUserId);
      console.log('👤 Marked as offline');
    } catch (err) {
      console.error('❌ Failed to mark as offline:', err);
    }
  }, [draftId, currentUserId]);

  // Initialize on mount
  useEffect(() => {
    if (draftId) {
      loadDraftState();
      const unsubscribe = subscribeToUpdates();

      // Cleanup on unmount
      return () => {
        unsubscribe();
        markOffline();
      };
    }
  }, [draftId, loadDraftState, subscribeToUpdates, markOffline]);

  // Mark as online when ready
  useEffect(() => {
    if (draftState && currentUserId && !isLoading) {
      markOnline();
    }
  }, [draftState, currentUserId, isLoading, markOnline]);

  return {
    // Data
    draftState,
    isLoading,
    isRecovering,
    error,
    lastSyncTime,
    recentActivity,

    // Actions
    makePick,
    updateQueue,
    forceSync,
    recoverDraftState,
    markOnline,
    markOffline,
  };
}
