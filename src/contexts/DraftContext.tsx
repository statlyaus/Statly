'use client';

import React, { createContext, useContext, useReducer, useMemo, useEffect } from 'react';
import { draftReducer, draftActions, initialState as draftInitialState } from '@/lib/draftReducer';
import type { DraftContextValue, DraftPick, DraftParticipant } from '@/types/draft';
import { useRealtimeConnection } from '@/hooks/useRealtimeConnection';
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
  const { connection, realtime } = useRealtimeConnection(draftId, userId);
  
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
    dispatch(draftActions.setConnection(connection));
  }, [connection]);

  // Handle real-time updates
  useEffect(() => {
    if (!realtime) return;

    const handlePickMade = (pick: DraftPick) => {
      // Calculate next draft state
      const nextPick = (state.draft?.currentPick || 0) + 1;
      const teamCount = Array.isArray(state.participants) && state.participants.length > 0
        ? state.participants.length
        : 1;
      const round = Math.ceil(nextPick / teamCount);
      const direction = round % 2 === 1 ? 'FORWARD' : 'REVERSE';

      dispatch(draftActions.updatePick(pick, nextPick, round, direction, new Date()));
    };

    type ParticipantUpdateEvent =
      | { participantId?: string | number; id?: string | number; updates?: Partial<DraftParticipant> }
      | (Partial<DraftParticipant> & { participantId?: string | number; id?: string | number });

    const handleParticipantUpdate = (data: ParticipantUpdateEvent) => {
      const pid = (typeof (data as any)?.participantId !== 'undefined'
        ? (data as any).participantId
        : (data as any)?.id);
      const updates: Partial<DraftParticipant> = (data as any)?.updates
        ? ((data as any).updates as Partial<DraftParticipant>)
        : (data as Partial<DraftParticipant>);
      if (pid != null) {
        dispatch(draftActions.updateParticipant(String(pid), updates));
      }
    };

    const handleTimerUpdate = (timeRemaining: number) => {
      dispatch(draftActions.setTimer({ timeRemaining }));
    };

    const handleDraftPaused = () => {
      if (state.draft) {
        dispatch(draftActions.setDraft(
          { ...state.draft, status: 'PAUSED' },
          state.participants,
          state.picks,
          state.availablePlayers
        ));
      }
    };

    const handleDraftResumed = () => {
      if (state.draft) {
        dispatch(draftActions.setDraft(
          { ...state.draft, status: 'LIVE' },
          state.participants,
          state.picks,
          state.availablePlayers
        ));
      }
    };

    // Subscribe to real-time events
    realtime.on('pick:made', handlePickMade);
    realtime.on('participant:update', handleParticipantUpdate);
    realtime.on('timer:update', handleTimerUpdate);
    realtime.on('draft:paused', handleDraftPaused);
    realtime.on('draft:resumed', handleDraftResumed);

    return () => {
      realtime.off('pick:made', handlePickMade);
      realtime.off('participant:update', handleParticipantUpdate);
      realtime.off('timer:update', handleTimerUpdate);
      realtime.off('draft:paused', handleDraftPaused);
      realtime.off('draft:resumed', handleDraftResumed);
    };
  }, [realtime, state.draft, state.participants, state.picks, state.availablePlayers]);

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
      if (!draftService || !realtime) return;
      
      try {
        dispatch(draftActions.setLoading(false, true));
        
        const pick = await draftService.makePick(playerId);
        
        // Real-time update will handle state update
        realtime.emit('pick:made', pick);
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to make pick'));
      } finally {
        dispatch(draftActions.setLoading(false, false));
      }
    },

    updateQueue: async (queue: string[]) => {
      if (!draftService) return;
      
      try {
        await draftService.updateQueue(queue);
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to update queue'));
      }
    },

    pauseDraft: async () => {
      if (!draftService || !realtime) return;
      
      try {
        await draftService.pauseDraft();
        realtime.emit('draft:paused', { pausedBy: userId, pausedAt: new Date().toISOString() });
      } catch (error) {
        dispatch(draftActions.setError(error instanceof Error ? error.message : 'Failed to pause draft'));
      }
    },

    resumeDraft: async () => {
      if (!draftService || !realtime) return;
      
      try {
        await draftService.resumeDraft();
        realtime.emit('draft:resumed', { resumedBy: userId, resumedAt: new Date().toISOString() });
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
  }), [draftService, realtime, dispatch]);

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
