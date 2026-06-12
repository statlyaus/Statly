'use client';

import type { ReactElement } from 'react';

import {
  FANTASY_CATEGORIES,
  type FantasyCategoryKey,
  type PlayerStats,
  getStatColor,
  calculateTotalValue,
} from '@/types/fantasyCategories';

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
  className = '',
}: PlayerStatsDisplayProps): ReactElement {
  if (!selectedCategories.length) {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>No categories selected</div>
    );
  }

  // Calculate total value using your weighted scoring system
  const totalValue = stats ? calculateTotalValue(stats) : 0;

  const renderStat = (category: FantasyCategoryKey, _index: number) => {
    const categoryData = FANTASY_CATEGORIES[category];
    const value = stats ? stats[category] : undefined;
    // Calculate per-game average for display
    const perGameValue = stats && stats.games > 0 ? (stats[category] || 0) / stats.games : 0;
    const displayValue =
      categoryData.format === 'percentage'
        ? `${perGameValue.toFixed(1)}%`
        : perGameValue.toFixed(1);
    const colorClass = getStatColor(typeof value === 'number' ? value : undefined, category);

    return (
      <div
        key={category}
        className={`flex ${layout === 'vertical' ? 'flex-col' : 'flex-row items-center'} ${
          compact ? 'gap-1' : 'gap-2'
        }`}
      >
        {showLabels && (
          <span
            className={`text-xs font-medium text-muted-foreground ${compact ? 'min-w-8' : 'min-w-12'}`}
          >
            {compact ? categoryData.abbrev : categoryData.label}
          </span>
        )}
        <span
          className={`text-sm font-medium ${colorClass} ${compact ? 'min-w-6' : 'min-w-8'} text-center`}
        >
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
      <div className={`flex flex-col gap-1 ${className}`}>{selectedCategories.map(renderStat)}</div>
    );
  }

  // Horizontal layout (default)
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      {selectedCategories.map(renderStat)}
      {totalValue > 0 && (
        <div className="flex items-center gap-1 border-l pl-3 ml-1">
          <span className="text-muted-foreground font-medium text-xs">Total Value:</span>
          <span className="font-bold text-primary text-xs">{totalValue.toFixed(0)}</span>
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
  className = '',
}: {
  stats?: Partial<PlayerStats>;
  selectedCategories: FantasyCategoryKey[];
  maxDisplay?: number;
  className?: string;
}): ReactElement {
  const availableCategories = selectedCategories.filter((category) => FANTASY_CATEGORIES[category]);
  const displayCategories = availableCategories.slice(0, maxDisplay);
  const remainingCount = availableCategories.length - maxDisplay;

  if (!stats || displayCategories.length === 0) {
    return (
      <div
        className={`inline-flex items-center rounded-md border border-dashed border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground ${className}`}
      >
        League stats unavailable
      </div>
    );
  }

  return (
    <div
      className={`grid overflow-hidden rounded-md border border-border bg-muted/25 text-xs ${className}`}
      style={{ gridTemplateColumns: `repeat(${displayCategories.length}, minmax(0, 1fr))` }}
    >
      {displayCategories.map((category) => {
        const categoryData = FANTASY_CATEGORIES[category];
        const value = stats[category];
        const hasValue = typeof value === 'number' && Number.isFinite(value);
        const displayValue = hasValue
          ? categoryData.format === 'percentage'
            ? `${value.toFixed(1)}%`
            : value.toFixed(categoryData.format === 'decimal' ? 2 : 1)
          : '—';

        return (
          <div
            key={category}
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-1.5 border-r border-border/70 px-2 py-1.5 last:border-r-0"
            aria-label={`${categoryData.label}: ${displayValue}`}
          >
            <span className="text-[10px] font-semibold uppercase leading-none text-muted-foreground">
              {categoryData.abbrev}
            </span>
            <span className="min-w-0 text-right font-semibold tabular-nums text-foreground">
              {displayValue}
            </span>
          </div>
        );
      })}
      {remainingCount > 0 && (
        <span className="self-center text-xs text-muted-foreground">+{remainingCount} more</span>
      )}
    </div>
  );
}

// Fantasy points summary component
export function FantasyPointsSummary({
  stats,
  selectedCategories: _selectedCategories,
  weights: _weights,
  className = '',
}: {
  stats?: PlayerStats;
  selectedCategories: FantasyCategoryKey[];
  weights?: Record<FantasyCategoryKey, number>;
  className?: string;
}): ReactElement {
  if (!stats) {
    return <div className={`text-xs text-muted-foreground ${className}`}>No stats available</div>;
  }

  const lastGame = stats.lastGameFantasyPoints;

  return (
    <div className={`flex items-center gap-3 text-xs ${className}`}>
      {lastGame && (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground font-medium">Last:</span>
          <span className="font-semibold text-foreground">{lastGame.toFixed(1)}</span>
        </div>
      )}
      {stats.seasonTotal && (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground font-medium">Total:</span>
          <span className="font-semibold text-foreground">{Math.round(stats.seasonTotal)}</span>
        </div>
      )}
    </div>
  );
}
