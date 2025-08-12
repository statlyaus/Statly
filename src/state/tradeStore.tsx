'use client';
import { create } from 'zustand';
import type { Player } from '@/types/players';
import { createPlayerStore, type PlayerStore } from './createPlayerStore';

export type Side = 'incoming' | 'outgoing';
type RostersMap = Record<string, Player[]>;

type TradeState = Omit<PlayerStore<Side, Player>, 'clear'> & {
  myTeamKey: string | null;
  targetTeamKey: string | null;
  rosters: RostersMap;

  setMyTeam: (teamId: string | null) => void;
  setTargetTeam: (teamId: string | null) => void;
  seedRoster: (teamId: string, players: Player[]) => void;

  clearAll: () => void;
};

export const useTradeStore = create<TradeState>()((set, get, api) => {
  const { clear, ...base } =
    createPlayerStore<Side, Player>(['incoming', 'outgoing'])(
      set as any,
      get as any,
      api as any,
    );

  return {
    myTeamKey: null,
    targetTeamKey: null,
    rosters: {},
    ...base,
    setMyTeam: (teamId) => set({ myTeamKey: teamId }),
    setTargetTeam: (teamId) => set({ targetTeamKey: teamId }),
    seedRoster: (teamId, players) =>
      set((s) => ({ rosters: { ...s.rosters, [teamId]: players } })),
    clearAll: () => {
      clear();
      set({ myTeamKey: null, targetTeamKey: null, rosters: {} });
    },
  };
});
