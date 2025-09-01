'use client';

import { useEffect, useState, useMemo } from 'react';
import { fetchApi } from '@/lib/api';
import PlayerStatsTable from '@/components/stats/PlayerStatsTable';
import StatFilters from '@/components/StatFilters';
import { LoadingSpinner } from '@/components/ui';
import type { Player } from '@/types/players';

// Define a more specific type for the match data used in this component
interface Match {
  round: number;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  players: Player[];
}

export default function StatsPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statQualifier, setStatQualifier] = useState<string>('Kicks');
  const [statThreshold, setStatThreshold] = useState<number>(10);
  const [timeframe, setTimeframe] = useState<string>('Season');

  useEffect(() => {
    const getMatchData = async () => {
      try {
        setLoading(true);
        const allMatches = await fetchApi('matches/enhanced');
        setMatches(allMatches);
      } catch (err: unknown) {
        setError('Failed to load match stats.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    getMatchData();
  }, []);

  const allPlayers = useMemo(() => {
    if (!matches) return [];
    const playerMap = new Map<string, Player>();

    matches.forEach((match: Match) => {
      match.players.forEach((player) => {
        if (playerMap.has(player.id)) {
          // If player exists, aggregate stats (simple sum for this example)
          const existingPlayer = playerMap.get(player.id)!;
          Object.keys(player.stats || {}).forEach((key) => {
            const statKey = key as keyof Player['stats'];
            const existingStats = existingPlayer.stats || {};
            const playerStats = player.stats || {};
            if (existingStats && playerStats) {
              (existingStats[statKey] as number) =
                (Number(existingStats[statKey]) || 0) + (Number(playerStats[statKey]) || 0);
            }
          });
        } else {
          // Deep copy to avoid mutation issues
          playerMap.set(player.id, { ...player, stats: { ...player.stats } });
        }
      });
    });
    return Array.from(playerMap.values());
  }, [matches]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-500 text-center">{error}</p>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Player Statistics</h1>
      <StatFilters
        statQualifier={statQualifier}
        setStatQualifier={setStatQualifier}
        statThreshold={statThreshold}
        setStatThreshold={setStatThreshold}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
      />
      <div className="mt-6">
        <PlayerStatsTable players={allPlayers} />
      </div>
    </div>
  );
}
