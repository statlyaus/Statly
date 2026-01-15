import { useState, useEffect } from 'react';

import { fetchApi } from '@/lib/api';
import type { Player } from '@/types/players';

interface PlayerRanking extends Player {
  rank: number;
  valueOverReplacement: number;
}

let cachedRankings: PlayerRanking[] | null = null;
let inFlightRankings: Promise<PlayerRanking[]> | null = null;

function normalizeRankingsResponse(payload: unknown): PlayerRanking[] {
  if (Array.isArray(payload)) {
    return payload as PlayerRanking[];
  }

  if (payload && typeof payload === 'object') {
    const data = payload as { data?: { players?: unknown[] }; players?: unknown[] };
    const playersRaw =
      (data.data && Array.isArray(data.data.players) ? data.data.players : undefined) ??
      (Array.isArray(data.players) ? data.players : undefined) ??
      [];

    if (Array.isArray(playersRaw)) {
      return playersRaw.map((player) => {
        const p = player as {
          playerId?: string;
          playerName?: string;
          team?: string;
          position?: string;
          rank?: number;
          overall?: number;
        };
        return {
          id: String(p.playerId ?? ''),
          name: p.playerName ?? 'Unknown',
          team: p.team ?? '',
          position: p.position ?? '',
          rank: typeof p.rank === 'number' ? p.rank : 0,
          valueOverReplacement: typeof p.overall === 'number' ? p.overall : 0,
        } as PlayerRanking;
      });
    }
  }

  return [];
}

async function fetchRankingsOnce(): Promise<PlayerRanking[]> {
  if (cachedRankings) return cachedRankings;
  if (inFlightRankings) return inFlightRankings;

  inFlightRankings = (async () => {
    const data = await fetchApi('rankings');
    const normalized = normalizeRankingsResponse(data);
    cachedRankings = normalized;
    return normalized;
  })();

  try {
    return await inFlightRankings;
  } finally {
    inFlightRankings = null;
  }
}

export const useRankings = () => {
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const getRankings = async () => {
      try {
        setLoading(true);
        if (cachedRankings) {
          setRankings(cachedRankings);
          setError(null);
          setLoading(false);
          return;
        }

        const data = await fetchRankingsOnce();
        if (cancelled) return;

        setRankings(data);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError('Failed to fetch player rankings.');
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    getRankings().catch(() => {
      // Error already handled inside getRankings
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { rankings, loading, error };
};
