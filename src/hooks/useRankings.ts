import { useState, useEffect } from 'react';

import { fetchApi } from '@/lib/api';
import type { Player } from '@/types/players';

interface PlayerRanking extends Player {
  rank: number;
  valueOverReplacement: number;
}

export const useRankings = () => {
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getRankings = async () => {
      try {
        setLoading(true);
        const data = await fetchApi('rankings');
        if (Array.isArray(data)) {
          setRankings(data as PlayerRanking[]);
        } else if (data && typeof data === 'object') {
          const payload = (data as { data?: { players?: unknown[] }; players?: unknown[] }).data;
          const playersRaw =
            (payload && Array.isArray(payload.players) ? payload.players : undefined) ??
            ((data as { players?: unknown[] }).players ?? []);
          const mapped = Array.isArray(playersRaw)
            ? playersRaw.map((player) => {
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
              })
            : [];
          setRankings(mapped);
        } else {
          setRankings([]);
        }
        setError(null);
      } catch (err) {
        setError('Failed to fetch player rankings.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getRankings();
  }, []);

  return { rankings, loading, error };
};
