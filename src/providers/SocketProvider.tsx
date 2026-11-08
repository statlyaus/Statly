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
// Socket.IO retries transport failures itself; report only a connection that keeps failing.
const SOCKET_FAILURES_BEFORE_REPORT = 5;

function isSocketDisabled(): boolean {
  return process.env.NEXT_PUBLIC_SOCKET_DISABLED === 'true';
}

export async function resolveSocketAuthToken(
  uid: string,
  forceRefresh = false
): Promise<string | null> {
  if (isDevelopmentAuthEnabled()) {
    return `dev:${uid}`;
  }

  const currentUser = auth?.currentUser;
  if (currentUser) {
    return forceRefresh ? currentUser.getIdToken(true) : currentUser.getIdToken();
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

        let forceTokenRefresh = false;
        let refreshedAfterRejection = false;
        let consecutiveFailures = 0;
        let failureReported = false;
        const reportPersistentFailure = (err: unknown) => {
          if (failureReported) return;
          failureReported = true;
          captureException(err);
        };

        // A callback, not a fixed value: Socket.IO calls it on every (re)connect, so a reconnect
        // after the first ID token expired (one hour) sends a current token.
        const s = io(socketUrl, {
          auth: (cb) => {
            const forceRefresh = forceTokenRefresh;
            forceTokenRefresh = false;
            resolveSocketAuthToken(uid, forceRefresh)
              .then((freshToken) => cb({ token: freshToken }))
              .catch(() => cb({ token: null }));
          },
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        activeSocket = s;
        setSocket(s);

        s.on('connect', () => {
          consecutiveFailures = 0;
          refreshedAfterRejection = false;
          failureReported = false;
        });

        s.on('connect_error', (err) => {
          if (!s.active) {
            // The server refused the handshake (authentication). Socket.IO does not retry that,
            // so refresh the token and try once more before reporting it.
            if (!refreshedAfterRejection) {
              refreshedAfterRejection = true;
              forceTokenRefresh = true;
              s.connect();
              return;
            }
            reportPersistentFailure(err);
            return;
          }

          consecutiveFailures += 1;
          if (consecutiveFailures >= SOCKET_FAILURES_BEFORE_REPORT) {
            reportPersistentFailure(err);
          }
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
