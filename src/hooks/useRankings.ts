'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { fetchFromAPI } from '@/lib/api';

export type RankingEntry = {
  totalValue: number;
  rank: number;
};

type RankingsApiResponse = {
  players: Array<{ id: string; totalValue: number; rank: number }>;
};

const fetcher = (path: string): Promise<RankingsApiResponse> =>
  fetchFromAPI(path, { cache: 'no-store' });

/** Read‑only interface the UI consumes */
export type UseRankingsReturn = {
  /** get a player’s ranking, or undefined if not available */
  get: (playerId: string) => RankingEntry | undefined;
  /** request state */
  isLoading: boolean;
  error: string | null;
  /** revalidate */
  refresh: () => Promise<void>;
};

export function useRankings(): UseRankingsReturn {
  const { data, error, isLoading, mutate } = useSWR<RankingsApiResponse>(
    '/api/rankings?perGame=1&winsorP=0.01&includeDE=0',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  const map = useMemo(() => {
    const m = new Map<string, RankingEntry>();
    if (data?.players) {
      for (const p of data.players) {
        m.set(String(p.id), { totalValue: p.totalValue, rank: p.rank });
      }
    }
    return m;
  }, [data]);

  return {
    get: (playerId: string) => map.get(String(playerId)),
    isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refresh: async () => { await mutate(); },
  };
}
