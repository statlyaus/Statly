'use client';

import useSWR from 'swr';

type Row = { id: string; totalValue: number; rank: number };
type Api = { players: Row[] };

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(r => r.json());

export function useRankings() {
  const { data, error, isLoading } = useSWR<Api>(
    '/api/rankings?perGame=1&winsorP=0.01&includeDE=0',
    fetcher,
    { revalidateOnFocus: false }
  );

  // Build a quick lookup map
  const map = new Map<string, { totalValue: number; rank: number }>();
  if (data?.players) for (const p of data.players) map.set(p.id, { totalValue: p.totalValue, rank: p.rank });

  return { map, error, isLoading };
}