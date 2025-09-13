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
        setRankings(data);
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
