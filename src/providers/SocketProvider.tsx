'use client';

import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as Sentry from '@sentry/react';

import { auth } from '@/lib/firebaseClient';

interface Props {
  uid: string;
  children: ReactNode;
}

const SocketContext = createContext<Socket | null>(null);

async function resolveSocketAuthToken(uid: string): Promise<string | null> {
  const currentUser = auth?.currentUser;
  if (currentUser) {
    return currentUser.getIdToken();
  }

  if (process.env.NODE_ENV !== 'production') {
    return `dev:${uid}`;
  }

  return null;
}

export function SocketProvider({ uid, children }: Props): React.JSX.Element {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002';
    let cancelled = false;
    let activeSocket: Socket | null = null;
    let removeVisibilityListener: (() => void) | null = null;

    const connectSocket = async () => {
      try {
        const token = await resolveSocketAuthToken(uid);
        if (cancelled) {
          return;
        }

        if (!token) {
          Sentry.captureException(new Error('Socket auth token unavailable'));
          return;
        }

        const s = io(socketUrl, {
          auth: { token },
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        activeSocket = s;
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
        removeVisibilityListener = () => {
          document.removeEventListener('visibilitychange', handleVisibility);
        };
      } catch (err) {
        Sentry.captureException(err);
      }
    };

    void connectSocket();

    return () => {
      cancelled = true;
      removeVisibilityListener?.();
      activeSocket?.disconnect();
      setSocket(null);
    };
  }, [uid]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}

export function useSocketChannel<T>(channel: string, handler: (data: T) => void): void {
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    socket.on(channel, handler);
    return () => {
      socket.off(channel, handler);
    };
  }, [socket, channel, handler]);
}
