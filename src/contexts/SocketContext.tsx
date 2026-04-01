'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { io, type Socket } from 'socket.io-client';

import { socketIOConfig } from '@/lib/socketioConfig';

type SocketCtx = { socket: Socket | null };
const Ctx = createContext<SocketCtx>({ socket: null });

export function SocketProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let s: Socket | null = null;

    async function resolveSocketTarget(): Promise<{ url: string; path: string }> {
      const browserOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const browserHost = typeof window !== 'undefined' ? window.location.hostname : '';
      const explicitClientUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim() || '';

      // Otherwise, ask the API route for the live socket server details.
      try {
        const res = await fetch('/api/socketio', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as {
            socket?: { port?: number; path?: string; url?: string };
          };
          const configuredUrl = data?.socket?.url?.trim();
          const port = data?.socket?.port;
          const path = data?.socket?.path || '/socket.io';

          if (configuredUrl) {
            return { url: configuredUrl, path };
          }

          if (typeof port === 'number' && Number.isFinite(port) && port > 0 && browserHost) {
            const url = `${window.location.protocol}//${browserHost}:${port}`;
            return { url, path };
          }

          return { url: browserOrigin, path };
        }
      } catch {
        // Fall through to safe defaults below.
      }

      // Explicit client URL remains as a fallback for legacy environments.
      if (explicitClientUrl) {
        return { url: explicitClientUrl, path: '/socket.io' };
      }

      // Final fallback: same-origin Socket.IO endpoint assumptions.
      return { url: browserOrigin, path: '/socket.io' };
    }

    void (async () => {
      const target = await resolveSocketTarget();
      if (cancelled) return;

      s = io(target.url, {
        transports: socketIOConfig.client.transports,
        path: target.path,
        // Keep cross-origin handshake compatible with wildcard CORS on socket sidecar.
        withCredentials: false,
        timeout: socketIOConfig.client.timeout,
        reconnection: socketIOConfig.client.reconnection,
        reconnectionAttempts: socketIOConfig.client.reconnectionAttempts,
        reconnectionDelay: socketIOConfig.client.reconnectionDelay,
        reconnectionDelayMax: socketIOConfig.client.reconnectionDelayMax,
      });

      const onConnectError = (err: Error) => {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[socket] connect_error:', err?.message || err);
        }
      };
      const onError = (err: unknown) => {
        if (process.env.NODE_ENV !== 'production') {
          const e = err as Error | undefined;
          console.error('[socket] error:', e?.message || err);
        }
      };
      const onDisconnect = (reason: string) => {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[socket] disconnected:', reason);
        }
      };

      s.on('connect_error', onConnectError);
      s.on('error', onError);
      s.on('disconnect', onDisconnect);

      setSocket(s);
    })();

    return () => {
      cancelled = true;
      try {
        if (s) {
          s.removeAllListeners();
        }
      } catch (e) {
        // Ignore cleanup errors in dev to avoid noisy logs
        void e;
      }
      s?.disconnect();
    };
  }, []);

  const value = useMemo(() => ({ socket }), [socket]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(Ctx).socket;
}
