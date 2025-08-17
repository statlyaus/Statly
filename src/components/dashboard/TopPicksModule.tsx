'use client';

import { motion } from 'framer-motion';
import { usePlayerStatsETL } from '@/hooks/usePlayerStats';
import { useEffect } from 'react';
import type { PlayerStat } from '@/hooks/usePlayerStats';

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

  // Create a data-focused display with numbers and statistics
  return (
    <DataFocusedTopPicks
      players={playerStats.filter((player) => player.totalValue && !Number.isNaN(player.totalValue) && player.categories)}
      title="Top Picks This Round"
      limit={8}
    />
  );
}

// New data-focused component with clear numbers and statistics
function DataFocusedTopPicks({ 
  players, 
  title, 
  limit = 8 
}: { 
  players: PlayerStat[], 
  title: string, 
  limit?: number 
}) {
  const topPlayers = players.slice(0, limit);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded font-medium">
            Live Data
          </span>
          <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
            {topPlayers.length} Players
          </span>
        </div>
      </div>

      {/* Statistics Table */}
      <div className="space-y-3">
        {topPlayers.map((player, index) => (
          <motion.div
            key={player.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
          >
            {/* Player Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-bold text-sm">{index + 1}</span>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">{player.player_name}</h4>
                  <p className="text-sm text-gray-600">{player.team} • {player.position}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-purple-600">{player.totalValue || 0}</p>
                <p className="text-sm text-gray-500">Total Points</p>
              </div>
            </div>

            {/* Key Statistics Grid */}
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
              <StatBox
                label="Goals"
                value={player.categories?.goals || 0}
                color="text-red-600"
                bgColor="bg-red-50"
              />
              <StatBox
                label="Tackles"
                value={player.categories?.tackles || 0}
                color="text-orange-600"
                bgColor="bg-orange-50"
              />
              <StatBox
                label="Inside 50s"
                value={player.categories?.inside50s || 0}
                color="text-blue-600"
                bgColor="bg-blue-50"
              />
              <StatBox
                label="Intercepts"
                value={player.categories?.intercepts || 0}
                color="text-purple-600"
                bgColor="bg-purple-50"
              />
              <StatBox
                label="Cont. Marks"
                value={player.categories?.contestedMarks || 0}
                color="text-green-600"
                bgColor="bg-green-50"
              />
              <StatBox
                label="Rebound 50s"
                value={player.categories?.rebound50s || 0}
                color="text-teal-600"
                bgColor="bg-teal-50"
              />
              <StatBox
                label="Cont. Poss."
                value={player.categories?.contestedPossessions || 0}
                color="text-yellow-600"
                bgColor="bg-yellow-50"
              />
              <StatBox
                label="Eff. Disp."
                value={player.categories?.effectiveDisposals || 0}
                color="text-indigo-600"
                bgColor="bg-indigo-50"
              />
              <StatBox
                label="Score Inv."
                value={player.categories?.scoreInvolvements || 0}
                color="text-pink-600"
                bgColor="bg-pink-50"
              />
            </div>

            {/* Match Context */}
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Round {player.round_number} vs {player.opposition} • 
                {player.tenthCell && (
                  <span className="ml-1 font-medium">
                    {player.tenthCell.value}{player.tenthCell.label} {player.tenthCell.type}
                  </span>
                )}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Summary Statistics */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">
              {topPlayers.length > 0 
                ? Math.round(topPlayers.reduce((sum, p) => sum + (p.totalValue || 0), 0) / topPlayers.length)
                : 0
              }
            </p>
            <p className="text-sm text-gray-500">Avg Points</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">
              {topPlayers.length > 0 
                ? Math.max(...topPlayers.map(p => p.categories?.goals || 0))
                : 0
              }
            </p>
            <p className="text-sm text-gray-500">Top Goals</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-orange-600">
              {topPlayers.length > 0 
                ? Math.max(...topPlayers.map(p => p.categories?.tackles || 0))
                : 0
              }
            </p>
            <p className="text-sm text-gray-500">Top Tackles</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">
              {topPlayers.length > 0 
                ? Math.max(...topPlayers.map(p => p.categories?.inside50s || 0))
                : 0
              }
            </p>
            <p className="text-sm text-gray-500">Top I50s</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Individual stat box component
function StatBox({ 
  label, 
  value, 
  color, 
  bgColor 
}: { 
  label: string, 
  value: number, 
  color: string, 
  bgColor: string 
}) {
  return (
    <div className={`${bgColor} rounded-md p-2 text-center`}>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-600 leading-tight">{label}</p>
    </div>
  );
}
