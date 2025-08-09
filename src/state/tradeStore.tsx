// src/state/tradeStore.ts
'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Player } from '@/types';

type Side = 'incoming' | 'outgoing';

export interface TradeContextValue {
  incoming: Player[];
  outgoing: Player[];
  add: (side: Side, p: Player) => void;
  remove: (side: Side, id: string) => void;
  clearAll: () => void;
}

const TradeCtx = createContext<TradeContextValue | null>(null);

export function TradeStoreProvider({ children }: { children: ReactNode }) {
  const [incoming, setIncoming] = useState<Player[]>([]);
  const [outgoing, setOutgoing] = useState<Player[]>([]);

  const add = useCallback((side: Side, p: Player) => {
    const set = side === 'incoming' ? setIncoming : setOutgoing;
    set((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
  }, []);

  const remove = useCallback((side: Side, id: string) => {
    const set = side === 'incoming' ? setIncoming : setOutgoing;
    set((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setIncoming([]);
    setOutgoing([]);
  }, []);

  const value = useMemo(
    () => ({ incoming, outgoing, add, remove, clearAll }),
    [incoming, outgoing, add, remove, clearAll]
  );

  return <TradeCtx.Provider value={value}>{children}</TradeCtx.Provider>;
}

export function useTradeStore(): TradeContextValue {
  const ctx = useContext(TradeCtx);
  if (!ctx) throw new Error('useTradeStore must be used within <TradeStoreProvider>');
  return ctx;
}