import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
import type { Player } from '@/types/players';

export const usePlayers = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getPlayers = async () => {
      try {
        setLoading(true);
        const data = await fetchApi('players');
        setPlayers(data);
        setError(null);
      } catch (err) {
        setError('Failed to fetch players.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getPlayers();
  }, []);

  return { players, loading, error };
};