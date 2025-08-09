// src/state/tradeStore.ts
'use client';
import { create } from 'zustand';
import type { Player } from '@/types';

type Side = 'incoming' | 'outgoing';
type Filters = Record<string, number | undefined>;

type TradeState = {
  outgoing: Player[];
  incoming: Player[];
  watchlist: Set<string>;
  filters: Filters;
  sort: { key: string; dir: 'asc' | 'desc' };
  add: (side: Side, p: Player) => void;
  remove: (side: Side, id: string) => void;
  toggleWatch: (id: string) => void;
  setFilters: (f: Filters) => void;
  setSort: (key: string, dir: 'asc' | 'desc') => void;
  clearAll: () => void;
};

export const useTradeStore = create<TradeState>((set) => ({
  outgoing: [],
  incoming: [],
  watchlist: new Set(),
  filters: {},
  sort: { key: 'kicks', dir: 'asc' },
  add: (side, p) => set((s) => ({ [side]: uniqById([...s[side], p]) } as any)),
  remove: (side, id) => set((s) => ({ [side]: s[side].filter(x => x.id !== id) } as any)),
  toggleWatch: (id) => set((s) => {
    const w = new Set(s.watchlist);
    w.has(id) ? w.delete(id) : w.add(id);
    return { watchlist: w };
  }),
  setFilters: (f) => set({ filters: f }),
  setSort: (key, dir) => set({ sort: { key, dir } }),
  clearAll: () => set({ outgoing: [], incoming: [], filters: {} }),
}));

function uniqById<T extends { id: string }>(arr: T[]) {
  const seen = new Set<string>();
  return arr.filter((x) => !seen.has(x.id) && seen.add(x.id));
}