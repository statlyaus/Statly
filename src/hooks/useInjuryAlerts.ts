'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import type { Player, RankingsResponse, RankedPlayer } from '@/types/players';
import { fetchFromAPI } from '@/lib/api';

export type InjuryAlert = {
  injured: Player;
  replacements: RankedPlayer[];
};

const fetcher = (path: string): Promise<RankingsResponse> =>
  fetchFromAPI(path, { cache: 'no-store' });

export function useInjuryAlerts(roster: Player[]) {
  const injuredPlayers = useMemo(
    () => roster.filter((p) => p.injury && /out/i.test(p.injury)),
    [roster]
  );

  const rosterIds = useMemo(() => new Set(roster.map((p) => String(p.id))), [roster]);

  const { data, error, isLoading, mutate } = useSWR<RankingsResponse>(
    injuredPlayers.length ? '/api/rankings?perGame=1&winsorP=0.01&includeDE=0' : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  const alerts: InjuryAlert[] = useMemo(() => {
    if (!data?.data) return [];
    return injuredPlayers
      .map((injured) => {
        const candidates = data.data.players
          .filter((p) => p.position === injured.position && !rosterIds.has(String(p.id)))
          .sort((a, b) => b.totalValue - a.totalValue)
          .slice(0, 3);
        return { injured, replacements: candidates };
      })
      .filter((a) => a.replacements.length > 0);
  }, [data, injuredPlayers, rosterIds]);

  return {
    alerts,
    isLoading,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    refresh: async () => {
      await mutate();
    },
  };
}
