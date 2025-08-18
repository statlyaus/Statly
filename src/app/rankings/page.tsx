'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/navigation';

type RankingCategory =
  | 'goals'
  | 'goal_assists'
  | 'tackles'
  | 'clearances'
  | 'inside_50s'
  | 'rebound_50s'
  | 'hitouts'
  | 'intercepts'
  | 'marks';

interface PlayerRanking {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  games: number;
  overall: number;
  rank: number;
  categories: Record<
    RankingCategory,
    {
      perGame: number;
      zScore: number;
    }
  >;
}

export default function RankingsPage() {
  const [players, setPlayers] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRankings = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/rankings');
        if (!response.ok) {
          throw new Error('Failed to fetch rankings');
        }
        const data = await response.json();
        // Extract players from API response structure
        const playersData = data.success && data.data ? data.data.players || [] : [];
        setPlayers(Array.isArray(playersData) ? playersData : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load rankings');
      } finally {
        setLoading(false);
      }
    };

    fetchRankings();
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h2 className="text-red-800 font-semibold">Error Loading Rankings</h2>
            <p className="text-red-600">{error}</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Player Rankings</h1>
          <p className="text-lg text-gray-600">
            Player rankings based on 9 AFL statistical categories
          </p>

          {/* Legend */}
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Stat Strength Legend:</h3>
            <div className="flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-green-50 text-green-700">🔥 Elite (Z ≥ 2.0)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-green-25 text-green-600">⭐ Excellent (Z ≥ 1.0)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-blue-25 text-blue-600">📈 Above Avg (Z ≥ 0.5)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-gray-25 text-gray-600">➖ Average (Z ≥ -0.5)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-orange-25 text-orange-600">📉 Below Avg (Z ≥ -1.0)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-red-25 text-red-600">❌ Poor (Z &lt; -1.0)</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Numbers show per-game averages. Icons and colors indicate strength relative to league average (Z-score).
            </p>
          </div>
        </header>

        <div className="bg-white shadow-sm rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-screen">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Player
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pos
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Games
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Overall
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>G</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>GA</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>T</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>CL</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>I50</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>R50</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>HO</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>I</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div>M</div>
                    <div className="text-xs opacity-75">avg/z</div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Array.isArray(players) && players.map((player) => {
                  // Helper function to get color based on z-score strength
                  const getStatColor = (zScore: number) => {
                    if (zScore >= 2) return 'text-green-700 bg-green-50';
                    if (zScore >= 1) return 'text-green-600 bg-green-25';
                    if (zScore >= 0.5) return 'text-blue-600 bg-blue-25';
                    if (zScore >= -0.5) return 'text-gray-600 bg-gray-25';
                    if (zScore >= -1) return 'text-orange-600 bg-orange-25';
                    return 'text-red-600 bg-red-25';
                  };

                  const getStatIcon = (zScore: number) => {
                    if (zScore >= 2) return '🔥';
                    if (zScore >= 1) return '⭐';
                    if (zScore >= 0.5) return '📈';
                    if (zScore >= -0.5) return '➖';
                    if (zScore >= -1) return '📉';
                    return '❌';
                  };

                  return (
                    <tr key={player.playerId} className="hover:bg-gray-50">
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-800 text-sm font-bold">
                          {player.rank}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{player.playerName}</div>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">{player.team}</span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-600">{player.position}</span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-center">
                        <span className="text-sm font-medium text-gray-900">{player.games}</span>
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-center">
                        <span className="text-sm font-mono font-bold text-gray-900">
                          {player.overall != null ? player.overall.toFixed(1) : '0.0'}
                        </span>
                      </td>

                      {/* Goals */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.goals?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.goals?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.goals?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Goal Assists */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.goal_assists?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.goal_assists?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.goal_assists?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Tackles */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.tackles?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.tackles?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.tackles?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Clearances */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.clearances?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.clearances?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.clearances?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Inside 50s */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.inside_50s?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.inside_50s?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.inside_50s?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Rebound 50s */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.rebound_50s?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.rebound_50s?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.rebound_50s?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Hitouts */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.hitouts?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.hitouts?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.hitouts?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Intercepts */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.intercepts?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.intercepts?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.intercepts?.zScore || 0)}
                          </div>
                        </div>
                      </td>

                      {/* Marks */}
                      <td className="px-2 py-4 whitespace-nowrap text-center">
                        <div className={`text-xs px-1 py-1 rounded ${getStatColor(player.categories?.marks?.zScore || 0)}`}>
                          <div className="font-mono font-bold">
                            {player.categories?.marks?.perGame?.toFixed(1) || '0.0'}
                          </div>
                          <div className="text-xs opacity-75">
                            {getStatIcon(player.categories?.marks?.zScore || 0)}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}