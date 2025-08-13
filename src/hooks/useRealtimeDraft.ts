"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { joinDraft, emitPick, emitQueueUpdate } from '@/client/socket';
import type { Socket } from 'socket.io-client';

interface DraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
}

interface DraftPick {
  id: string;
  overall: number;
  round: number;
  slot: number;
  player: DraftPlayer;
  member: {
    id: string;
    displayName: string;
  };
  auto: boolean;
  madeAt: string;
}

interface DraftParticipant {
  slot: number;
  member: {
    id: string;
    userId: string;
    displayName: string;
    email: string;
  };
}

interface DraftData {
  id: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  participants: DraftParticipant[];
  picks: DraftPick[];
  completedAt?: string;
}

interface LiveDraftState {
  currentTurn?: {
    round: number;
    slot: number;
    member: {
      id: string;
      displayName: string;
    };
  };
  timeRemaining: number;
  isYourTurn: boolean;
  nextTurn?: {
    round: number;
    slot: number;
    member: {
      id: string;
      displayName: string;
    };
  };
  picksUntilYourTurn: number;
}

interface ConnectionState {
  status: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  lastUpdate?: string;
  error?: string;
}

interface RealtimeDraftReturn {
  // Core draft data
  draftData: DraftData;
  liveDraftState: LiveDraftState;
  connectionState: ConnectionState;
  
  // Real-time updates
  lastPickMade?: DraftPick;
  recentActivity: Array<{
    id: string;
    type: 'pick' | 'join' | 'leave' | 'status';
    message: string;
    timestamp: string;
    participant?: DraftParticipant;
    pick?: DraftPick;
  }>;
  
  // Actions
  makePick: (playerId: string) => Promise<void>;
  updateQueue: (queue: Array<{ playerId: string; rank: number }>) => void;
  forceRefresh: () => Promise<void>;
  
  // Socket reference for advanced usage
  socket?: Socket;
}

export function useRealtimeDraft(
  initialDraftData: DraftData,
  currentUserId: string,
  enabled: boolean = true
): RealtimeDraftReturn {
  const [draftData, setDraftData] = useState<DraftData>(initialDraftData);
  const [liveDraftState, setLiveDraftState] = useState<LiveDraftState>({
    timeRemaining: 120, // Default 2 minutes
    isYourTurn: false,
    picksUntilYourTurn: 0
  });
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'connecting'
  });
  const [lastPickMade, setLastPickMade] = useState<DraftPick>();
  const [recentActivity, setRecentActivity] = useState<Array<{
    id: string;
    type: 'pick' | 'join' | 'leave' | 'status';
    message: string;
    timestamp: string;
    participant?: DraftParticipant;
    pick?: DraftPick;
  }>>([]);

  const socketRef = useRef<Socket | undefined>(undefined);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Add activity to the feed
  const addActivity = useCallback((activity: {
    type: 'pick' | 'join' | 'leave' | 'status';
    message: string;
    participant?: DraftParticipant;
    pick?: DraftPick;
  }) => {
    const newActivity = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      ...activity
    };
    
    setRecentActivity(prev => [newActivity, ...prev.slice(0, 49)]); // Keep last 50 activities
  }, []);

  // Calculate live draft state based on current data
  const calculateLiveDraftState = useCallback((data: DraftData): LiveDraftState => {
    const teamCount = data.participants.length;
    if (teamCount === 0) {
      return {
        timeRemaining: 120,
        isYourTurn: false,
        picksUntilYourTurn: 0
      };
    }

    // Calculate current turn using snake draft logic
    const round = Math.ceil(data.currentPick / teamCount);
    const direction = (round % 2 === 1) ? 'FORWARD' : 'REVERSE';
    
    let currentSlot: number;
    if (direction === 'FORWARD') {
      currentSlot = ((data.currentPick - 1) % teamCount) + 1;
    } else {
      currentSlot = teamCount - ((data.currentPick - 1) % teamCount);
    }

    const currentTurnParticipant = data.participants.find(p => p.slot === currentSlot);
    const currentTurn = currentTurnParticipant ? {
      round,
      slot: currentSlot,
      member: currentTurnParticipant.member
    } : undefined;

    // Check if it's the current user's turn
    const isYourTurn = currentTurnParticipant?.member.userId === currentUserId;

    // Calculate next turn
    let nextPickNumber = data.currentPick + 1;
    let nextSlot: number;
    if (nextPickNumber <= data.totalPicks) {
      const nextRound = Math.ceil(nextPickNumber / teamCount);
      const nextDirection = (nextRound % 2 === 1) ? 'FORWARD' : 'REVERSE';
      
      if (nextDirection === 'FORWARD') {
        nextSlot = ((nextPickNumber - 1) % teamCount) + 1;
      } else {
        nextSlot = teamCount - ((nextPickNumber - 1) % teamCount);
      }

      const nextTurnParticipant = data.participants.find(p => p.slot === nextSlot);
      var nextTurn = nextTurnParticipant ? {
        round: nextRound,
        slot: nextSlot,
        member: nextTurnParticipant.member
      } : undefined;
    }

    // Calculate picks until user's turn
    let picksUntilYourTurn = 0;
    if (!isYourTurn && data.status === 'LIVE') {
      const userParticipant = data.participants.find(p => p.member.userId === currentUserId);
      if (userParticipant) {
        // Simulate future picks to find next occurrence of user's slot
        let tempPick = data.currentPick + 1;
        while (tempPick <= data.totalPicks && picksUntilYourTurn === 0) {
          const tempRound = Math.ceil(tempPick / teamCount);
          const tempDirection = (tempRound % 2 === 1) ? 'FORWARD' : 'REVERSE';
          
          let tempSlot: number;
          if (tempDirection === 'FORWARD') {
            tempSlot = ((tempPick - 1) % teamCount) + 1;
          } else {
            tempSlot = teamCount - ((tempPick - 1) % teamCount);
          }
          
          if (tempSlot === userParticipant.slot) {
            picksUntilYourTurn = tempPick - data.currentPick;
            break;
          }
          tempPick++;
        }
      }
    }

    return {
      currentTurn,
      timeRemaining: liveDraftState.timeRemaining, // Preserve existing timer
      isYourTurn,
      nextTurn,
      picksUntilYourTurn
    };
  }, [currentUserId, liveDraftState.timeRemaining]);

  // Handle pick made event
  const handlePickMade = useCallback((data: {
    draftId: string;
    pick: DraftPick;
    currentPick: number;
    isComplete: boolean;
  }) => {
    console.log('Pick made:', data);
    
    setDraftData(prev => ({
      ...prev,
      currentPick: data.currentPick,
      picks: [...prev.picks, data.pick],
      status: data.isComplete ? 'COMPLETED' : prev.status
    }));

    setLastPickMade(data.pick);
    
    addActivity({
      type: 'pick',
      message: `${data.pick.member.displayName} drafted ${data.pick.player.name}`,
      pick: data.pick
    });

    // Reset timer for next pick
    if (!data.isComplete) {
      setLiveDraftState(prev => ({ ...prev, timeRemaining: 120 }));
    }
  }, [addActivity]);

  // Handle timer updates
  const handleTimerUpdate = useCallback((data: {
    draftId: string;
    timeRemaining: number;
    currentTurn: {
      round: number;
      slot: number;
      member: {
        id: string;
        displayName: string;
      };
    };
  }) => {
    setLiveDraftState(prev => ({
      ...prev,
      timeRemaining: data.timeRemaining,
      currentTurn: data.currentTurn
    }));
  }, []);

  // Handle draft status changes
  const handleStatusChange = useCallback((data: {
    draftId: string;
    status: 'ACTIVE' | 'LIVE' | 'PAUSED' | 'COMPLETED';
    timestamp: string;
  }) => {
    setDraftData(prev => ({ ...prev, status: data.status }));
    
    addActivity({
      type: 'status',
      message: `Draft status changed to ${data.status}`
    });
  }, [addActivity]);

  // Handle participant events
  const handleParticipantJoin = useCallback((joinData: { socketId: string; timestamp: string }) => {
    // For now, we'll create a minimal participant object
    // In a real implementation, you'd look up the participant data
    addActivity({
      type: 'join',
      message: `Participant ${joinData.socketId} joined the draft`
    });
  }, [addActivity]);

  const handleParticipantLeave = useCallback((participantId: string) => {
    setDraftData(prev => ({
      ...prev,
      participants: prev.participants.filter(p => p.member.id !== participantId)
    }));
    
    addActivity({
      type: 'leave',
      message: `A participant left the draft`
    });
  }, [addActivity]);

  // Handle full draft updates
  const handleDraftUpdate = useCallback((data: {
    draftId: string;
    currentPick: number;
    totalPicks: number;
    round: number;
    direction: string;
    status: string;
    picks: DraftPick[];
    participants: DraftParticipant[];
    completedAt?: string;
  }) => {
    console.log('Full draft update:', data);
    const fullDraftData: DraftData = {
      id: data.draftId,
      ...data
    };
    setDraftData(fullDraftData);
    setConnectionState(prev => ({ ...prev, lastUpdate: new Date().toISOString() }));
  }, []);

  // Handle connection changes
  const handleConnectionChange = useCallback((status: {
    connected: boolean;
    reconnecting: boolean;
    lastHeartbeat?: string;
  }) => {
    setConnectionState(prev => ({
      ...prev,
      status: status.connected 
        ? 'connected' 
        : status.reconnecting 
        ? 'reconnecting' 
        : 'disconnected'
    }));
  }, []);

  // Handle errors
  const handleError = useCallback((error: Error) => {
    console.error('Draft socket error:', error);
    setConnectionState(prev => ({
      ...prev,
      status: 'disconnected',
      error: error.message
    }));
  }, []);

  // Actions
  const makePick = useCallback(async (playerId: string): Promise<void> => {
    if (!socketRef.current) {
      throw new Error('Not connected to draft');
    }

    try {
      // Emit pick event through socket for real-time updates
      emitPick(socketRef.current, draftData.id, playerId, currentUserId);
      
      // Also make the HTTP request for persistence
      const response = await fetch(`/api/drafts/${draftData.id}/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId,
          memberId: currentUserId,
          timestamp: new Date().toISOString()
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to make pick');
      }
    } catch (error) {
      console.error('Error making pick:', error);
      throw error;
    }
  }, [draftData.id, currentUserId]);

  const updateQueue = useCallback((queue: Array<{ playerId: string; rank: number }>) => {
    if (socketRef.current) {
      emitQueueUpdate(socketRef.current, draftData.id, currentUserId, queue);
    }
  }, [draftData.id, currentUserId]);

  const forceRefresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/drafts/${draftData.id}`);
      if (response.ok) {
        const freshData = await response.json();
        setDraftData(freshData);
      }
    } catch (error) {
      console.error('Error refreshing draft data:', error);
    }
  }, [draftData.id]);

  // Initialize socket connection
  useEffect(() => {
    console.log('🎯 useRealtimeDraft effect running:', { 
      enabled, 
      draftId: draftData.id, 
      hasId: !!draftData.id 
    });
    
    if (!enabled || !draftData.id) {
      console.log('❌ Not connecting to socket:', { enabled, hasId: !!draftData.id });
      return;
    }

    console.log('🚀 Initializing socket connection for draft:', draftData.id);

    const { socket, cleanup } = joinDraft(draftData.id, {
      onDraftUpdate: handleDraftUpdate,
      onPickMade: handlePickMade,
      onTimerUpdate: handleTimerUpdate,
      onStatusChange: handleStatusChange,
      onParticipantJoin: handleParticipantJoin,
      onParticipantLeave: handleParticipantLeave,
      onConnectionChange: handleConnectionChange,
      onError: handleError
    });

    socketRef.current = socket;

    return cleanup;
  }, [enabled, draftData.id, handleDraftUpdate, handlePickMade, handleTimerUpdate, 
      handleStatusChange, handleParticipantJoin, handleParticipantLeave, 
      handleConnectionChange, handleError]);

  // Update live draft state when draft data changes
  useEffect(() => {
    const newLiveDraftState = calculateLiveDraftState(draftData);
    setLiveDraftState(prev => ({
      ...newLiveDraftState,
      timeRemaining: prev.timeRemaining // Preserve timer unless specifically updated
    }));
  }, [draftData, calculateLiveDraftState]);

  // Client-side timer for countdown
  useEffect(() => {
    if (draftData.status === 'LIVE' && liveDraftState.timeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setLiveDraftState(prev => ({
          ...prev,
          timeRemaining: Math.max(0, prev.timeRemaining - 1)
        }));
      }, 1000);

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }
  }, [draftData.status, liveDraftState.timeRemaining]);

  return {
    draftData,
    liveDraftState,
    connectionState,
    lastPickMade,
    recentActivity,
    makePick,
    updateQueue,
    forceRefresh,
    socket: socketRef.current
  };
}
