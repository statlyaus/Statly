// src/Hooks/usePlayerStats.ts
import { useEffect, useState } from "react";
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

  useEffect(() => {
    fetch("/player_stats_2025.json")
      .then((res) => res.json())
      .then((data) => {
        setPlayers(data);
        setLoading(false);
      });
  }, []);

  return { players, loading };
};