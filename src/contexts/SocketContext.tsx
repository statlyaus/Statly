'use client';
import React, {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
type SocketLike = { on:(e:string,cb:(...a:any[])=>void)=>void; off:(e:string,cb:(...a:any[])=>void)=>void; emit:(e:string,...a:any[])=>void; connected:boolean; disconnect:()=>void; };
const Ctx = createContext<SocketLike|null>(null);

export function SocketProvider({ children }: {children: React.ReactNode}) {
  const [io,setIo]=useState<any>(null);
  const sockRef = useRef<SocketLike|null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { io: ioClient } = await import('socket.io-client');
      // Same-origin Socket.IO endpoint (works on Vercel/Next API route)
      const s: SocketLike = ioClient('/api/socketio', { path: '/api/socketio' });
      if (!active) return;
      sockRef.current = s;
      setIo(s);
    })();
    return () => {
      active = false;
      try { sockRef.current?.disconnect(); } catch {}
      sockRef.current = null;
    };
  }, []);

  const value = useMemo(()=>io, [io]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocket() {
  return useContext(Ctx);
}
