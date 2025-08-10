'use client';
import { create } from 'zustand';
import type { Player } from '@/types/players';

export type Side = 'incoming' | 'outgoing';
type RostersMap = Record<string, Player[]>;

type TradeState = {
  myTeamKey: string | null;
  targetTeamKey: string | null;
  rosters: RostersMap;

  incoming: Player[];
  outgoing: Player[];

  setMyTeam: (teamId: string | null) => void;
  setTargetTeam: (teamId: string | null) => void;
  seedRoster: (teamId: string, players: Player[]) => void;

  add: (side: Side, p: Player) => void;
  remove: (side: Side, id: string) => void;
  clearAll: () => void;
};

export const useTradeStore = create<TradeState>((set, _get) => ({
  myTeamKey: null,
  targetTeamKey: null,
  rosters: {},

  incoming: [],
  outgoing: [],

  setMyTeam: (teamId) => set({ myTeamKey: teamId }),
  setTargetTeam: (teamId) => set({ targetTeamKey: teamId }),
  seedRoster: (teamId, players) =>
    set((s) => ({ rosters: { ...s.rosters, [teamId]: players } })),

  add: (side, p) =>
    set((s) => {
      const list = side === 'incoming' ? s.incoming : s.outgoing;
      if (list.some((x) => x.id === p.id)) return s;
      return side === 'incoming'
        ? { ...s, incoming: [...s.incoming, p] }
        : { ...s, outgoing: [...s.outgoing, p] };
    }),

  remove: (side, id) =>
    set((s) =>
      side === 'incoming'
        ? { ...s, incoming: s.incoming.filter((x) => x.id !== id) }
        : { ...s, outgoing: s.outgoing.filter((x) => x.id !== id) }
    ),

  clearAll: () => set({ incoming: [], outgoing: [] }),
}));