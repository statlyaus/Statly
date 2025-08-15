'use client';

import { useEffect, useState } from 'react';
import { fetchFromAPI } from '@/lib/api';
import { AppLayout } from '@/components/navigation';
import RealDataLeaderboard from '@/components/RealDataLeaderboard';
import type { PlayerStats } from '@/types/fantasyCategories';

type PlayerMatchStat = {
  id: string;
  player_name: string;
  team: string;
  position: string;
  totalValue: number;
  categories: {
    goals: number;
    tackles: number;
    inside50s: number;
    intercepts: number;
    contestedMarks: number;
    rebound50s: number;
    contestedPossessions: number;
    effectiveDisposals: number;
    scoreInvolvements: number;
  };
  perGameLog: PlayerStats;
  round: number;
  opposition: string;
  match_id: string;
  season: number;
};

export default function StatsPage() {
  const [stats, setStats] = useState<{
    totalPlayers: number;
    totalMatches: number;
    avgTotalValue: number;
    topTeams: { team: string; avgValue: number; players: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFromAPI<{ data: PlayerMatchStat[] }>('/api/player-stats?season=2025')
      .then((response) => {
        const matchData = response.data;
        
        // Calculate overview stats
        const uniquePlayers = new Set(matchData.map(m => m.player_name)).size;
        const totalMatches = matchData.length;
        const avgTotalValue = matchData.reduce((sum, m) => sum + m.totalValue, 0) / totalMatches;
        
        // Team performance
        const teamMap = new Map<string, { totalValue: number; players: Set<string> }>();
        matchData.forEach(match => {
          if (teamMap.has(match.team)) {
            const team = teamMap.get(match.team)!;
            team.totalValue += match.totalValue;
            team.players.add(match.player_name);
          } else {
            teamMap.set(match.team, {
              totalValue: match.totalValue,
              players: new Set([match.player_name])
            });
          }
        });
        
        const topTeams = Array.from(teamMap.entries())
          .map(([team, data]) => ({
            team,
            avgValue: data.totalValue / data.players.size,
            players: data.players.size
          }))
          .sort((a, b) => b.avgValue - a.avgValue)
          .slice(0, 8);

        setStats({
          totalPlayers: uniquePlayers,
          totalMatches,
          avgTotalValue,
          topTeams
        });
        setLoading(false);
      })
      .catch((_err) => {
        setError('Failed to load stats data');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="container mx-auto p-8 text-center">
          <div className="text-gray-500">Loading 2025 AFL statistics...</div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="container mx-auto p-8 text-center">
          <div className="text-red-500 bg-red-50 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-2">Error Loading Player Stats</h2>
            <p>{error}</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">2025 AFL Statistics</h1>
          <p className="text-gray-600">Real-time data from AFL matches using the 9-category scoring system</p>
        </div>

        {stats && (
          <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="text-3xl font-bold text-blue-600">{stats.totalPlayers}</div>
              <div className="text-sm text-gray-500">Total Players</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="text-3xl font-bold text-green-600">{stats.totalMatches}</div>
              <div className="text-sm text-gray-500">Match Records</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="text-3xl font-bold text-purple-600">{stats.avgTotalValue.toFixed(1)}</div>
              <div className="text-sm text-gray-500">Avg Total Value</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6 text-center">
              <div className="text-3xl font-bold text-orange-600">{stats.topTeams.length}</div>
              <div className="text-sm text-gray-500">Active Teams</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <RealDataLeaderboard 
            category="totalValue"
            limit={10}
            title="Top Performers (9-Category System)"
          />
          <RealDataLeaderboard 
            category="goals"
            limit={10}
            title="Goal Leaders"
          />
          <RealDataLeaderboard 
            category="tackles"
            limit={10}
            title="Tackle Leaders"
          />
          <RealDataLeaderboard 
            category="inside50s"
            limit={10}
            title="Inside 50 Leaders"
          />
        </div>

        {stats && stats.topTeams.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Team Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.topTeams.map((team, index) => (
                <div key={team.team} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </div>
                    <div className="font-semibold">{team.team}</div>
                  </div>
                  <div className="text-sm text-gray-600">
                    <div>Avg Value: <span className="font-medium text-purple-600">{team.avgValue.toFixed(1)}</span></div>
                    <div>Players: <span className="font-medium">{team.players}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
