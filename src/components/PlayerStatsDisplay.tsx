"use client";

import { FANTASY_CATEGORIES, type FantasyCategoryKey, type PlayerStats, getStatValue, getStatColor, calculateLeagueValue } from '@/types/fantasyCategories';

interface PlayerStatsDisplayProps {
  stats?: PlayerStats;
  selectedCategories: FantasyCategoryKey[];
  layout?: 'horizontal' | 'vertical' | 'grid';
  showLabels?: boolean;
  compact?: boolean;
  className?: string;
}

export default function PlayerStatsDisplay({
  stats,
  selectedCategories,
  layout = 'horizontal',
  showLabels = true,
  compact = false,
  className = ''
}: PlayerStatsDisplayProps) {
  if (!selectedCategories.length) {
    return (
      <div className={`text-xs text-gray-500 ${className}`}>
        No categories selected
      </div>
    );
  }

  // Calculate league value as guidance for the user
  const leagueValue = stats && stats.games 
    ? calculateLeagueValue(stats as Record<string, number>, selectedCategories, stats.games)
    : 0;

  const renderStat = (category: FantasyCategoryKey, _index: number) => {
    const categoryData = FANTASY_CATEGORIES[category];
    const value = stats ? stats[category] : undefined;
    const displayValue = getStatValue(stats, category);
    const colorClass = getStatColor(typeof value === 'number' ? value : undefined, category);
    
    return (
      <div
        key={category}
        className={`flex ${layout === 'vertical' ? 'flex-col' : 'flex-row items-center'} ${
          compact ? 'gap-1' : 'gap-2'
        }`}
      >
        {showLabels && (
          <span className={`text-xs font-medium text-gray-500 ${compact ? 'min-w-8' : 'min-w-12'}`}>
            {compact ? categoryData.abbrev : categoryData.label}
          </span>
        )}
        <span className={`text-sm font-medium ${colorClass} ${compact ? 'min-w-6' : 'min-w-8'} text-center`}>
          {displayValue}
        </span>
      </div>
    );
  };

  if (layout === 'grid') {
    return (
      <div className={`grid grid-cols-2 gap-2 ${className}`}>
        {selectedCategories.map(renderStat)}
      </div>
    );
  }

  if (layout === 'vertical') {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        {selectedCategories.map(renderStat)}
      </div>
    );
  }

  // Horizontal layout (default)
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      {selectedCategories.map(renderStat)}
      {leagueValue > 0 && (
        <div className="flex items-center gap-1 border-l pl-3 ml-1">
          <span className="text-gray-500 font-medium text-xs">League Value:</span>
          <span className="font-bold text-purple-600 text-xs">
            {leagueValue.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}

// Compact stats row for table displays
export function CompactStatsRow({
  stats,
  selectedCategories,
  maxDisplay = 4,
  className = ''
}: {
  stats?: PlayerStats;
  selectedCategories: FantasyCategoryKey[];
  maxDisplay?: number;
  className?: string;
}) {
  const displayCategories = selectedCategories.slice(0, maxDisplay);
  const remainingCount = selectedCategories.length - maxDisplay;

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      {displayCategories.map(category => {
        const categoryData = FANTASY_CATEGORIES[category];
        const value = stats ? stats[category] : undefined;
        const displayValue = getStatValue(stats, category);
        const colorClass = getStatColor(typeof value === 'number' ? value : undefined, category);
        
        return (
          <div key={category} className="flex items-center gap-1">
            <span className="text-gray-500 font-medium min-w-6">
              {categoryData.abbrev}:
            </span>
            <span className={`font-semibold ${colorClass} min-w-6`}>
              {displayValue}
            </span>
          </div>
        );
      })}
      {remainingCount > 0 && (
        <span className="text-gray-400 text-xs">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}

// Fantasy points summary component
export function FantasyPointsSummary({
  stats,
  selectedCategories: _selectedCategories,
  weights: _weights,
  className = ''
}: {
  stats?: PlayerStats;
  selectedCategories: FantasyCategoryKey[];
  weights?: Record<FantasyCategoryKey, number>;
  className?: string;
}) {
  if (!stats) {
    return (
      <div className={`text-xs text-gray-500 ${className}`}>
        No stats available
      </div>
    );
  }

  const lastGame = stats.lastGameFantasyPoints;

  return (
    <div className={`flex items-center gap-3 text-xs ${className}`}>
      {lastGame && (
        <div className="flex items-center gap-1">
          <span className="text-gray-500 font-medium">Last:</span>
          <span className="font-semibold text-gray-700">
            {lastGame.toFixed(1)}
          </span>
        </div>
      )}
      {stats.seasonTotal && (
        <div className="flex items-center gap-1">
          <span className="text-gray-500 font-medium">Total:</span>
          <span className="font-semibold text-gray-700">
            {Math.round(stats.seasonTotal)}
          </span>
        </div>
      )}
    </div>
  );
}