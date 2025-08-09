'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

/** What each player’s ranking entry looks like */
export type RankingEntry = {
  totalValue: number;
  rank: number;
};

/** Shape of the /api/rankings response we care about */
type RankingsApiResponse = {
  players: Array<{
    id: string;
    totalValue: number;
    rank: number;
  }>;
};

const fetcher = async (url: string): Promise<RankingsApiResponse> => {
  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`Rankings API ${res.status} ${res.statusText}: ${body.slice(0, 160)}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error(`Expected JSON but got: ${ct || 'unknown'}; first bytes: ${body.slice(0, 160)}`);
  }
  return JSON.parse(body) as RankingsApiResponse;
};

/**
 * useRankings
 * - Fetches /api/rankings
 * - Returns a Map<playerId, { totalValue, rank }>
 * - Strongly typed, no `any`
 */
export function useRankings() {
  // Relative URL = works in browser; server-side is not using this hook.
  const { data, error, isLoading, mutate } = useSWR<RankingsApiResponse>(
    '/api/rankings?perGame=1&winsorP=0.01&includeDE=0',
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
    }
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
    map,                 // Map<string, RankingEntry>
    error,               // Error | undefined
    isLoading,           // boolean
    refresh: mutate,     // () => Promise<any>
  };
}

export type UseRankingsReturn = ReturnType<typeof useRankings>;