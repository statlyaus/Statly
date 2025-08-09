'use client';

import useSWR from 'swr';

// Keep the types local so this file is self‑contained
export type RankingsItem = {
  id: string;
  name?: string;
  team?: string;
  position?: string;
  totalValue: number;
  rank: number;
};

type RankingsResponse = {
  players: RankingsItem[];
  categoriesUsed: string[];
  generatedAt: string;
  meta: unknown;
};

const fetcher = async (url: string): Promise<RankingsResponse> => {
  const res = await fetch(url, { cache: 'no-store' });
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();
  if (!res.ok) throw new Error(`Rankings API ${res.status}: ${body.slice(0,160)}`);
  if (!ct.includes('application/json')) {
    throw new Error(`Expected JSON, got ${ct || 'unknown'}; first bytes: ${body.slice(0,160)}`);
  }
  return JSON.parse(body) as RankingsResponse;
};

/**
 * useRankings – fetches /api/rankings and gives you:
 * - map: Map<playerId, {rank,totalValue}>
 * - get(id): convenience accessor (returns null if missing)
 * - error, isLoading, mutate
 */
export function useRankings(
  qs: string = 'perGame=1&winsorP=0.01&includeDE=0'
) {
  const { data, error, isLoading, mutate } = useSWR<RankingsResponse>(
    `/api/rankings?${qs}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const map = new Map<string, { rank: number; totalValue: number }>();
  if (data?.players) {
    for (const p of data.players) {
      map.set(String(p.id), { rank: p.rank, totalValue: p.totalValue });
    }
  }

  const get = (id: string | number) => map.get(String(id)) ?? null;

  return { map, get, error, isLoading, mutate };
}