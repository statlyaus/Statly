import { motion } from 'framer-motion';
import { usePlayerStatsETL } from '@/hooks/usePlayerStats';
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types/socketEvents';

interface LeaderboardModuleProps {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
}

interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  points: number;
  change: number;
  trend: 'up' | 'down' | 'stable';
  isCurrentUser?: boolean;
}

export default function LeaderboardModule({ socket }: LeaderboardModuleProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const { data: playerStats, loading, error, refetch } = usePlayerStatsETL('2025');

  useEffect(() => {
    if (!socket) return;
    const handler = (_payload: { timestamp: string }) => {
      refetch();
    };
    socket.on('leaderboard:update', handler);
    return () => {
      socket.off('leaderboard:update', handler);
    };
  }, [socket, refetch]);

  useEffect(() => {
    if (playerStats && playerStats.length > 0) {
      // Transform ETL data to leaderboard format
      const entries: LeaderboardEntry[] = playerStats
        .sort((a, b) => b.fantasy_points - a.fantasy_points)
        .slice(0, 8)
        .map((stat, index) => ({
          id: stat.player_id,
          rank: index + 1,
          name: stat.player_name,
          points: stat.fantasy_points,
          change: Math.floor(Math.random() * 5) - 2, // Random change for demo
          trend: (Math.random() > 0.5 ? 'up' : Math.random() > 0.5 ? 'down' : 'stable') as
            | 'up'
            | 'down'
            | 'stable',
          isCurrentUser: index === 2, // Demo: highlight third entry as current user
        }));
      setLeaderboard(entries);
    } else {
      // Fallback mock data when no ETL data available
      setLeaderboard([
        {
          id: '1',
          rank: 1,
          name: 'ETL Integration Ready',
          points: 2847,
          change: 2,
          trend: 'up',
        },
        {
          id: '2',
          rank: 2,
          name: 'Firebase Connected',
          points: 2791,
          change: 1,
          trend: 'up',
        },
        {
          id: '3',
          rank: 3,
          name: 'Your Fantasy Team',
          points: 2734,
          change: -1,
          trend: 'down',
          isCurrentUser: true,
        },
        {
          id: '4',
          rank: 4,
          name: 'Sample Player Data',
          points: 2689,
          change: 0,
          trend: 'stable',
        },
      ]);
    }
  }, [playerStats]);

  const getTrendIcon = (trend: LeaderboardEntry['trend']) => {
    switch (trend) {
      case 'up':
        return '↗️';
      case 'down':
        return '↘️';
      case 'stable':
        return '→';
    }
  };

  const getTrendColor = (trend: LeaderboardEntry['trend']) => {
    switch (trend) {
      case 'up':
        return 'text-green-600';
      case 'down':
        return 'text-red-600';
      case 'stable':
        return 'text-gray-600';
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Fantasy Leaderboard</h3>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                </div>
                <div className="text-right">
                  <div className="h-4 bg-gray-200 rounded w-16 mb-1"></div>
                  <div className="h-3 bg-gray-200 rounded w-8"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Fantasy Leaderboard</h3>
        {playerStats && playerStats.length > 0 ? (
          <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">Live Data</span>
        ) : (
          <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">Demo Data</span>
        )}
      </div>

      <div className="space-y-2">
        {leaderboard.map((entry, index) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
              entry.isCurrentUser ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  entry.rank === 1
                    ? 'bg-yellow-100 text-yellow-800'
                    : entry.rank === 2
                      ? 'bg-gray-100 text-gray-800'
                      : entry.rank === 3
                        ? 'bg-orange-100 text-orange-800'
                        : entry.isCurrentUser
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-600'
                }`}
              >
                {entry.rank}
              </div>
              <div>
                <p
                  className={`font-medium ${
                    entry.isCurrentUser ? 'text-blue-900' : 'text-gray-900'
                  }`}
                >
                  {entry.name}
                  {entry.isCurrentUser && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      You
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-semibold text-gray-900">{entry.points.toLocaleString()}</p>
              <p className={`text-sm ${getTrendColor(entry.trend)} flex items-center justify-end`}>
                {getTrendIcon(entry.trend)}
                <span className="ml-1">
                  {entry.change > 0 ? '+' : ''}
                  {entry.change}
                </span>
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">Failed to load live data: {error}</p>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          View Full Leaderboard
        </motion.button>
      </div>
    </motion.div>
  );
}
