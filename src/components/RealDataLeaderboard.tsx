'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { fetchApi } from '@/lib/api';

type PlayerLeaderboardEntry = {
  player_name: string;
  team: string;
  position: string;
  totalValue: number;
  avgValue: number;
  games: number;
  totalGoals: number;
  totalTackles: number;
  avgGoals: number;
  avgTackles: number;
  avgInside50s: number;
};

type AggregatedPlayerData = {
  player_name: string;
  team: string;
  position: string;
  totalValue: number;
  games: number;
  totals: {
    goals: number;
    tackles: number;
    inside50s: number;
  };
  averages: {
    goals: number;
    tackles: number;
    inside50s: number;
  };
};

type Props = {
  category?: 'totalValue' | 'goals' | 'tackles' | 'inside50s';
  limit?: number;
  title?: string;
};

export default function RealDataLeaderboard({ category = 'totalValue', limit = 10, title }: Props) {
  const [leaders, setLeaders] = useState<PlayerLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const validatedLimit = Math.max(1, Math.floor(limit));

  useEffect(() => {
    fetchApi(`/api/player-stats/aggregate?season=2025&limit=${Math.min(validatedLimit * 3, 200)}`)
      .then((response) => {
        if (!response?.success || !Array.isArray(response.data)) {
          throw new Error('Aggregate player stats unavailable');
        }
        const leaderboard = (response.data as AggregatedPlayerData[]).map((player) => ({
          player_name: player.player_name,
          team: player.team,
          position: player.position,
          totalValue: player.totalValue,
          avgValue: player.totalValue / Math.max(1, player.games),
          games: player.games,
          totalGoals: player.totals.goals,
          totalTackles: player.totals.tackles,
          avgGoals: player.averages.goals,
          avgTackles: player.averages.tackles,
          avgInside50s: player.averages.inside50s,
        }));

        // Sort based on category
        let sortedLeaders: PlayerLeaderboardEntry[];
        switch (category) {
          case 'goals':
            sortedLeaders = leaderboard.sort((a, b) => b.totalGoals - a.totalGoals);
            break;
          case 'tackles':
            sortedLeaders = leaderboard.sort((a, b) => b.totalTackles - a.totalTackles);
            break;
          case 'inside50s':
            sortedLeaders = leaderboard.sort((a, b) => b.avgInside50s - a.avgInside50s);
            break;
          default:
            sortedLeaders = leaderboard.sort((a, b) => b.avgValue - a.avgValue);
        }

        setLeaders(sortedLeaders.slice(0, validatedLimit));
        setLoading(false);
      })
      .catch((err: unknown) => {
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error('RealDataLeaderboard: failed to load leaderboard data', err);
        setError(`Failed to load leaderboard data: ${errMessage}`);
        setLoading(false);
      });
  }, [category, validatedLimit]);

  if (loading) return <div className="p-4">Loading leaderboard...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  const getDisplayValue = (leader: PlayerLeaderboardEntry) => {
    switch (category) {
      case 'goals':
        return `${leader.totalGoals} (${leader.avgGoals?.toFixed(1)}/game)`;
      case 'tackles':
        return `${leader.totalTackles} (${leader.avgTackles?.toFixed(1)}/game)`;
      case 'inside50s':
        return `${leader.avgInside50s?.toFixed(1)}/game`;
      default:
        return `${leader.avgValue.toFixed(1)} avg`;
    }
  };

  const getValueColor = (category: string) => {
    switch (category) {
      case 'goals':
        return 'text-green-600';
      case 'tackles':
        return 'text-red-600';
      case 'inside50s':
        return 'text-orange-600';
      default:
        return 'text-purple-600';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">
        {title ||
          `Top ${validatedLimit} - ${category === 'totalValue' ? 'Total Value' : category.charAt(0).toUpperCase() + category.slice(1)}`}
      </h2>
      <div className="space-y-3">
        {leaders.map((leader, index) => (
          <div
            key={leader.player_name}
            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-bold">
                {index + 1}
              </div>
              <div>
                <Link
                  href={`/players/${leader.player_name.toLowerCase().replace(/\s+/g, '_')}`}
                  className="font-medium hover:text-blue-600 hover:underline"
                >
                  {leader.player_name}
                </Link>
                <div className="text-sm text-gray-500">
                  {leader.team} • {leader.position} • {leader.games} games
                </div>
              </div>
            </div>
            <div className={`text-right font-semibold ${getValueColor(category)}`}>
              {getDisplayValue(leader)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
