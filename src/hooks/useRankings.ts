'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type RankingEntry = {
  totalValue: number;
  rank: number;
};

type RankingsApiResponse = {
  players: Array<{
    id: string;
    totalValue: number;
    rank: number;
  }>;
};

export function useRankings() {
  const [map, setMap] = useState<Map<string, RankingEntry>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = '/api/rankings?perGame=1&winsorP=0.01&includeDE=0';
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const ct = res.headers.get('content-type') ?? '';
      const body = await res.text();

      if (!res.ok) {
        throw new Error(`Rankings API ${res.status} ${res.statusText}: ${body.slice(0, 160)}`);
      }
      if (!ct.includes('application/json')) {
        throw new Error(
          `Expected JSON but got: ${ct || 'unknown'}; first bytes: ${body.slice(0, 160)}`
        );
      }

      const data = JSON.parse(body) as RankingsApiResponse;
      const m = new Map<string, RankingEntry>();
      for (const p of data.players) {
        m.set(String(p.id), { totalValue: p.totalValue, rank: p.rank });
      }
      setMap(m);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const get = useCallback(
    (playerId: string): RankingEntry | undefined => map.get(String(playerId)),
    [map]
  );

  const refresh = useCallback(() => load(), [load]);

  return useMemo(
    () => ({ get, isLoading, error, refresh }),
    [get, isLoading, error, refresh]
  );
}

export type UseRankingsReturn = ReturnType<typeof useRankings>;