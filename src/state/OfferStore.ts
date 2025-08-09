'use client';
import { create } from 'zustand';
import type { Player } from '@/types';

export type OfferSide = 'yours' | 'theirs';

export type OfferPlayer = Pick<Player, 'id' | 'name' | 'team' | 'position'> & {
  stats?: Record<string, number | string>;
};

type OfferState = {
  yours: OfferPlayer[];
  theirs: OfferPlayer[];
  shortlist: OfferPlayer[]; // optional
  add: (side: OfferSide, p: OfferPlayer) => void;
  remove: (side: OfferSide, id: string) => void;
  toggleShortlist: (p: OfferPlayer) => void;
  clearOffer: () => void;
};

export const useOfferStore = create<OfferState>((set) => ({
  yours: [],
  theirs: [],
  shortlist: [],
  add: (side, p) =>
    set((s) => {
      const list = side === 'yours' ? s.yours : s.theirs;
      if (list.some(x => x.id === p.id)) return s;
      return { ...s, [side]: [...list, p] };
    }),
  remove: (side, id) =>
    set((s) => ({ ...s, [side]: (side === 'yours' ? s.yours : s.theirs).filter(p => p.id !== id) })),
  toggleShortlist: (p) =>
    set((s) =>
      s.shortlist.some(x => x.id === p.id)
        ? { ...s, shortlist: s.shortlist.filter(x => x.id !== p.id) }
        : { ...s, shortlist: [...s.shortlist, p] }
    ),
  clearOffer: () => set({ yours: [], theirs: [] }),
}));