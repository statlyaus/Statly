'use client';

import React, { createContext, useContext, useReducer, useMemo, useEffect } from 'react';
import { draftReducer, draftActions, initialState as draftInitialState } from '@/lib/draftReducer';
import type { DraftContextValue, DraftPick, DraftDirection } from '@/types/draft';
import { useLiveDraft } from '@/hooks/useLiveDraft';
import { useDraftService } from '@/hooks/useDraftService';

interface DraftProviderProps {
  children: React.ReactNode;
  draftId: string;
  userId: string;
}

const DraftContext = createContext<DraftContextValue | null>(null);

export function DraftProvider({ children, draftId, userId }: DraftProviderProps) {
  const [state, dispatch] = useReducer(draftReducer, {
    ...draftInitialState,
    draft: null,
    participants: [],
    picks: [],
    availablePlayers: [],
  });

  // Initialize real-time connection
  const { connectionHealth, actions: liveDraftActions, draftState: liveDraftState } = useLiveDraft({
    draftId,
    userId,
    autoReconnect: true,
    onError: (error) => {
      dispatch(draftActions.setError(error));
    },
    onPickMade: (pick) => {
      // Calculate next draft state
      const nextPick = (state.draft?.currentPick || 0) + 1;
      const teamCount = Array.isArray(state.participants) && state.participants.length > 0
        ? state.participants.length
        : 1;
      const round = Math.ceil(nextPick / teamCount);
      const direction: DraftDirection = round % 2 === 1 ? 'FORWARD' : 'REVERSE';

      // Convert the pick data to match DraftPick type
      const draftPick: DraftPick = {
        id: pick.id,
        overall: pick.overall,
        round: round,
        slot: (nextPick - 1) % teamCount,
        auto: false,
        madeAt: new Date(),
        player: {
          id: pick.player.id,
          name: pick.player.name,
          position: 'Unknown', // Default value since not provided by useLiveDraft
          club: 'Unknown',     // Default value since not provided by useLiveDraft
          isAvailable: false,
        },
        member: {
          id: pick.member.id,
          userId: pick.member.id, // Assuming member.id is the userId
          displayName: pick.member.displayName,
          teamName: pick.member.displayName, // Using displayName as fallback
        },
      };

      dispatch(draftActions.updatePick(draftPick, nextPick, round, direction, new Date()));
    },
    onDraftCompleted: () => {
      if (state.draft) {
        dispatch(draftActions.setDraft(
          { ...state.draft, status: 'COMPLETED' },
          state.participants,
          state.picks,
          state.availablePlayers
        ));
      }
    },
  });

  // Sync live draft state with local state
  useEffect(() => {
    if (liveDraftState && state.draft) {
      // Update local draft state with live state changes
      const updatedDraft = {
        ...state.draft,
        status: liveDraftState.status,
        currentPick: liveDraftState.currentPick.pickNumber,
        round: liveDraftState.currentPick.round,
        // Add other fields as needed
      };

      dispatch(draftActions.setDraft(
        updatedDraft,
        state.participants,
        state.picks,
        state.availablePlayers
      ));
    }
  }, [liveDraftState, state.draft, state.participants, state.picks, state.availablePlayers]);
  
  // Initialize draft service
  const { draftService, isLoading: serviceLoading } = useDraftService(draftId);

  // Load initial draft data
  useEffect(() => {
    if (!draftService) return;

    const loadDraftData = async () => {
      try {
        dispatch(draftActions.setLoading(true));
        
        const [draft, participants, picks, availablePlayers] = await Promise.all([
          draftService.getDraft(),
          draftService.getParticipants(),
          draftService.getPicks(),
          draftService.getAvailablePlayers(),
        ]);

        dispatch(draftActions.setDraft(draft, participants, picks, availablePlayers));
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to load draft'));
      }
    };

    loadDraftData();
  }, [draftService]);

  // Update connection state
  useEffect(() => {
    dispatch(draftActions.setConnection({
      status: connectionHealth.connected ? 'connected' : 'disconnected',
      reconnectAttempts: connectionHealth.reconnectAttempts,
      latency: connectionHealth.latency,
    }));
  }, [connectionHealth]);

  // Computed values
  const computedValues = useMemo(() => {
    const isLive = state.draft?.status === 'LIVE';
    const isPaused = state.draft?.status === 'PAUSED';
    const isComplete = state.draft?.status === 'COMPLETED';
    const canMakePick = isLive && !isPaused && state.liveState.isYourTurn;
    const draftProgress = state.draft ? 
      Math.max(0, Math.min(100, (state.draft.currentPick / Math.max(state.draft.totalPicks || 1, 1)) * 100)) : 0;

    return {
      isLive,
      isPaused,
      isComplete,
      canMakePick,
      draftProgress,
    };
  }, [state.draft, state.liveState.isYourTurn]);

  // Actions
  const actions = useMemo(() => ({
    makePick: async (playerId: string) => {
      if (!liveDraftActions) return;
      
      try {
        dispatch(draftActions.setLoading(false, true));
        
        await liveDraftActions.makePick(playerId);
        
        // Real-time update will handle state update through useLiveDraft
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to make pick'));
      } finally {
        dispatch(draftActions.setLoading(false, false));
      }
    },

    updateQueue: async (queue: string[]) => {
      if (!liveDraftActions) return;
      
      try {
        await liveDraftActions.updateQueue(queue);
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to update queue'));
      }
    },

    pauseDraft: async () => {
      if (!liveDraftActions) return;
      
      try {
        await liveDraftActions.pauseDraft();
        // Real-time update will handle state update through useLiveDraft
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to pause draft'));
      }
    },

    resumeDraft: async () => {
      if (!liveDraftActions) return;
      
      try {
        await liveDraftActions.resumeDraft();
        // Real-time update will handle state update through useLiveDraft
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to resume draft'));
      }
    },

    forceRefresh: async () => {
      if (!draftService) return;
      
      try {
        dispatch(draftActions.setLoading(true));
        
        const [draft, participants, picks, availablePlayers] = await Promise.all([
          draftService.getDraft(),
          draftService.getParticipants(),
          draftService.getPicks(),
          draftService.getAvailablePlayers(),
        ]);

        dispatch(draftActions.setDraft(draft, participants, picks, availablePlayers));
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to refresh draft'));
      }
    },
  }), [liveDraftActions, dispatch]);

  // Context value
  const contextValue: DraftContextValue = useMemo(() => ({
    // Core state
    draft: state.draft,
    participants: state.participants,
    picks: state.picks,
    availablePlayers: state.availablePlayers,
    
    // Real-time state
    connection: state.connection,
    timer: state.timer,
    liveState: state.liveState,
    
    // Computed values
    ...computedValues,
    
    // Actions
    ...actions,
    
    // Loading states
    isLoading: state.isLoading || serviceLoading,
    isSaving: state.isSaving,
    error: state.error,
  }), [
    state,
    computedValues,
    actions,
    serviceLoading,
  ]);

  return (
    <DraftContext.Provider value={contextValue}>
      {children}
    </DraftContext.Provider>
  );
}

// Hook to use draft context
export function useDraft() {
  const context = useContext(DraftContext);
  if (!context) {
    throw new Error('useDraft must be used within a DraftProvider');
  }
  return context;
}

// Hook to use draft context safely (returns null if not available)
export function useDraftSafe() {
  return useContext(DraftContext);
}
