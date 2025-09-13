import type { Player } from '@/types/players';

import type { StoreApi } from 'zustand';

export type PlayerStore<Side extends string, P extends { id: string } = Player> = {
  [K in Side]: P[];
} & {
  add: (side: Side, p: P) => void;
  remove: (side: Side, id: string) => void;
  clear: () => void;
};

export function createPlayerStore<Side extends string, P extends { id: string } = Player>(
  sides: readonly Side[]
) {
  return <T extends PlayerStore<Side, P>>(
    set: StoreApi<T>['setState'],
    _get: StoreApi<T>['getState'],
    _api: StoreApi<T>
  ): PlayerStore<Side, P> => {
    const initial = Object.fromEntries(sides.map((s) => [s, [] as P[]])) as {
      [K in Side]: P[];
    };
    return {
      ...initial,
      add: (side, p) =>
        set((state) => {
          const list = state[side];
          if (list.some((x) => x.id === p.id)) return state;
          return { ...state, [side]: [...list, p] };
        }),
      remove: (side, id) =>
        set((state) => ({ ...state, [side]: state[side].filter((x) => x.id !== id) })),
      clear: () => set(initial as Partial<T>),
    };
  };
}
