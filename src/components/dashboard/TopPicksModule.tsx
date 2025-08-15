'use client';

import { motion } from 'framer-motion';
import { usePlayerStatsETL } from '@/hooks/usePlayerStats';
import { useEffect } from 'react';
import NineCategoryDisplay from './NineCategoryDisplay';

interface TopPicksModuleProps {
  refreshTrigger: number;
}

export default function TopPicksModule({ refreshTrigger }: TopPicksModuleProps) {
  const { data: playerStats, loading, error, refetch } = usePlayerStatsETL('2025');

  useEffect(() => {
    if (refreshTrigger > 0) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Top Picks This Round</h3>
          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">Loading...</span>
        </div>

        <div className="space-y-3">
          {[...Array(6)].map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-50 animate-pulse"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                <div>
                  <div className="h-4 bg-gray-200 rounded w-24 mb-1"></div>
                  <div className="h-3 bg-gray-200 rounded w-16"></div>
                </div>
              </div>
              <div className="flex space-x-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-8 h-6 bg-gray-200 rounded"></div>
                ))}
              </div>
              <div className="text-right">
                <div className="h-4 bg-gray-200 rounded w-12 mb-1"></div>
                <div className="h-3 bg-gray-200 rounded w-8"></div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (error || !playerStats || playerStats.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Top Picks This Round</h3>
          <span className="text-xs text-yellow-600 bg-yellow-50 px-2 py-1 rounded">Demo Data</span>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">Failed to load live data: {error}</p>
          </div>
        )}

        <div className="space-y-3">
          <div className="text-center py-6 text-gray-500">
            <p>No player data available</p>
            <p className="text-sm">Waiting for data to load...</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Use the new 9-category display format
  return (
    <NineCategoryDisplay
      players={playerStats.filter((player) => player.totalValue && player.categories)}
      title="Top Picks This Round"
      layout="compact"
      limit={6}
    />
  );
}
