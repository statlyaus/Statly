'use client';

import { useState, useCallback, useReducer, useMemo } from 'react';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  stats?: any;
  injuryStatus?: 'healthy' | 'questionable' | 'injured' | 'out';
  isAvailable?: boolean;
  recommendationScore?: number;
  draftedBy?: string;
}

interface DraftState {
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  isPaused: boolean;
  isComplete: boolean;
  timeRemaining: number;
  currentDrafter?: {
    member: {
      id: string;
      displayName: string;
    };
  };
}

interface DraftActions {
  type: 'SET_STATUS' | 'UPDATE_PICK' | 'SET_TIME' | 'SET_DRAFTER' | 'PAUSE' | 'RESUME' | 'COMPLETE';
  payload?: any;
}

const draftReducer = (state: DraftState, action: DraftActions): DraftState => {
  switch (action.type) {
    case 'SET_STATUS':
      return {
        ...state,
        status: action.payload.status,
        isPaused: action.payload.status === 'PAUSED',
        isComplete: action.payload.status === 'COMPLETED',
      };
    case 'UPDATE_PICK':
      return {
        ...state,
        currentPick: action.payload.currentPick,
        round: action.payload.round,
        direction: action.payload.direction,
      };
    case 'SET_TIME':
      return {
        ...state,
        timeRemaining: action.payload.timeRemaining,
      };
    case 'SET_DRAFTER':
      return {
        ...state,
        currentDrafter: action.payload.currentDrafter,
      };
    case 'PAUSE':
      return {
        ...state,
        status: 'PAUSED',
        isPaused: true,
      };
    case 'RESUME':
      return {
        ...state,
        status: 'LIVE',
        isPaused: false,
      };
    case 'COMPLETE':
      return {
        ...state,
        status: 'COMPLETED',
        isComplete: true,
      };
    default:
      return state;
  }
};

export function useDraftState(initialDraftData: any) {
  const [draftState, dispatch] = useReducer(draftReducer, {
    currentPick: initialDraftData?.currentPick || 1,
    totalPicks: initialDraftData?.totalPicks || 0,
    round: initialDraftData?.round || 1,
    direction: initialDraftData?.direction || 'FORWARD',
    status: initialDraftData?.status || 'SCHEDULED',
    isPaused: initialDraftData?.status === 'PAUSED',
    isComplete: initialDraftData?.status === 'COMPLETED',
    timeRemaining: 120,
    currentDrafter: undefined,
  });

  const [players, setPlayers] = useState<DraftPlayer[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);

  // Memoized computed values
  const draftProgress = useMemo(() => {
    const progress = (draftState.currentPick / draftState.totalPicks) * 100;
    return Math.min(progress, 100);
  }, [draftState.currentPick, draftState.totalPicks]);

  const isLive = useMemo(() => draftState.status === 'LIVE', [draftState.status]);
  const canMakePick = useMemo(
    () => isLive && !draftState.isPaused && !draftState.isComplete,
    [isLive, draftState.isPaused, draftState.isComplete]
  );

  // Actions
  const updateStatus = useCallback((status: string) => {
    dispatch({ type: 'SET_STATUS', payload: { status } });
  }, []);

  const updatePick = useCallback((pickData: any) => {
    dispatch({ type: 'UPDATE_PICK', payload: pickData });
  }, []);

  const setTimeRemaining = useCallback((time: number) => {
    dispatch({ type: 'SET_TIME', payload: { timeRemaining: time } });
  }, []);

  const setCurrentDrafter = useCallback((drafter: any) => {
    dispatch({ type: 'SET_DRAFTER', payload: { currentDrafter: drafter } });
  }, []);

  const pauseDraft = useCallback(() => {
    dispatch({ type: 'PAUSE' });
  }, []);

  const resumeDraft = useCallback(() => {
    dispatch({ type: 'RESUME' });
  }, []);

  const completeDraft = useCallback(() => {
    dispatch({ type: 'COMPLETE' });
  }, []);

  const addPick = useCallback((pick: any) => {
    setPicks((prev) => [...prev, pick]);
  }, []);

  const updatePlayers = useCallback((newPlayers: DraftPlayer[]) => {
    setPlayers(newPlayers);
  }, []);

  const updateParticipants = useCallback((newParticipants: any[]) => {
    setParticipants(newParticipants);
  }, []);

  return {
    // State
    draftState,
    players,
    picks,
    participants,

    // Computed values
    draftProgress,
    isLive,
    canMakePick,

    // Actions
    updateStatus,
    updatePick,
    setTimeRemaining,
    setCurrentDrafter,
    pauseDraft,
    resumeDraft,
    completeDraft,
    addPick,
    updatePlayers,
    updateParticipants,
  };
}
