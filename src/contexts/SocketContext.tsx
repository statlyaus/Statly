'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type SocketCtx = { socket: Socket | null };
const Ctx = createContext<SocketCtx>({ socket: null });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || '';
    const s = io(url, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  const value = useMemo(() => ({ socket }), [socket]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket() {
  return useContext(Ctx).socket;
}
