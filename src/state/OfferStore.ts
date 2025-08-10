'use client';
import { create } from 'zustand';
import type { Player } from '@/types/players';
import { createPlayerStore, type PlayerStore } from './createPlayerStore';

export type OfferSide = 'yours' | 'theirs';

export type OfferPlayer = Pick<Player, 'id' | 'name' | 'team' | 'position'> & {
  stats?: Record<string, number | string>;
};

type OfferState = Omit<PlayerStore<OfferSide, OfferPlayer>, 'clear'> & {
  shortlist: OfferPlayer[]; // optional
  toggleShortlist: (p: OfferPlayer) => void;
  clearOffer: () => void;
};

export const useOfferStore = create<OfferState>()((set, get, api) => {
  const { clear, ...base } = createPlayerStore<OfferSide, OfferPlayer>(['yours', 'theirs'])(
    set as any,
    get as any,
    api as any
  );

  return {
    ...base,
    shortlist: [],
    toggleShortlist: (p) =>
      set((s) =>
        s.shortlist.some((x) => x.id === p.id)
          ? { ...s, shortlist: s.shortlist.filter((x) => x.id !== p.id) }
          : { ...s, shortlist: [...s.shortlist, p] }
      ),
    clearOffer: clear,
  };
});
