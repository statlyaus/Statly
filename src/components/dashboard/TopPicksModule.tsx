import { motion } from 'framer-motion';
import { usePlayerStatsETL } from '@/hooks/usePlayerStats';
import { useEffect, useState } from 'react';

interface TopPicksModuleProps {
  refreshTrigger: number;
}

interface TopPick {
  id: string;
  name: string;
  position: string;
  team: string;
  points: number;
  trend: 'up' | 'down' | 'stable';
  change: number;
}

export default function TopPicksModule({ refreshTrigger }: TopPicksModuleProps) {
  const [topPicks, setTopPicks] = useState<TopPick[]>([]);
  const { data: playerStats, loading, error, refetch } = usePlayerStatsETL('2025');

  useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  useEffect(() => {
    if (playerStats && playerStats.length > 0) {
      // Transform ETL data to top picks format
      const picks: TopPick[] = playerStats
        .sort((a, b) => b.fantasy_points - a.fantasy_points)
        .slice(0, 6)
        .map((stat, index) => ({
          id: stat.player_id,
          name: stat.player_name,
          position: stat.position,
          team: stat.team,
          points: stat.fantasy_points,
          trend: (index < 2 ? 'up' : index < 4 ? 'stable' : 'down') as 'up' | 'down' | 'stable',
          change: Math.random() * 10 - 5, // Random change for demo - could be calculated from historical data
        }));
      setTopPicks(picks);
    } else {
      // Fallback mock data when no ETL data available
      setTopPicks([
        {
          id: '1',
          name: 'ETL Integration Ready',
          position: 'SYS',
          team: 'SYS',
          points: 127.3,
          trend: 'up',
          change: 5.2,
        },
        {
          id: '2',
          name: 'Connect Firebase Database',
          position: 'SYS',
          team: 'SYS',
          points: 124.8,
          trend: 'up',
          change: 3.1,
        },
        {
          id: '3',
          name: 'Initialize Sample Data',
          position: 'SYS',
          team: 'SYS',
          points: 119.5,
          trend: 'stable',
          change: 0.8,
        },
      ]);
    }
  }, [playerStats]);

  const getTrendIcon = (trend: TopPick['trend']) => {
    switch (trend) {
      case 'up':
        return '↗️';
      case 'down':
        return '↘️';
      case 'stable':
        return '→';
    }
  };

  const getTrendColor = (trend: TopPick['trend']) => {
    switch (trend) {
      case 'up':
        return 'text-green-600';
      case 'down':
        return 'text-red-600';
      case 'stable':
        return 'text-yellow-600';
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Top Picks This Round
        </h3>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                  <div>
                    <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
                    <div className="h-3 bg-gray-200 rounded w-16"></div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="h-4 bg-gray-200 rounded w-12 mb-1"></div>
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
        <h3 className="text-lg font-semibold text-gray-900">
          Top Picks This Round
        </h3>
        {playerStats && playerStats.length > 0 ? (
          <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
            Live Data
          </span>
        ) : (
          <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
            Demo Data
          </span>
        )}
      </div>
      
      <div className="space-y-3">
        {topPicks.map((pick, index) => (
          <motion.div
            key={pick.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <span className="text-blue-600 font-medium text-sm">
                  {index + 1}
                </span>
              </div>
              <div>
                <p className="font-medium text-gray-900">{pick.name}</p>
                <p className="text-sm text-gray-500">{pick.team} • {pick.position}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-semibold text-gray-900">{pick.points}</p>
              <p className={`text-sm ${getTrendColor(pick.trend)} flex items-center`}>
                {getTrendIcon(pick.trend)} {pick.change > 0 ? '+' : ''}{pick.change.toFixed(1)}
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
    </motion.div>
  );
}
