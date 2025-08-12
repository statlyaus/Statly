import { useState, useEffect, useCallback, useRef } from 'react';
import { joinDraft } from '@/client/socket';
import { draftPersistence, type DraftState, type DraftPick } from '@/services/draftPersistence';
import { serverTimestamp } from 'firebase/firestore';
import type { Socket } from 'socket.io-client';

// Define types for socket events to replace 'any'
interface DraftUpdateData {
  draftId: string;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: string;
  status: string;
  picks: unknown[];
  participants: unknown[];
}

interface PickMadeData {
  draftId: string;
  pick: {
    id: string;
    overall: number;
    round: number;
    slot: number;
    player: {
      id: string;
      name: string;
      position: string;
      club: string;
    };
    member: {
      id: string;
      displayName: string;
    };
    auto: boolean;
    madeAt: string;
  };
  currentPick: number;
  isComplete: boolean;
}

interface TimerUpdateData {
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
}

interface ConnectionStatusData {
  connected: boolean;
  reconnecting: boolean;
  lastHeartbeat?: string;
}

interface ConnectionState {
  isConnected: boolean;
  reconnecting: boolean;
  lastReconnectAttempt?: Date;
  connectionError?: string;
}

interface RealtimeDraftHookProps {
  draftId: string;
  currentUserId?: string;
  autoConnect?: boolean;
}

export interface RealtimeDraftData {
  // Core draft state
  draftState: DraftState | null;
  
  // Connection status
  connectionState: ConnectionState;
  
  // Real-time updates
  lastPickMade: DraftPick | null;
  recentActivity: Array<{
    id: string;
    type: 'pick' | 'join' | 'leave' | 'timer' | 'queue_update';
    message: string;
    timestamp: Date;
    participantId?: string;
  }>;
  
  // Timer state
  timeRemaining: number;
  isTimerActive: boolean;
  
  // Participant management
  onlineParticipants: Set<string>;
  
  // Recovery state
  isRecovering: boolean;
  lastSyncTime?: Date;
}

export interface RealtimeDraftActions {
  // Pick management
  makePick: (playerId: string) => Promise<void>;
  
  // Queue management
  updateQueue: (queue: string[]) => Promise<void>;
  
  // Connection management
  reconnect: () => void;
  disconnect: () => void;
  
  // Recovery
  forceSync: () => Promise<void>;
  
  // Draft control
  pauseDraft: () => Promise<void>;
  resumeDraft: () => Promise<void>;
}

export function useRealtimeDraftPersistence({
  draftId,
  currentUserId,
  autoConnect = true
}: RealtimeDraftHookProps): RealtimeDraftData & RealtimeDraftActions {
  
  // State management
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    isConnected: false,
    reconnecting: false
  });
  const [lastPickMade, setLastPickMade] = useState<DraftPick | null>(null);
  const [recentActivity, setRecentActivity] = useState<RealtimeDraftData['recentActivity']>([]);
  const [timeRemaining, setTimeRemaining] = useState(120);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [onlineParticipants, setOnlineParticipants] = useState<Set<string>>(new Set());
  const [isRecovering, setIsRecovering] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date>();
  
  // Refs for socket and persistence
  const socketRef = useRef<{ socket: Socket; cleanup: () => void } | null>(null);
  const firestoreUnsubscribeRef = useRef<(() => void) | null>(null);
  
  // Add activity to recent activity feed
  const addActivity = useCallback((activity: RealtimeDraftData['recentActivity'][0]) => {
    setRecentActivity(prev => {
      const newActivity = [...prev, activity].slice(-10); // Keep last 10 activities
      return newActivity;
    });
  }, []);
  
  // Initialize draft state from Firestore
  const initializeDraftState = useCallback(async () => {
    try {
      setIsRecovering(true);
      
      // First, try to get the current state from Firestore
      const persistedState = await draftPersistence.getDraftState(draftId);
      
      if (persistedState) {
        setDraftState(persistedState);
        setTimeRemaining(persistedState.timeRemaining);
        setIsTimerActive(persistedState.timerActive);
        setLastSyncTime(new Date());
        
        addActivity({
          id: `recovery-${Date.now()}`,
          type: 'pick',
          message: `Draft state recovered: ${persistedState.picks.length} picks made`,
          timestamp: new Date()
        });
        
        console.log('🔄 Draft state recovered from Firestore:', persistedState);
      }
    } catch (error) {
      console.error('Failed to initialize draft state:', error);
      setConnectionState(prev => ({ 
        ...prev, 
        connectionError: 'Failed to load draft state' 
      }));
    } finally {
      setIsRecovering(false);
    }
  }, [draftId, addActivity]);
  
  // Subscribe to Firestore real-time updates
  const subscribeToFirestoreUpdates = useCallback(() => {
    try {
      const unsubscribe = draftPersistence.subscribeToDraftUpdates(draftId, (updatedState) => {
        setDraftState(updatedState);
        setTimeRemaining(updatedState.timeRemaining);
        setIsTimerActive(updatedState.timerActive);
        setLastSyncTime(new Date());
        
        // Check for new picks
        if (updatedState.picks.length > 0) {
          const latestPick = updatedState.picks[updatedState.picks.length - 1];
          setLastPickMade(latestPick);
          
          addActivity({
            id: `pick-${latestPick.id}`,
            type: 'pick',
            message: `${latestPick.member.displayName} picked ${latestPick.player.name}`,
            timestamp: new Date(),
            participantId: latestPick.member.id
          });
        }
        
        console.log('🔄 Firestore update received:', updatedState);
      });
      
      firestoreUnsubscribeRef.current = unsubscribe;
      console.log('🎧 Subscribed to Firestore real-time updates');
    } catch (error) {
      console.error('Failed to subscribe to Firestore updates:', error);
    }
  }, [draftId, addActivity]);
  
  // Connect to Socket.IO for real-time features
  const connectToSocket = useCallback(() => {
    if (!currentUserId) return;
    
    try {
      setConnectionState(prev => ({ ...prev, reconnecting: true }));
      
      const socketConnection = joinDraft(draftId, {
        onDraftUpdate: (data: DraftUpdateData) => {
          console.log('📡 Socket draft update:', data);
          // Firestore will handle the state update, so we just need to handle UI feedback
        },
        onPickMade: (data: PickMadeData) => {
          console.log('📡 Socket pick made:', data);
          addActivity({
            id: `socket-pick-${data.pick.id}`,
            type: 'pick',
            message: `${data.pick.member.displayName} picked ${data.pick.player.name}`,
            timestamp: new Date(),
            participantId: data.pick.member.id
          });
        },
        onTimerUpdate: (data: TimerUpdateData) => {
          setTimeRemaining(data.timeRemaining);
          setIsTimerActive(data.timeRemaining > 0);
        },
        onParticipantJoin: (data: { socketId: string; timestamp: string }) => {
          setOnlineParticipants(prev => new Set([...prev, data.socketId]));
          addActivity({
            id: `join-${data.socketId}-${Date.now()}`,
            type: 'join',
            message: `Participant joined`,
            timestamp: new Date(),
            participantId: data.socketId
          });
        },
        onParticipantLeave: (participantId: string) => {
          setOnlineParticipants(prev => {
            const updated = new Set(prev);
            updated.delete(participantId);
            return updated;
          });
          addActivity({
            id: `leave-${participantId}-${Date.now()}`,
            type: 'leave',
            message: `Participant left`,
            timestamp: new Date(),
            participantId
          });
        },
        onConnectionChange: (status: ConnectionStatusData) => {
          setConnectionState({
            isConnected: status.connected,
            reconnecting: status.reconnecting,
            lastReconnectAttempt: status.reconnecting ? new Date() : undefined
          });
        },
        onError: (error: Error) => {
          console.error('Socket error:', error);
          setConnectionState(prev => ({
            ...prev,
            connectionError: error.message || 'Connection error'
          }));
        }
      });
      
      socketRef.current = socketConnection;
      console.log('📡 Connected to Socket.IO for real-time updates');
    } catch (error) {
      console.error('Failed to connect to socket:', error);
      setConnectionState(prev => ({
        ...prev,
        reconnecting: false,
        connectionError: 'Failed to connect to real-time server'
      }));
    }
  }, [draftId, currentUserId, addActivity]);
  
  // Make a pick with persistence
  const makePick = useCallback(async (playerId: string) => {
    if (!draftState || !currentUserId) {
      throw new Error('Draft not ready or user not identified');
    }
    
    try {
      const pick: DraftPick = {
        id: `pick-${Date.now()}`,
        overall: draftState.currentPick,
        round: draftState.currentRound,
        slot: draftState.currentTurn + 1,
        player: {
          id: playerId,
          name: `Player ${playerId}`, // This should come from your player data
          position: 'MID',
          club: 'Demo FC'
        },
        member: {
          id: currentUserId,
          displayName: draftState.participants.find(p => p.id === currentUserId)?.displayName || 'Unknown'
        },
        auto: false,
        madeAt: new Date().toISOString(),
        timestamp: serverTimestamp()
      };
      
      // Save to Firestore (this will trigger real-time updates)
      await draftPersistence.savePick(draftId, pick);
      
      // Also broadcast via Socket.IO for immediate feedback
      if (socketRef.current?.socket) {
        socketRef.current.socket.emit('draft:make-pick', {
          draftId,
          playerId,
          memberId: currentUserId,
          timestamp: new Date().toISOString()
        });
      }
      
      addActivity({
        id: `local-pick-${pick.id}`,
        type: 'pick',
        message: `You picked ${pick.player.name}`,
        timestamp: new Date(),
        participantId: currentUserId
      });
      
    } catch (error) {
      console.error('Failed to make pick:', error);
      throw error;
    }
  }, [draftState, currentUserId, draftId, addActivity]);
  
  // Update queue with persistence
  const updateQueue = useCallback(async (queue: string[]) => {
    if (!currentUserId) return;
    
    try {
      // Update in Firestore
      await draftPersistence.updateParticipant(draftId, currentUserId, { queue });
      
      // Also broadcast via Socket.IO
      if (socketRef.current?.socket) {
        socketRef.current.socket.emit('draft:update-queue', {
          draftId,
          memberId: currentUserId,
          queue
        });
      }
      
      addActivity({
        id: `queue-${Date.now()}`,
        type: 'queue_update',
        message: `Updated your queue (${queue.length} players)`,
        timestamp: new Date(),
        participantId: currentUserId
      });
      
    } catch (error) {
      console.error('Failed to update queue:', error);
    }
  }, [draftId, currentUserId, addActivity]);
  
  // Force sync from Firestore
  const forceSync = useCallback(async () => {
    await initializeDraftState();
  }, [initializeDraftState]);
  
  // Reconnect
  const reconnect = useCallback(() => {
    if (socketRef.current?.cleanup) {
      socketRef.current.cleanup();
    }
    connectToSocket();
  }, [connectToSocket]);
  
  // Disconnect
  const disconnect = useCallback(() => {
    if (socketRef.current?.cleanup) {
      socketRef.current.cleanup();
    }
    if (firestoreUnsubscribeRef.current) {
      firestoreUnsubscribeRef.current();
    }
    if (currentUserId) {
      draftPersistence.markParticipantOffline(draftId, currentUserId);
    }
  }, [draftId, currentUserId]);
  
  // Pause/Resume draft
  const pauseDraft = useCallback(async () => {
    // Implementation depends on your draft control logic
    console.log('Pause draft functionality to be implemented');
  }, []);
  
  const resumeDraft = useCallback(async () => {
    // Implementation depends on your draft control logic
    console.log('Resume draft functionality to be implemented');
  }, []);
  
  // Initialize on mount
  useEffect(() => {
    if (autoConnect && draftId) {
      initializeDraftState();
      subscribeToFirestoreUpdates();
      
      if (currentUserId) {
        connectToSocket();
      }
    }
    
    return () => {
      disconnect();
    };
  }, [autoConnect, draftId, currentUserId, initializeDraftState, subscribeToFirestoreUpdates, connectToSocket, disconnect]);
  
  // Mark participant as online when they join
  useEffect(() => {
    if (currentUserId && draftState) {
      draftPersistence.updateParticipant(draftId, currentUserId, { isOnline: true });
    }
  }, [currentUserId, draftState, draftId]);
  
  return {
    // Data
    draftState,
    connectionState,
    lastPickMade,
    recentActivity,
    timeRemaining,
    isTimerActive,
    onlineParticipants,
    isRecovering,
    lastSyncTime,
    
    // Actions
    makePick,
    updateQueue,
    reconnect,
    disconnect,
    forceSync,
    pauseDraft,
    resumeDraft
  };
}
