// src/contexts/SocketContext.tsx
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type SocketCtx = { socket: Socket | null; isConnected: boolean };

const SocketContext = createContext<SocketCtx>({ socket: null, isConnected: false });

declare global {
  // keep a single client across HMR/page switches
  // eslint-disable-next-line no-var
  var __statly_socket__: Socket | undefined;
}

function getOrCreateSocket(): Socket | undefined {
  if (typeof window === 'undefined') return undefined;
  if (!globalThis.__statly_socket__) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL; // optional; same-origin if undefined
    globalThis.__statly_socket__ = io(url ?? undefined, {
      withCredentials: true,
      transports: ['websocket'],
    });
  }
  return globalThis.__statly_socket__;
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const s = getOrCreateSocket();
    if (!s) return;

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    setSocket(s);
    setIsConnected(s.connected);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      // don't close s; we want the singleton to live across pages/HMR
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}