import { useState, useEffect } from 'react';
import type { Player } from '@/types/players';
import { fetchApi } from '@/lib/api';

interface PlayerRanking extends Player {
  rank: number;
  totalValue?: number;
  valueOverReplacement: number;
}

function normalizeRankingsResponse(response: unknown): PlayerRanking[] {
  const normalizeRows = (rows: unknown[]): PlayerRanking[] =>
    rows.map((row) => {
      const ranking = row as PlayerRanking;
      const statlyZ = ranking.totalValue ?? ranking.valueOverReplacement ?? 0;

      return {
        ...ranking,
        totalValue: ranking.totalValue ?? statlyZ,
        valueOverReplacement: statlyZ,
      };
    });

  if (Array.isArray(response)) return normalizeRows(response);

  if (response && typeof response === 'object') {
    const body = response as Record<string, unknown>;
    const data = body.data;

    if (Array.isArray(data)) return normalizeRows(data);
    if (data && typeof data === 'object') {
      const dataBody = data as Record<string, unknown>;
      if (Array.isArray(dataBody.players)) return normalizeRows(dataBody.players);
    }

    if (Array.isArray(body.players)) return normalizeRows(body.players);
  }

  return [];
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
        setRankings(normalizeRankingsResponse(data));
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
