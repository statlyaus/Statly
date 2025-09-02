'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { logger } from '@/lib/logger';
import type { ConnectionState, DraftEvent } from '@/types/draft';

interface RealtimeConnection {
  emit: (event: import('@/types/draft').DraftEvent['type'], data: any) => void;
  on: (event: import('@/types/draft').DraftEvent['type'], callback: (data: any) => void) => void;
  off: (event: import('@/types/draft').DraftEvent['type'], callback: (data: any) => void) => void;
  disconnect: () => void;
  reconnect: () => void;
}

interface UseRealtimeConnectionOptions {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

export function useRealtimeConnection(
  draftId: string,
  userId: string,
  options: UseRealtimeConnectionOptions = {}
) {
  const {
    autoReconnect = true,
    maxReconnectAttempts = 5,
    reconnectDelay = 1000,
    heartbeatInterval = 30000,
  } = options;

  // State
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'disconnected',
    reconnectAttempts: 0,
    latency: 0,
  });

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const eventListenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const lastHeartbeatRef = useRef<number>(Date.now());

  // Connection URL
  const wsUrl = useMemo(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = process.env.NEXT_PUBLIC_WS_HOST || window.location.host;
    return `${protocol}//${host}/draft/${draftId}?userId=${userId}`;
  }, [draftId, userId]);

  // Initialize WebSocket connection
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      logger.info('Connecting to draft WebSocket', { draftId, userId, url: wsUrl });

      setConnection((prev) => ({ ...prev, status: 'connecting' }));

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Connection opened
      ws.onopen = () => {
        logger.info('WebSocket connected', { draftId, userId });
        setConnection((prev) => ({
          ...prev,
          status: 'connected',
          reconnectAttempts: 0,
          error: undefined,
        }));

        // Start heartbeat
        startHeartbeat();
      };

      // Connection closed
      ws.onclose = (event) => {
        logger.info('WebSocket disconnected', {
          draftId,
          userId,
          code: event.code,
          reason: event.reason,
        });
        setConnection((prev) => ({ ...prev, status: 'disconnected' }));

        stopHeartbeat();

        // Attempt reconnect if auto-reconnect is enabled
        if (autoReconnect) {
          // Use functional updater to avoid stale closure
          setConnection((prev) => {
            if (prev.reconnectAttempts < maxReconnectAttempts) {
              scheduleReconnect(prev.reconnectAttempts);
              return { ...prev, reconnectAttempts: prev.reconnectAttempts + 1 };
            }
            return prev;
          });
        }
      };

      // Connection error
      ws.onerror = (error) => {
        logger.error('WebSocket error', { draftId, userId, error });
        setConnection((prev) => ({
          ...prev,
          status: 'disconnected',
          error: 'Connection failed',
        }));
      };

      // Message received
      ws.onmessage = (event) => {
        try {
          const message: DraftEvent = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          logger.error('Failed to parse WebSocket message', { draftId, error, data: event.data });
        }
      };
    } catch (error) {
      logger.error('Failed to create WebSocket connection', { draftId, userId, error });
      setConnection((prev) => ({
        ...prev,
        status: 'disconnected',
        error: 'Failed to create connection',
      }));
    }
  }, [draftId, userId, wsUrl, autoReconnect, maxReconnectAttempts, connection.reconnectAttempts]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'User initiated disconnect');
      wsRef.current = null;
    }

    setConnection((prev) => ({ ...prev, status: 'disconnected' }));
  }, []);

  // Reconnect
  const reconnect = useCallback(() => {
    if (connection.status === 'connected') {
      return;
    }

    logger.info('Attempting to reconnect', {
      draftId,
      userId,
      attempt: connection.reconnectAttempts + 1,
    });

    setConnection((prev) => ({
      ...prev,
      status: 'reconnecting',
      reconnectAttempts: prev.reconnectAttempts + 1,
    }));

    disconnect();
    connect();
  }, [draftId, userId, connection.status, connection.reconnectAttempts, disconnect, connect]);

  // Schedule reconnect
  const scheduleReconnect = useCallback(
    (attempts: number) => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      const delay = Math.min(reconnectDelay * Math.pow(2, attempts), 30000);

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnect();
      }, delay);
    },
    [reconnectDelay, reconnect]
  );

  // Start heartbeat
  const startHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const timestamp = Date.now();
        wsRef.current.send(
          JSON.stringify({
            type: 'ping',
            timestamp,
            draftId,
            userId,
          })
        );
        lastHeartbeatRef.current = timestamp;
      }
    }, heartbeatInterval);
  }, [heartbeatInterval, draftId, userId]);

  // Stop heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((message: DraftEvent) => {
    const { type, data } = message;

    // Handle heartbeat response
    if (type === 'pong') {
      const latency = Date.now() - lastHeartbeatRef.current;
      setConnection((prev) => ({ ...prev, latency }));
      return;
    }

    // Emit to event listeners
    const listeners = eventListenersRef.current.get(type);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          logger.error('Error in event listener', { type, error });
        }
      });
    }
  }, []);

  // Event emitter interface
  const realtime: RealtimeConnection = useMemo(
    () => ({
      emit: (event, data: any) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const message: DraftEvent = {
            type: event,
            data,
            timestamp: new Date(),
            draftId,
          };
          wsRef.current.send(JSON.stringify(message));
        } else {
          logger.warn('Cannot emit event: WebSocket not connected', { event, draftId });
        }
      },

      on: (event, callback: (data: any) => void) => {
        if (!eventListenersRef.current.has(event)) {
          eventListenersRef.current.set(event, new Set());
        }
        eventListenersRef.current.get(event)!.add(callback);
      },

      off: (event, callback: (data: any) => void) => {
        const listeners = eventListenersRef.current.get(event);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            eventListenersRef.current.delete(event);
          }
        }
      },

      disconnect,
      reconnect,
    }),
    [disconnect, reconnect, draftId]
  );

  // Connect on mount and cleanup on unmount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connection,
    realtime,
    connect,
    disconnect,
    reconnect,
  };
}
