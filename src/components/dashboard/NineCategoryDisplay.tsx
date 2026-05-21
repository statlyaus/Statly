'use client';

import React from 'react';

import { motion } from 'framer-motion';

import { TeamLogo } from '@/components/TeamLogo';
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
    color: 'bg-destructive',
    weight: 6,
    description: 'Goals scored',
  },
  tackles: {
    label: 'Tackles',
    abbr: 'T',
    color: 'bg-warning',
    weight: 4,
    description: 'Successful tackles',
  },
  inside50s: {
    label: 'Inside 50s',
    abbr: 'I50',
    color: 'bg-info',
    weight: 4,
    description: 'Inside 50 entries (replaces clearances)',
  },
  intercepts: {
    label: 'Intercepts',
    abbr: 'INT',
    color: 'bg-primary',
    weight: 4,
    description: 'Defensive intercepts',
  },
  contestedMarks: {
    label: 'Contested Marks',
    abbr: 'CM',
    color: 'bg-success',
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
    color: 'bg-warning',
    weight: 3,
    description: 'Contested possessions',
  },
  effectiveDisposals: {
    label: 'Effective Disp.',
    abbr: 'ED',
    color: 'bg-info',
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
      <div className="bg-white rounded-xl shadow-sm border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayPlayers.map((player, index) => (
            <PlayerCard key={player.id} player={player} index={index} showDetails={showDetails} />
          ))}
        </div>
      </div>
    );
  }

  // Detailed layout
  if (layout === 'detailed') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-border p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{title}</h3>
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
    <div className="bg-white rounded-xl shadow-sm border border-border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <span className="text-xs text-success bg-success/10 px-2 py-1 rounded">
          All 9 Categories • Top {limit} Players
        </span>
      </div>

      <div className="space-y-2">
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
      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors border border-border min-h-[4rem]"
    >
      {/* Player Info */}
      <div className="flex items-center space-x-3 min-w-0 flex-shrink-0">
        <div className="flex-shrink-0 w-8 h-8 bg-info/10 rounded-full flex items-center justify-center">
          <span className="text-info font-medium text-xs">{index + 1}</span>
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground text-sm truncate">{player.player_name}</p>
          <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
            {player.team ? (
              <TeamLogo team={player.team} size={14} withCircle decorative className="shrink-0" />
            ) : null}
            <span className="truncate">
              {player.team} • {player.position}
            </span>
          </p>
        </div>
      </div>

      {/* 9 Categories - Show fewer but better spaced for compact view */}
      <div className="flex items-center space-x-1 overflow-x-auto flex-shrink-0 px-2">
        {getTopCategories(player.categories)
          .slice(0, 5)
          .map((cat) => (
            <CategoryBadge key={cat.key} category={cat.key} value={cat.value} compact={true} />
          ))}
      </div>

      {/* Total Value + 10th Cell */}
      <div className="text-right flex-shrink-0 min-w-[4rem]">
        <p className="font-bold text-primary text-sm">{player.totalValue}</p>
        <p className="text-xs text-muted-foreground truncate">
          {player.tenthCell.value ?? '—'}
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
      className="p-4 rounded-lg border border-border hover:border-info/20 hover:shadow-sm transition-all bg-white"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center space-x-3 min-w-0">
          <span className="text-sm font-medium text-muted-foreground flex-shrink-0">#{index + 1}</span>
          <h4 className="font-semibold text-foreground truncate">{player.player_name}</h4>
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
            {player.team ? <TeamLogo team={player.team} size={16} withCircle decorative /> : null}
            <span>
              {player.team} • {player.position}
            </span>
          </span>
        </div>
        <div className="flex items-center space-x-4 flex-shrink-0">
          <div className="text-right">
            <p className="font-bold text-primary text-base">{player.totalValue}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-right">
            <p className="font-medium text-info text-sm">
              {player.tenthCell.value ?? '—'}
              {player.tenthCell.label}
            </p>
            <p className="text-xs text-muted-foreground">{player.tenthCell.type}</p>
          </div>
        </div>
      </div>

      {/* All 9 Categories - More responsive grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
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
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
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
      className="p-4 rounded-lg border border-border hover:shadow-md transition-all"
    >
      {/* Header */}
      <div className="mb-3">
        <h4 className="font-semibold text-foreground truncate">{player.player_name}</h4>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {player.team ? <TeamLogo team={player.team} size={16} withCircle decorative /> : null}
          <span>
            {player.team} • {player.position}
          </span>
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
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <div>
          <p className="font-bold text-primary">{player.totalValue}</p>
          <p className="text-xs text-muted-foreground">Total Value</p>
        </div>
        <div className="text-right">
          <p className="font-medium text-info">
            {player.tenthCell.value ?? '—'}
            {player.tenthCell.label}
          </p>
          <p className="text-xs text-muted-foreground">{player.tenthCell.type}</p>
        </div>
      </div>

      {showDetails && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
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

  if (compact) {
    return (
      <div
        className={`${meta.color} text-white rounded-sm px-1 py-0.5 min-w-[2rem] text-center`}
        title={`${meta.label}: ${value}`}
      >
        <div className="text-xs font-bold">{value}</div>
        <div className="text-[9px] opacity-90 leading-none">{meta.abbr}</div>
      </div>
    );
  }

  return (
    <div
      className={`${meta.color} text-white rounded-md p-2 text-center min-h-[3rem] flex flex-col justify-center`}
      title={meta.description}
    >
      <div className="font-bold text-sm">{value}</div>
      <div className="text-xs opacity-90 leading-tight break-words">{meta.abbr}</div>
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
