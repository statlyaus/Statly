'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as Sentry from '@sentry/react';

interface Props {
  uid: string;
  children: ReactNode;
}

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ uid, children }: Props) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io('/', {
      auth: { uid },
      transports: ['websocket'],
      reconnection: true,
    });
    setSocket(s);

    s.on('connect_error', (err) => {
      Sentry.captureException(err);
    });

    s.on('error', (err) => {
      Sentry.captureException(err);
    });

    s.on('disconnect', (reason) => {
      Sentry.captureException(new Error(`Socket disconnected: ${reason}`));
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        s.close();
      } else if (!s.connected) {
        s.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      s.disconnect();
      setSocket(null);
    };
  }, [uid]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
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
