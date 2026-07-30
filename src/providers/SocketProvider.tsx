'use client';

import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

import { isDevelopmentAuthEnabled } from '@/lib/devAuth';
import { auth } from '@/lib/firebase/clientAuth';
import { captureException } from '@/lib/sentry-utils';

interface Props {
  uid: string;
  children: ReactNode;
}

const SocketContext = createContext<Socket | null>(null);
const SOCKET_AUTH_RETRY_DELAY_MS = 250;
const SOCKET_AUTH_RETRY_ATTEMPTS = 16;

function isSocketDisabled(): boolean {
  return process.env.NEXT_PUBLIC_SOCKET_DISABLED === 'true';
}

export async function resolveSocketAuthToken(uid: string): Promise<string | null> {
  if (isDevelopmentAuthEnabled()) {
    return `dev:${uid}`;
  }

  const currentUser = auth?.currentUser;
  if (currentUser) {
    return currentUser.getIdToken();
  }

  return null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function resolveSocketAuthTokenWithRetry(
  uid: string,
  isCancelled: () => boolean
): Promise<string | null> {
  for (let attempt = 0; attempt < SOCKET_AUTH_RETRY_ATTEMPTS; attempt += 1) {
    if (isCancelled()) return null;

    const token = await resolveSocketAuthToken(uid);
    if (token || isCancelled()) return token;

    await wait(SOCKET_AUTH_RETRY_DELAY_MS);
  }

  return resolveSocketAuthToken(uid);
}

export function SocketProvider({ uid, children }: Props): React.JSX.Element {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (isSocketDisabled()) {
      setSocket(null);
      return;
    }

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3002';
    let cancelled = false;
    let activeSocket: Socket | null = null;
    let removeVisibilityListener: (() => void) | null = null;

    const connectSocket = async () => {
      try {
        const token = await resolveSocketAuthTokenWithRetry(uid, () => cancelled);
        if (cancelled) {
          return;
        }

        if (!token) {
          captureException(new Error('Socket auth token unavailable'));
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
          captureException(err);
        });

        s.on('error', (err) => {
          captureException(err);
        });

        s.on('disconnect', (reason) => {
          captureException(new Error(`Socket disconnected: ${reason}`));
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
        captureException(err);
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
