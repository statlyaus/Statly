'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

type SocketCtx = {
  socket: Socket | null;
  status: ConnectionStatus;
};

const Ctx = createContext<SocketCtx | null>(null);

// Reuse a single socket across HMR / route transitions in dev
declare global {
   
  var __statly_socket__: Socket | undefined;
}

function resolveSocketUrl(): string {
  // 1) Prefer explicit env (works for prod and dev)
  const fromEnv = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (fromEnv) return fromEnv;

  // 2) Fallback: same host, port 3101 (matches our Socket.IO server)
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    const port = process.env.NEXT_PUBLIC_SOCKET_PORT?.trim() || '3101';
    return `${protocol}//${hostname}:${port}`;
  }

  // SSR path (won't be used since this is a client component)
  return '';
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [socket, setSocket] = useState<Socket | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    let s: Socket | undefined = globalThis.__statly_socket__;

    if (!s) {
      const url = resolveSocketUrl();
      s = io(url, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true,
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
      });
      globalThis.__statly_socket__ = s;
    }

    const handleConnect = () => setStatus('connected');
    const handleDisconnect = () => setStatus('disconnected');
    const handleReconnecting = () => setStatus('reconnecting');

    s.on('connect', handleConnect);
    s.on('disconnect', handleDisconnect);
    s.io?.on?.('reconnect_attempt', handleReconnecting);

    setSocket(s);

    return () => {
      // Keep the socket for reuse; just remove listeners we attached
      s?.off('connect', handleConnect);
      s?.off('disconnect', handleDisconnect);
      s?.io?.off?.('reconnect_attempt', handleReconnecting);
      mounted.current = false;
    };
  }, []);

  const value = useMemo<SocketCtx>(() => ({ socket, status }), [socket, status]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket(): Socket | null {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSocket must be used within a SocketProvider');
  return ctx.socket;
}

export function useSocketStatus(): ConnectionStatus {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSocketStatus must be used within a SocketProvider');
  return ctx.status;
}
