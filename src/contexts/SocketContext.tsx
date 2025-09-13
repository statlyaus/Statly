'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { io, type Socket } from 'socket.io-client';

import { socketIOConfig } from '@/lib/socketioConfig';

type SocketCtx = { socket: Socket | null };
const Ctx = createContext<SocketCtx>({ socket: null });

export function SocketProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Prefer centralized config, with safe fallback to current origin in browser
    const configuredUrl = socketIOConfig.client.url;
    const url = configuredUrl || (typeof window !== 'undefined' ? window.location.origin : '');

    const s = io(url, {
      // Use the same transports as config to avoid mismatches
      transports: socketIOConfig.client.transports,
      // Keep default Socket.IO path unless server uses a custom one
      path: '/socket.io',
      withCredentials: true,
      timeout: socketIOConfig.client.timeout,
      reconnection: socketIOConfig.client.reconnection,
      reconnectionAttempts: socketIOConfig.client.reconnectionAttempts,
      reconnectionDelay: socketIOConfig.client.reconnectionDelay,
      reconnectionDelayMax: socketIOConfig.client.reconnectionDelayMax,
    });

    const onConnectError = (err: Error) => {
      // Lightweight console log to aid debugging in dev
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
    return () => {
      try {
        s.off('connect_error', onConnectError);
        s.off('error', onError);
        s.off('disconnect', onDisconnect);
        s.removeAllListeners();
      } catch (e) {
        // Ignore cleanup errors in dev to avoid noisy logs
        void e;
      }
      s.disconnect();
    };
  }, []);

  const value = useMemo(() => ({ socket }), [socket]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(Ctx).socket;
}
