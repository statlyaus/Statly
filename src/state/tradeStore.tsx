// src/state/tradeStore.ts
'use client';

import { create } from 'zustand';
import type { Player } from '@/types';

export type Side = 'incoming' | 'outgoing';

export interface TradeState {
  incoming: Player[];
  outgoing: Player[];
  add: (side: Side, p: Player) => void;
  remove: (side: Side, id: string) => void;
  clearAll: () => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  incoming: [],
  outgoing: [],
  add: (side, p) =>
    set((state) => {
      // avoid duplicates by id
      const exists = state[side].some((x) => x.id === p.id);
      return exists ? state : { ...state, [side]: [...state[side], p] };
    }),
  remove: (side, id) =>
    set((state) => ({
      ...state,
      [side]: state[side].filter((x) => x.id !== id),
    })),
  clearAll: () => set({ incoming: [], outgoing: [] }),
}));