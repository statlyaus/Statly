'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

/** One player’s computed ranking entry. */
export type RankingEntry = {
  totalValue: number;
  rank: number;
};

/** Shape of the /api/rankings response this hook relies on. */
type RankingsApiResponse = {
  players: Array<{
    id: string | number;
    totalValue: number;
    rank: number;
  }>;
};

const fetcher = async (url: string): Promise<RankingsApiResponse> => {
  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(
      `Rankings API ${res.status} ${res.statusText}: ${body.slice(0, 160)}`
    );
  }
  if (!ct.includes('application/json')) {
    throw new Error(
      `Expected JSON but got: ${ct || 'unknown'}; first bytes: ${body.slice(0, 160)}`
    );
  }
  return JSON.parse(body) as RankingsApiResponse;
};

/**
 * Fetches /api/rankings and returns a Map<playerId, { totalValue, rank }>
 * along with loading/error + a typed refresh.
 */
export function useRankings() {
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
    const list = data?.players ?? [];
    for (const p of list) {
      m.set(String(p.id), {
        totalValue: p.totalValue,
        rank: p.rank,
      });
    }
    return m;
  }, [data]);

  const refresh = () => mutate();

  return { map, error, isLoading, refresh };
}

export type UseRankingsReturn = ReturnType<typeof useRankings>;