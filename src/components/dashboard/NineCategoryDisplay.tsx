'use client';

import React from 'react';
import { motion } from 'framer-motion';
import type { PlayerStat } from '@/hooks/usePlayerStats';

interface NineCategoryDisplayProps {
  players: PlayerStat[];
  limit?: number;
  title?: string;
  showDetails?: boolean;
  layout?: 'compact' | 'detailed' | 'grid';
}

// Category metadata with colors and labels
// Category metadata for display and weighting
const CATEGORY_META = {
  goals: {
    label: 'Goals',
    abbr: 'G',
    color: 'bg-red-500',
    weight: 6,
    description: 'Goals scored',
  },
  tackles: {
    label: 'Tackles',
    abbr: 'T',
    color: 'bg-orange-500',
    weight: 4,
    description: 'Successful tackles',
  },
  inside50s: {
    label: 'Inside 50s',
    abbr: 'I50',
    color: 'bg-blue-500',
    weight: 4,
    description: 'Inside 50 entries (replaces clearances)',
  },
  intercepts: {
    label: 'Intercepts',
    abbr: 'INT',
    color: 'bg-purple-500',
    weight: 4,
    description: 'Defensive intercepts',
  },
  contestedMarks: {
    label: 'Contested Marks',
    abbr: 'CM',
    color: 'bg-green-500',
    weight: 8,
    description: 'Marks under pressure',
  },
  rebound50s: {
    label: 'Rebound 50s',
    abbr: 'R50',
    color: 'bg-teal-500',
    weight: 3,
    description: 'Defensive rebounds',
  },
  contestedPossessions: {
    label: 'Contested Poss.',
    abbr: 'CP',
    color: 'bg-yellow-500',
    weight: 3,
    description: 'Contested possessions',
  },
  effectiveDisposals: {
    label: 'Effective Disp.',
    abbr: 'ED',
    color: 'bg-indigo-500',
    weight: 2,
    description: 'Effective disposals (replaces one percenters)',
  },
  scoreInvolvements: {
    label: 'Score Involve.',
    abbr: 'SI',
    color: 'bg-pink-500',
    weight: 5,
    description: 'Score involvements (replaces goal assists)',
  },
} as const;

export default function NineCategoryDisplay({
  players,
  limit = 10,
  title = 'Player Analysis',
  showDetails = false,
  layout = 'compact',
}: NineCategoryDisplayProps) {
  const displayPlayers = players.slice(0, limit);

  if (layout === 'grid') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayPlayers.map((player, index) => (
            <PlayerCard key={player.id} player={player} index={index} showDetails={showDetails} />
          ))}
        </div>
      </div>
    );
  }

  if (layout === 'detailed') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="space-y-4">
          {displayPlayers.map((player, index) => (
            <DetailedPlayerRow key={player.id} player={player} index={index} />
          ))}
        </div>
      </div>
    );
  }

  // Compact layout (default)
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
          9 Categories + Value
        </span>
      </div>

      <div className="space-y-3">
        {displayPlayers.map((player, index) => (
          <CompactPlayerRow key={player.id} player={player} index={index} />
        ))}
      </div>
    </div>
  );
}

// Compact row for the main display
function CompactPlayerRow({ player, index }: { player: PlayerStat; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors border border-gray-100"
    >
      {/* Player Info */}
      <div className="flex items-center space-x-3">
        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-blue-600 font-medium text-xs">{index + 1}</span>
        </div>
        <div>
          <p className="font-medium text-gray-900 text-sm">{player.player_name}</p>
          <p className="text-xs text-gray-500">
            {player.team} • {player.position}
          </p>
        </div>
      </div>

      {/* 9 Categories - Top 5 most impactful */}
      <div className="flex items-center space-x-2">
        {getTopCategories(player.categories)
          .slice(0, 5)
          .map((cat) => (
            <CategoryBadge key={cat.key} category={cat.key} value={cat.value} compact={true} />
          ))}
      </div>

      {/* Total Value + 10th Cell */}
      <div className="text-right">
        <p className="font-bold text-purple-600 text-sm">{player.totalValue}</p>
        <p className="text-xs text-gray-500">
          {player.tenthCell.value}
          {player.tenthCell.label}
        </p>
      </div>
    </motion.div>
  );
}

// Detailed row showing all 9 categories
function DetailedPlayerRow({ player, index }: { player: PlayerStat; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="p-4 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
          <h4 className="font-semibold text-gray-900">{player.player_name}</h4>
          <span className="text-sm text-gray-500">
            {player.team} • {player.position}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <div className="text-right">
            <p className="font-bold text-purple-600 text-lg">{player.totalValue}</p>
            <p className="text-xs text-gray-500">Total Value</p>
          </div>
          <div className="text-right">
            <p className="font-medium text-blue-600">
              {player.tenthCell.value}
              {player.tenthCell.label}
            </p>
            <p className="text-xs text-gray-500">{player.tenthCell.type}</p>
          </div>
        </div>
      </div>

      {/* All 9 Categories */}
      <div className="grid grid-cols-5 gap-2">
        {Object.entries(player.categories).map(([key, value]) => (
          <CategoryBadge
            key={key}
            category={key as keyof typeof CATEGORY_META}
            value={value}
            compact={false}
          />
        ))}
      </div>

      {/* Match Context */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Round {player.round_number} vs {player.opposition} • Season {player.season}
        </p>
      </div>
    </motion.div>
  );
}

// Card layout for grid view
function PlayerCard({
  player,
  index,
  showDetails,
}: {
  player: PlayerStat;
  index: number;
  showDetails: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1 }}
      className="p-4 rounded-lg border border-gray-200 hover:shadow-md transition-all"
    >
      {/* Header */}
      <div className="mb-3">
        <h4 className="font-semibold text-gray-900 truncate">{player.player_name}</h4>
        <p className="text-sm text-gray-500">
          {player.team} • {player.position}
        </p>
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-3 gap-1 mb-3">
        {Object.entries(player.categories).map(([key, value]) => (
          <CategoryBadge
            key={key}
            category={key as keyof typeof CATEGORY_META}
            value={value}
            compact={true}
          />
        ))}
      </div>

      {/* Total Value + 10th Cell */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <div>
          <p className="font-bold text-purple-600">{player.totalValue}</p>
          <p className="text-xs text-gray-500">Total Value</p>
        </div>
        <div className="text-right">
          <p className="font-medium text-blue-600">
            {player.tenthCell.value}
            {player.tenthCell.label}
          </p>
          <p className="text-xs text-gray-500">{player.tenthCell.type}</p>
        </div>
      </div>

      {showDetails && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            Round {player.round_number} vs {player.opposition}
          </p>
        </div>
      )}
    </motion.div>
  );
}

// Individual category badge component
function CategoryBadge({
  category,
  value,
  compact,
}: {
  category: keyof typeof CATEGORY_META;
  value: number;
  compact: boolean;
}) {
  const meta = CATEGORY_META[category];

  return (
    <div className={`px-2 py-1 rounded ${meta.color} ${compact ? 'text-xs' : 'text-sm'}`}>
      <div className="text-center">
        <div className="font-semibold">{value}</div>
        <div className={`${compact ? 'text-xs' : 'text-xs'} opacity-75`}>
          {compact ? meta.abbr : meta.label}
        </div>
      </div>
    </div>
  );
}

// Helper function to get top categories by value
function getTopCategories(categories: PlayerStat['categories']) {
  return Object.entries(categories)
    .map(([key, value]) => ({ key: key as keyof typeof CATEGORY_META, value: value as number }))
    .sort((a, b) => b.value - a.value);
}

// Export category metadata for use in other components
export { CATEGORY_META };
