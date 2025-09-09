'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import * as Sentry from '@sentry/react';

interface Props {
  uid: string;
  children: ReactNode;
}

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ uid, children }: Props) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io('/', {
      auth: { uid },
      transports: ['websocket'],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect_error', (err) => {
      Sentry.captureException(err);
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        socket.close();
      } else if (!socket.connected) {
        socket.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      socket.disconnect();
    };
  }, [uid]);

  return <SocketContext.Provider value={socketRef.current}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}

export function useSocketChannel<T>(channel: string, handler: (data: T) => void) {
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    socket.on(channel, handler);
    return () => {
      socket.off(channel, handler);
    };
  }, [socket, channel, handler]);
}
