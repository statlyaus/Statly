// src/hooks/usePlayerStats.ts
import { useEffect, useState } from 'react';
export type Player = {
  id: string;
  first_name: string;
  surname: string;
  team: string;
  opponent?: string;
  venue?: string;
  round: number;
  stats: {
    kicks: number;
    handballs: number;
    goals: number;
    [key: string]: number;
  };
};

export const usePlayerStats = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const res = await fetch('/player_stats_2025.json');
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        setPlayers(data);
      } catch (err) {
        console.error('Failed to fetch player stats:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchPlayers();
  }, []);

  return { players, loading, error };
};
