/**
 * Live Draft React Hook
 * Client-side integration with the Live Draft Engine
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { io, type Socket } from 'socket.io-client';
import { logger } from '@/lib/logger';

export interface LiveDraftState {
  draftId: string;
  leagueId: string;
  status: 'SCHEDULED' | 'LOBBY' | 'COUNTDOWN' | 'LIVE' | 'PAUSED' | 'COMPLETED';
  currentPick: {
    userId: string;
    pickNumber: number;
    round: number;
    slot: number;
    expiresAt: string;
    timeRemaining: number;
  };
  picks: Array<{
    playerId: string;
    userId: string;
    pickNumber: number;
    round: number;
    slot: number;
    auto: boolean;
    timestamp: string;
  }>;
  participants: Array<{
    userId: string;
    displayName: string;
    draftOrder: number;
    isOnline: boolean;
    queueSize: number;
  }>;
  settings: {
    totalRounds: number;
    totalTeams: number;
    draftType: 'SNAKE' | 'LINEAR';
    pickTimeLimit: number;
  };
  timerSettings: {
    durationSeconds: number;
    autopickAfterExpiry: boolean;
  };
  paused: boolean;
  progress: {
    totalPicks: number;
    completedPicks: number;
    remainingPicks: number;
    percentComplete: number;
  };
  updatedAt: string;
}

export interface UseLiveDraftOptions {
  draftId: string;
  userId: string;
  authToken?: string;
  autoReconnect?: boolean;
  onError?: (error: string) => void;
  onPickMade?: (pick: {
    id: string;
    overall: number;
    player: { id: string; name: string };
    member: { id: string; displayName: string };
  }) => void;
  onDraftCompleted?: () => void;
}

export interface LiveDraftActions {
  makePick: (playerId: string) => Promise<void>;
  updateQueue: (queue: string[]) => Promise<void>;
  pauseDraft: () => Promise<void>;
  resumeDraft: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => void;
}

export interface UseLiveDraftReturn {
  // State
  draftState: LiveDraftState | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  
  // Timer state
  timeRemaining: number;
  isMyTurn: boolean;
  canMakePick: boolean;
  
  // Actions
  actions: LiveDraftActions;
  
  // Status
  connectionHealth: {
    connected: boolean;
    reconnectAttempts: number;
    lastHeartbeat: Date | null;
    latency: number;
  };
}

export function useLiveDraft(options: UseLiveDraftOptions): UseLiveDraftReturn {
  const { draftId, userId, authToken, autoReconnect = true, onError, onPickMade, onDraftCompleted } = options;
  
  // Core state
  const [draftState, setDraftState] = useState<LiveDraftState | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  
  // Connection health tracking
  const [connectionHealth, setConnectionHealth] = useState({
    connected: false,
    reconnectAttempts: 0,
    lastHeartbeat: null as Date | null,
    latency: 0,
  });
  
  // Refs for stable references
  const socketRef = useRef<Socket | null>(null);
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  
  // Computed state
  const isMyTurn = draftState?.currentPick?.userId === userId;
  const canMakePick = connected && draftState?.status === 'LIVE' && !draftState?.paused && isMyTurn;
  
  // Initialize socket connection
  const initializeSocket = useCallback(() => {
    if (socketRef.current?.connected) {
      return socketRef.current;
    }

    logger.debug('Initializing live draft socket', { draftId, userId });

    const socket = io('/draft', {
      auth: {
        userId,
        draftId,
        token: authToken,
      },
      transports: ['websocket', 'polling'],
      timeout: 10000,
      retries: 3,
    });

    // Connection events
    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      setConnectionHealth(prev => ({
        ...prev,
        connected: true,
        reconnectAttempts: 0,
      }));
      logger.info('Live draft socket connected', { draftId, userId });
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      setConnectionHealth(prev => ({ ...prev, connected: false }));
      logger.warn('Live draft socket disconnected', { draftId, userId, reason });
      
      if (autoReconnect && reason === 'io server disconnect') {
        // Server initiated disconnect, attempt reconnect
        setTimeout(() => {
          if (reconnectTimeout.current) {
            clearTimeout(reconnectTimeout.current);
          }
          const delay = Math.min(1000 * Math.pow(2, connectionHealth.reconnectAttempts), 30000);
          reconnectTimeout.current = setTimeout(() => {
            logger.info('Attempting to reconnect live draft socket', { draftId, attempt: connectionHealth.reconnectAttempts + 1 });
            initializeSocket();
          }, delay);
        }, 1000);
      }
    });

    socket.on('connect_error', (error) => {
      const errorMessage = error.message || 'Connection failed';
      setError(errorMessage);
      setConnected(false);
      setConnectionHealth(prev => ({
        ...prev,
        connected: false,
        reconnectAttempts: prev.reconnectAttempts + 1,
      }));
      
      logger.error('Live draft socket connection error', { draftId, userId, error: errorMessage });
      onError?.(errorMessage);
      
      if (autoReconnect) {
        scheduleReconnect();
      }
    });

    // Draft events
    socket.on('draft:state', (state: LiveDraftState) => {
      setDraftState(state);
      setTimeRemaining(state.currentPick.timeRemaining);
      setLoading(false);
      logger.debug('Draft state updated', { draftId, status: state.status });
    });

    socket.on('draft:timer-tick', (data: { timeRemaining: number }) => {
      setTimeRemaining(data.timeRemaining);
    });

    socket.on('draft:timer-expired', () => {
      logger.info('Draft timer expired', { draftId });
      setTimeRemaining(0);
    });

    socket.on('draft:pick-made', (pick) => {
      logger.info('Pick made in draft', { draftId, pickNumber: pick.overall });
      onPickMade?.(pick);
    });

    socket.on('draft:auto-pick', (pick) => {
      logger.info('Auto-pick made in draft', { draftId, pickNumber: pick.overall });
      onPickMade?.(pick);
    });

    socket.on('draft:completed', () => {
      logger.info('Draft completed', { draftId });
      onDraftCompleted?.();
    });

    socket.on('draft:paused', () => {
      logger.info('Draft paused', { draftId });
    });

    socket.on('draft:resumed', () => {
      logger.info('Draft resumed', { draftId });
    });

    // Error events
    socket.on('draft:pick-error', (error: { message: string }) => {
      setError(error.message);
      logger.error('Pick error', { draftId, error: error.message });
      onError?.(error.message);
    });

    socket.on('draft:queue-error', (error: { message: string }) => {
      setError(error.message);
      logger.error('Queue error', { draftId, error: error.message });
      onError?.(error.message);
    });

    socket.on('error', (error: { message: string }) => {
      const errorMessage = error.message || 'Unknown socket error';
      setError(errorMessage);
      logger.error('Socket error', { draftId, error: errorMessage });
      onError?.(errorMessage);
    });

    // Heartbeat for connection health
    socket.on('draft:pong', (data: { timestamp: number }) => {
      const latency = Date.now() - data.timestamp;
      setConnectionHealth(prev => ({
        ...prev,
        lastHeartbeat: new Date(),
        latency,
      }));
    });

    socketRef.current = socket;
    return socket;
  }, [draftId, userId, authToken, autoReconnect, onError, onPickMade, onDraftCompleted]);

  // Schedule reconnection attempt
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }

    const delay = Math.min(1000 * Math.pow(2, connectionHealth.reconnectAttempts), 30000); // Max 30s
    
    reconnectTimeout.current = setTimeout(() => {
      logger.info('Attempting to reconnect live draft socket', { draftId, attempt: connectionHealth.reconnectAttempts + 1 });
      initializeSocket();
    }, delay);
  }, [connectionHealth.reconnectAttempts, draftId, initializeSocket]);

  // Initialize heartbeat
  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
    }

    heartbeatInterval.current = setInterval(() => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('draft:ping');
      }
    }, 30000); // Every 30 seconds
  }, []);

  // Actions
  const actions: LiveDraftActions = {
    makePick: async (playerId: string) => {
      if (!socketRef.current?.connected) {
        throw new Error('Not connected to draft');
      }
      
      if (!canMakePick) {
        throw new Error('Cannot make pick at this time');
      }

      setError(null);
      socketRef.current.emit('draft:make-pick', { playerId });
    },

    updateQueue: async (queue: string[]) => {
      if (!socketRef.current?.connected) {
        throw new Error('Not connected to draft');
      }

      setError(null);
      socketRef.current.emit('draft:update-queue', { queue });
    },

    pauseDraft: async () => {
      if (!socketRef.current?.connected) {
        throw new Error('Not connected to draft');
      }

      setError(null);
      socketRef.current.emit('draft:pause');
    },

    resumeDraft: async () => {
      if (!socketRef.current?.connected) {
        throw new Error('Not connected to draft');
      }

      setError(null);
      socketRef.current.emit('draft:resume');
    },

    disconnect: () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setConnected(false);
    },

    reconnect: () => {
      actions.disconnect();
      initializeSocket();
    },
  };

  // Initialize on mount
  useEffect(() => {
    const socket = initializeSocket();
    startHeartbeat();

    return () => {
      actions.disconnect();
    };
  }, [initializeSocket, startHeartbeat, actions]);

  // Clear error after 10 seconds
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => setError(null), 10000);
      return () => clearTimeout(timeout);
    }
  }, [error]);

  return {
    // State
    draftState,
    connected,
    loading,
    error,
    
    // Timer state
    timeRemaining,
    isMyTurn,
    canMakePick,
    
    // Actions
    actions,
    
    // Status
    connectionHealth,
  };
}

export default useLiveDraft;
