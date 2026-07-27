'use client';
import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';

import Image from 'next/image';

import { CheckCircle2, Info, ListPlus, Star } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getTeamAbbreviation, getTeamLogo } from '@/lib/teamLogos';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';
import type { DraftPlayer } from '@/types/draft';

type PlayerGridSortKey =
  | 'statlyZ'
  | 'name'
  | 'position'
  | 'club'
  | 'adp'
  | `category:${FantasyCategoryKey}`;

interface PlayerGridProps {
  players: DraftPlayer[];
  totalPlayers: number;
  onPlayerSelect: (player: DraftPlayer) => void | Promise<void>;
  onAddToQueue: (player: DraftPlayer) => void;
  onToggleWatchlist: (player: DraftPlayer) => void;
  canMakePick: boolean;
  queuedPlayerIds: string[];
  watchedPlayerIds: string[];
  pendingWatchlistPlayerIds?: string[];
  selectedCategories: FantasyCategoryKey[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  positionFilter: string;
  onPositionFilterChange: (position: string) => void;
  availablePositions: string[];
  sortBy: PlayerGridSortKey;
  onSortChange: (sort: PlayerGridSortKey) => void;
  statSeason?: number | null;
  statSeasons?: number[];
  onStatSeasonChange?: (season: number) => void;
  isLoading: boolean;
  emptyStateMessage?: string;
  className?: string;
}

const PLAYER_COLUMN_WIDTH = 340;
const Z_SCORE_COLUMN_WIDTH = 144;
const STAT_COLUMN_WIDTH = 88;
const ACTIONS_COLUMN_WIDTH = 236;
const TABLE_VIEWPORT_HEIGHT = 680;
const VIRTUALIZED_ROW_HEIGHT = 112;
const VIRTUALIZED_ROW_OVERSCAN = 6;
const VIRTUALIZED_ROW_THRESHOLD = 120;
const STATLY_Z_DESCRIPTION = "Combined Z score across this league's selected scoring categories.";
const ACTION_BUTTON_BASE_CLASS =
  'inline-flex h-10 w-full justify-center items-center gap-1 rounded-md px-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const ACTION_BUTTON_DISABLED_CLASS =
  'cursor-not-allowed border border-border bg-muted/70 text-muted-foreground';
const ACTION_BUTTON_OUTLINE_CLASS =
  'border border-input bg-[color:var(--draft-broadcast-field)] text-foreground hover:bg-[color:var(--draft-broadcast-field-strong)]';

interface VisibleRowRange {
  start: number;
  end: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

function formatLeagueStat(player: DraftPlayer, category: FantasyCategoryKey): string {
  const categoryData = FANTASY_CATEGORIES[category];
  const value = player.stats?.[category];

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  if (categoryData.format === 'percentage') {
    return `${value.toFixed(1)}%`;
  }

  return value.toFixed(categoryData.format === 'decimal' ? 2 : 1);
}

function getCategorySortKey(category: FantasyCategoryKey): PlayerGridSortKey {
  return `category:${category}`;
}

function getStatSeasonLabel(season: number): string {
  const currentSeason = new Date().getFullYear();
  if (season === currentSeason) return `${season} current`;
  if (season === currentSeason - 1) return `${season} previous`;
  return String(season);
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return Boolean(value && typeof value.then === 'function');
}

function getWatchActionClass(isDisabled: boolean, isWatched: boolean): string {
  if (isDisabled) {
    return `${ACTION_BUTTON_BASE_CLASS} font-medium ${ACTION_BUTTON_DISABLED_CLASS}`;
  }

  if (isWatched) {
    return `${ACTION_BUTTON_BASE_CLASS} border border-border bg-accent font-medium text-accent-foreground hover:bg-accent/80`;
  }

  return `${ACTION_BUTTON_BASE_CLASS} ${ACTION_BUTTON_OUTLINE_CLASS} font-medium`;
}

function getQueueActionClass(isDisabled: boolean): string {
  return `${ACTION_BUTTON_BASE_CLASS} font-medium ${
    isDisabled ? ACTION_BUTTON_DISABLED_CLASS : ACTION_BUTTON_OUTLINE_CLASS
  }`;
}

function getSelectActionClass(isDisabled: boolean): string {
  return `${ACTION_BUTTON_BASE_CLASS} font-semibold ${
    isDisabled
      ? 'cursor-not-allowed bg-muted text-muted-foreground'
      : 'bg-primary text-primary-foreground hover:bg-primary/90'
  }`;
}

interface PlayerIdentityCellProps {
  player: DraftPlayer;
  teamLogo: string;
  teamAbbreviation: string;
  isQueued: boolean;
  isWatched: boolean;
}

function PlayerIdentityCell({
  player,
  teamLogo,
  teamAbbreviation,
  isQueued,
  isWatched,
}: PlayerIdentityCellProps): React.JSX.Element {
  const showInjury = player.injuryStatus && player.injuryStatus !== 'healthy';

  return (
    <th
      scope="row"
      className="sticky left-0 z-[1] bg-card px-4 py-4 font-normal shadow-[1px_0_0_0_var(--draft-broadcast-border-soft)] transition-colors group-hover:bg-[color:var(--draft-broadcast-table-row-hover)] sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border border-border bg-[color:var(--draft-broadcast-field)] p-1.5 shadow-sm">
          <Image
            src={teamLogo}
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            unoptimized={teamLogo.endsWith('.svg')}
            className="h-8 max-w-8 object-contain"
            style={{ width: 'auto' }}
          />
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{player.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded-md border border-border bg-[color:var(--draft-broadcast-field)] px-2 py-0.5 font-semibold text-foreground">
              {player.position}
            </span>
            <span className="rounded-md border border-border bg-[color:var(--draft-broadcast-field)] px-2 py-0.5 font-medium text-foreground">
              {teamAbbreviation}
            </span>
            <span>{player.club}</span>
            {player.adp && (
              <span className="rounded-md bg-muted px-2 py-0.5">ADP {player.adp}</span>
            )}
            {isQueued && (
              <span className="rounded-md border border-primary/30 bg-primary/15 px-2 py-0.5 font-medium text-primary">
                Queued
              </span>
            )}
            {isWatched && (
              <span className="rounded-md border border-border bg-accent px-2 py-0.5 font-medium text-accent-foreground">
                Watchlist
              </span>
            )}
            {showInjury && (
              <span className="rounded-md border border-warning/40 bg-warning/15 px-2 py-0.5 font-medium text-warning-foreground">
                {getInjuryLabel(player.injuryStatus)}
              </span>
            )}
          </div>
        </div>
      </div>
    </th>
  );
}

function getInjuryLabel(status: DraftPlayer['injuryStatus']): string {
  if (status === 'out') return 'Out';
  if (status === 'injured') return 'Injured';
  return 'Questionable';
}

function PlayerStatlyZCell({ player }: { player: DraftPlayer }): React.JSX.Element {
  const statlyZScore = typeof player.statlyZScore === 'number' ? player.statlyZScore : null;

  return (
    <td className="border-l border-border/60 px-4 py-4 text-center align-middle">
      <span className="inline-flex min-w-16 justify-center text-lg font-semibold leading-none text-foreground tabular-nums">
        {statlyZScore !== null ? statlyZScore.toFixed(2) : 'Pending'}
      </span>
    </td>
  );
}

interface PlayerStatCellsProps {
  player: DraftPlayer;
  visibleCategories: FantasyCategoryKey[];
}

function PlayerStatCells({ player, visibleCategories }: PlayerStatCellsProps): React.JSX.Element {
  if (visibleCategories.length === 0) {
    return (
      <td className="border-l border-border/60 px-4 py-4 align-middle text-sm text-muted-foreground">
        League categories pending.
      </td>
    );
  }

  return (
    <>
      {visibleCategories.map((category) => {
        const categoryData = FANTASY_CATEGORIES[category];
        const displayValue = formatLeagueStat(player, category);

        return (
          <td
            key={category}
            className="border-l border-border/60 px-3 py-4 text-center align-middle text-sm font-semibold text-foreground"
            aria-label={`${categoryData.label}: ${displayValue}`}
          >
            <span className="inline-flex min-w-12 justify-center tabular-nums">{displayValue}</span>
          </td>
        );
      })}
    </>
  );
}

interface PlayerRowActionsProps {
  player: DraftPlayer;
  isWatched: boolean;
  isQueued: boolean;
  isLoading: boolean;
  isWatchlistPending: boolean;
  selectionInFlight: boolean;
  canMakePick: boolean;
  pendingSelectionId: string | null;
  onToggleWatchlist: (player: DraftPlayer) => void;
  onAddToQueue: (player: DraftPlayer) => void;
  onSelect: (player: DraftPlayer) => void;
}

function PlayerRowActions({
  player,
  isWatched,
  isQueued,
  isLoading,
  isWatchlistPending,
  selectionInFlight,
  canMakePick,
  pendingSelectionId,
  onToggleWatchlist,
  onAddToQueue,
  onSelect,
}: PlayerRowActionsProps): React.JSX.Element {
  const actionDisabled = isLoading || selectionInFlight;
  const watchlistDisabled = isWatchlistPending;
  const queueDisabled = actionDisabled || isQueued;
  const selectDisabled = !canMakePick || actionDisabled;

  return (
    <td className="border-l border-border/60 px-3 py-4 align-middle">
      <div className="grid grid-cols-3 items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleWatchlist(player);
          }}
          disabled={watchlistDisabled}
          className={getWatchActionClass(watchlistDisabled, isWatched)}
          aria-label={`${isWatched ? 'Remove' : 'Add'} ${player.name} ${isWatched ? 'from' : 'to'} watchlist`}
        >
          <Star className="h-4 w-4" aria-hidden="true" fill={isWatched ? 'currentColor' : 'none'} />
          <span className="hidden 2xl:inline">{isWatched ? 'Watched' : 'Watch'}</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAddToQueue(player);
          }}
          disabled={queueDisabled}
          className={getQueueActionClass(queueDisabled)}
          aria-label={isQueued ? `${player.name} already in queue` : `Add ${player.name} to queue`}
        >
          <ListPlus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden 2xl:inline">{isQueued ? 'Queued' : 'Queue'}</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(player);
          }}
          disabled={selectDisabled}
          className={getSelectActionClass(selectDisabled)}
          aria-label={`Select ${player.name}`}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <span className="hidden 2xl:inline">
            {isLoading || pendingSelectionId === player.id ? 'Selecting' : 'Select'}
          </span>
        </button>
      </div>
    </td>
  );
}

interface PlayerTableRowProps {
  player: DraftPlayer;
  index: number;
  isFocused: boolean;
  isSelected: boolean;
  isQueued: boolean;
  isWatched: boolean;
  isLoading: boolean;
  isWatchlistPending: boolean;
  selectionInFlight: boolean;
  canMakePick: boolean;
  pendingSelectionId: string | null;
  visibleCategories: FantasyCategoryKey[];
  onKeyDown: (event: React.KeyboardEvent, playerIndex: number) => void;
  onFocusChange: (index: number | null) => void;
  onSelect: (player: DraftPlayer) => void;
  onAddToQueue: (player: DraftPlayer) => void;
  onToggleWatchlist: (player: DraftPlayer) => void;
  registerRow: (index: number, element: HTMLTableRowElement | null) => void;
}

function PlayerTableRow({
  player,
  index,
  isFocused,
  isSelected,
  isQueued,
  isWatched,
  isLoading,
  isWatchlistPending,
  selectionInFlight,
  canMakePick,
  pendingSelectionId,
  visibleCategories,
  onKeyDown,
  onFocusChange,
  onSelect,
  onAddToQueue,
  onToggleWatchlist,
  registerRow,
}: PlayerTableRowProps): React.JSX.Element {
  const teamLogo = getTeamLogo(player.club);
  const teamAbbreviation = getTeamAbbreviation(player.club);
  const rowClassName = `group cursor-pointer bg-[color:var(--draft-broadcast-table)] transition-colors [content-visibility:auto] hover:bg-[color:var(--draft-broadcast-table-row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
    isFocused ? 'bg-[color:var(--draft-broadcast-table-row-hover)] ring-2 ring-inset ring-ring' : ''
  } ${isSelected ? 'bg-primary/15' : ''}`;

  return (
    <tr
      key={player.id}
      ref={(element) => registerRow(index, element)}
      className={rowClassName}
      tabIndex={0}
      onKeyDown={(event) => onKeyDown(event, index)}
      onFocus={() => onFocusChange(index)}
      onBlur={() => onFocusChange(null)}
      onClick={() => onSelect(player)}
      aria-label={`${player.name}, ${player.position}, ${player.club}. Press Enter to select.`}
      aria-rowindex={index + (visibleCategories.length > 0 ? 3 : 2)}
      data-selected={isSelected ? 'true' : undefined}
    >
      <PlayerIdentityCell
        player={player}
        teamLogo={teamLogo}
        teamAbbreviation={teamAbbreviation}
        isQueued={isQueued}
        isWatched={isWatched}
      />
      <PlayerStatlyZCell player={player} />
      <PlayerStatCells player={player} visibleCategories={visibleCategories} />
      <PlayerRowActions
        player={player}
        isWatched={isWatched}
        isQueued={isQueued}
        isLoading={isLoading}
        isWatchlistPending={isWatchlistPending}
        selectionInFlight={selectionInFlight}
        canMakePick={canMakePick}
        pendingSelectionId={pendingSelectionId}
        onToggleWatchlist={onToggleWatchlist}
        onAddToQueue={onAddToQueue}
        onSelect={onSelect}
      />
    </tr>
  );
}

interface PlayerGridControlsProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  positionFilter: string;
  onPositionFilterChange: (position: string) => void;
  availablePositions: string[];
  sortBy: PlayerGridSortKey;
  onSortChange: (sort: PlayerGridSortKey) => void;
  statSeason?: number | null;
  statSeasons?: number[];
  onStatSeasonChange?: (season: number) => void;
  filteredPlayerCount: number;
  totalPlayers: number;
  hasActiveFilters: boolean;
}

function PlayerGridControls({
  searchInputRef,
  searchQuery,
  onSearchChange,
  positionFilter,
  onPositionFilterChange,
  availablePositions,
  sortBy,
  onSortChange,
  statSeason,
  statSeasons = [],
  onStatSeasonChange,
  filteredPlayerCount,
  totalPlayers,
  hasActiveFilters,
}: PlayerGridControlsProps): React.JSX.Element {
  return (
    <div className="border-b border-border bg-[color:var(--draft-broadcast-panel)] px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 xl:flex-row">
        <div className="flex-1">
          <label htmlFor="player-search" className="sr-only">
            Search players
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              ref={searchInputRef}
              id="player-search"
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search players by name, position, or club..."
              className="block h-12 w-full rounded-md border border-input bg-[color:var(--draft-broadcast-field)] py-2.5 pl-10 pr-3 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="xl:w-44">
          <label htmlFor="stats-season" className="sr-only">
            Stats season
          </label>
          <select
            id="stats-season"
            value={statSeason ?? ''}
            onChange={(event) => onStatSeasonChange?.(Number(event.target.value))}
            disabled={!onStatSeasonChange || statSeasons.length === 0}
            className="block h-12 w-full rounded-md border border-input bg-[color:var(--draft-broadcast-field)] px-3 py-2.5 text-sm leading-5 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {statSeasons.length === 0 ? (
              <option value="">Stats season</option>
            ) : (
              statSeasons.map((season) => (
                <option key={season} value={season}>
                  {getStatSeasonLabel(season)}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="xl:w-48">
          <label htmlFor="position-filter" className="sr-only">
            Filter by position
          </label>
          <select
            id="position-filter"
            value={positionFilter}
            onChange={(event) => onPositionFilterChange(event.target.value)}
            className="block h-12 w-full rounded-md border border-input bg-[color:var(--draft-broadcast-field)] px-3 py-2.5 text-sm leading-5 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {availablePositions.map((position) => (
              <option key={position} value={position}>
                {position === 'ALL' ? 'All Positions' : position}
              </option>
            ))}
          </select>
        </div>

        <div className="xl:w-48">
          <label htmlFor="sort-by" className="sr-only">
            Sort by
          </label>
          <select
            id="sort-by"
            value={sortBy}
            onChange={(event) => onSortChange(event.target.value as PlayerGridSortKey)}
            className="block h-12 w-full rounded-md border border-input bg-[color:var(--draft-broadcast-field)] px-3 py-2.5 text-sm leading-5 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="statlyZ">Sort by Statly Z</option>
            <option value="adp">Sort by ADP</option>
            <option value="name">Sort by Name</option>
            <option value="position">Sort by Position</option>
            <option value="club">Sort by Club</option>
          </select>
        </div>
      </div>

      <div className="mt-3 text-sm font-medium text-muted-foreground">
        <div>
          Showing {filteredPlayerCount} of {totalPlayers} players
          {hasActiveFilters && (
            <span className="ml-2">Filtered by your current search and sort.</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlayerGridEmptyStateProps {
  hasActiveFilters: boolean;
  emptyStateMessage?: string;
  className?: string;
  onClearFilters: () => void;
  onScrollToTop: () => void;
}

function PlayerGridEmptyState({
  hasActiveFilters,
  emptyStateMessage,
  className,
  onClearFilters,
  onScrollToTop,
}: PlayerGridEmptyStateProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex h-full min-h-[28rem] flex-col items-center justify-center rounded-lg border border-border bg-card px-6 py-12 text-center text-card-foreground',
        className
      )}
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--draft-broadcast-field)] text-2xl">
        🔍
      </div>
      <h3 className="text-lg font-semibold text-foreground">
        {hasActiveFilters ? 'No players match your filters' : 'No players found'}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {hasActiveFilters
          ? 'Clear your search or filters to bring the full board back into view.'
          : (emptyStateMessage ??
            'The player pool is empty right now. Refresh the draft room or try again once players are loaded.')}
      </p>
      {hasActiveFilters && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onScrollToTop}
            className="inline-flex items-center rounded-full border border-border bg-[color:var(--draft-broadcast-field)] px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-[color:var(--draft-broadcast-field-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Scroll to top
          </button>
        </div>
      )}
    </div>
  );
}

interface PlayerGridTableProps {
  filteredPlayers: DraftPlayer[];
  visiblePlayers: DraftPlayer[];
  visibleCategories: FantasyCategoryKey[];
  visibleRange: VisibleRowRange;
  tableMinWidth: number;
  statColumnCount: number;
  shouldWindowRows: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  rowRefs: React.MutableRefObject<Array<HTMLTableRowElement | null>>;
  focusedRow: number | null;
  selectedPlayerId: string | null;
  queuedIds: ReadonlySet<string>;
  watchedIds: ReadonlySet<string>;
  pendingWatchlistIds: ReadonlySet<string>;
  isLoading: boolean;
  selectionInFlight: boolean;
  canMakePick: boolean;
  pendingSelectionId: string | null;
  sortBy: PlayerGridSortKey;
  onSortChange: (sort: PlayerGridSortKey) => void;
  setScrollTop: (scrollTop: number) => void;
  onKeyDown: (event: React.KeyboardEvent, playerIndex: number) => void;
  onFocusChange: (index: number | null) => void;
  onSelect: (player: DraftPlayer) => void;
  onAddToQueue: (player: DraftPlayer) => void;
  onToggleWatchlist: (player: DraftPlayer) => void;
}

function PlayerGridTable({
  filteredPlayers,
  visiblePlayers,
  visibleCategories,
  visibleRange,
  tableMinWidth,
  statColumnCount,
  shouldWindowRows,
  scrollContainerRef,
  rowRefs,
  focusedRow,
  selectedPlayerId,
  queuedIds,
  watchedIds,
  pendingWatchlistIds,
  isLoading,
  selectionInFlight,
  canMakePick,
  pendingSelectionId,
  sortBy,
  onSortChange,
  setScrollTop,
  onKeyDown,
  onFocusChange,
  onSelect,
  onAddToQueue,
  onToggleWatchlist,
}: PlayerGridTableProps): React.JSX.Element {
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollContainerRef}
        className="h-full overflow-auto bg-[color:var(--draft-broadcast-table)]"
        onScroll={(event) => {
          if (shouldWindowRows) {
            setScrollTop(event.currentTarget.scrollTop);
          }
        }}
      >
        <table
          className="w-full table-fixed border-collapse text-left"
          style={{ minWidth: tableMinWidth }}
          aria-rowcount={filteredPlayers.length + (visibleCategories.length > 0 ? 2 : 1)}
          aria-label="Available draft players"
        >
          <caption className="sr-only">
            Available draft players with Statly Z, league stats, and draft actions.
          </caption>
          <colgroup>
            <col style={{ width: PLAYER_COLUMN_WIDTH }} />
            <col style={{ width: Z_SCORE_COLUMN_WIDTH }} />
            {visibleCategories.length > 0 ? (
              visibleCategories.map((category) => (
                <col key={category} style={{ width: STAT_COLUMN_WIDTH }} />
              ))
            ) : (
              <col style={{ width: STAT_COLUMN_WIDTH }} />
            )}
            <col style={{ width: ACTIONS_COLUMN_WIDTH }} />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border bg-[color:var(--draft-broadcast-panel)] text-sm font-medium text-muted-foreground backdrop-blur">
            <tr>
              <th
                scope="col"
                rowSpan={visibleCategories.length > 0 ? 2 : 1}
                className="sticky left-0 z-20 bg-[color:var(--draft-broadcast-panel)] px-4 py-3 font-semibold shadow-[1px_0_0_0_var(--draft-broadcast-border-soft)] sm:px-5"
              >
                Player
              </th>
              <th
                scope="col"
                rowSpan={visibleCategories.length > 0 ? 2 : 1}
                aria-sort={sortBy === 'statlyZ' ? 'descending' : 'none'}
                className="border-l border-border/70 px-3 py-3 text-center font-semibold"
              >
                <button
                  type="button"
                  onClick={() => onSortChange('statlyZ')}
                  className="mx-auto inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase text-foreground transition-colors hover:bg-[color:var(--draft-broadcast-field)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label="Sort by Statly Z"
                  title={STATLY_Z_DESCRIPTION}
                >
                  <span>Statly Z</span>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </button>
              </th>
              <th
                scope={visibleCategories.length > 0 ? 'colgroup' : 'col'}
                colSpan={visibleCategories.length > 0 ? visibleCategories.length : 1}
                className="border-x border-border/70 px-4 py-3 text-center font-semibold"
              >
                League Stats
              </th>
              <th
                scope="col"
                rowSpan={visibleCategories.length > 0 ? 2 : 1}
                className="px-4 py-3 text-center font-semibold sm:px-5"
              >
                Actions
              </th>
            </tr>
            {visibleCategories.length > 0 && (
              <tr className="border-t border-border/70">
                {visibleCategories.map((category) => {
                  const categoryData = FANTASY_CATEGORIES[category];

                  return (
                    <th
                      key={category}
                      scope="col"
                      aria-label={categoryData.label}
                      aria-sort={sortBy === getCategorySortKey(category) ? 'descending' : 'none'}
                      className="border-l border-border/70 px-3 py-2 text-center text-[11px] font-semibold uppercase text-muted-foreground first:border-l"
                      title={categoryData.label}
                    >
                      <button
                        type="button"
                        onClick={() => onSortChange(getCategorySortKey(category))}
                        className="mx-auto inline-flex min-h-7 min-w-10 items-center justify-center rounded-md px-2 text-[11px] font-semibold uppercase text-muted-foreground transition-colors hover:bg-[color:var(--draft-broadcast-field)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        aria-label={`Sort by ${categoryData.label}`}
                      >
                        {categoryData.abbrev}
                      </button>
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-[color:var(--draft-broadcast-border-soft)]">
            {shouldWindowRows && visibleRange.topSpacerHeight > 0 && (
              <tr aria-hidden="true" role="presentation">
                <td
                  colSpan={2 + statColumnCount + 1}
                  className="border-0 p-0"
                  style={{ height: visibleRange.topSpacerHeight }}
                />
              </tr>
            )}
            {visiblePlayers.map((player, visibleIndex) => {
              const index = visibleRange.start + visibleIndex;

              return (
                <PlayerTableRow
                  key={player.id}
                  player={player}
                  index={index}
                  isFocused={focusedRow === index}
                  isSelected={selectedPlayerId === player.id}
                  isQueued={queuedIds.has(player.id)}
                  isWatched={watchedIds.has(player.id)}
                  isWatchlistPending={pendingWatchlistIds.has(player.id)}
                  isLoading={isLoading}
                  selectionInFlight={selectionInFlight}
                  canMakePick={canMakePick}
                  pendingSelectionId={pendingSelectionId}
                  visibleCategories={visibleCategories}
                  onKeyDown={onKeyDown}
                  onFocusChange={onFocusChange}
                  onSelect={onSelect}
                  onAddToQueue={onAddToQueue}
                  onToggleWatchlist={onToggleWatchlist}
                  registerRow={(rowIndex, element) => {
                    rowRefs.current[rowIndex] = element;
                  }}
                />
              );
            })}
            {shouldWindowRows && visibleRange.bottomSpacerHeight > 0 && (
              <tr aria-hidden="true" role="presentation">
                <td
                  colSpan={2 + statColumnCount + 1}
                  className="border-0 p-0"
                  style={{ height: visibleRange.bottomSpacerHeight }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--draft-broadcast-overlay)]">
          <div className="text-center">
            <div
              className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-primary"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">Processing...</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlayerGrid({
  players,
  totalPlayers,
  onPlayerSelect,
  onAddToQueue,
  onToggleWatchlist,
  canMakePick,
  queuedPlayerIds,
  watchedPlayerIds,
  pendingWatchlistPlayerIds = [],
  selectedCategories,
  searchQuery,
  onSearchChange,
  positionFilter,
  onPositionFilterChange,
  availablePositions,
  sortBy,
  onSortChange,
  statSeason,
  statSeasons,
  onStatSeasonChange,
  isLoading,
  emptyStateMessage,
  className,
}: PlayerGridProps): React.JSX.Element {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queuedIds = useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const watchedIds = useMemo(() => new Set(watchedPlayerIds), [watchedPlayerIds]);
  const pendingWatchlistIds = useMemo(
    () => new Set(pendingWatchlistPlayerIds),
    [pendingWatchlistPlayerIds]
  );
  const visibleCategories = useMemo(
    () => selectedCategories.filter((category) => FANTASY_CATEGORIES[category]),
    [selectedCategories]
  );
  const filteredPlayers = players;

  const hasActiveFilters =
    searchQuery.trim().length > 0 || positionFilter !== 'ALL' || sortBy !== 'statlyZ';
  const selectionInFlight = pendingSelectionId !== null;
  const statColumnCount = Math.max(visibleCategories.length, 1);
  const tableMinWidth =
    PLAYER_COLUMN_WIDTH +
    Z_SCORE_COLUMN_WIDTH +
    statColumnCount * STAT_COLUMN_WIDTH +
    ACTIONS_COLUMN_WIDTH;
  const shouldWindowRows = filteredPlayers.length > VIRTUALIZED_ROW_THRESHOLD;
  const visibleRange = useMemo<VisibleRowRange>(() => {
    if (!shouldWindowRows) {
      return {
        start: 0,
        end: filteredPlayers.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const firstVisibleRow = Math.floor(scrollTop / VIRTUALIZED_ROW_HEIGHT);
    const start = Math.max(0, firstVisibleRow - VIRTUALIZED_ROW_OVERSCAN);
    const visibleRowCount =
      Math.ceil(TABLE_VIEWPORT_HEIGHT / VIRTUALIZED_ROW_HEIGHT) + VIRTUALIZED_ROW_OVERSCAN * 2;
    const end = Math.min(filteredPlayers.length, start + visibleRowCount);

    return {
      start,
      end,
      topSpacerHeight: start * VIRTUALIZED_ROW_HEIGHT,
      bottomSpacerHeight: (filteredPlayers.length - end) * VIRTUALIZED_ROW_HEIGHT,
    };
  }, [filteredPlayers.length, scrollTop, shouldWindowRows]);
  const visiblePlayers = useMemo(
    () => filteredPlayers.slice(visibleRange.start, visibleRange.end),
    [filteredPlayers, visibleRange.end, visibleRange.start]
  );

  // Handle player selection
  const handlePlayerSelect = useCallback(
    (player: DraftPlayer) => {
      if (!canMakePick || selectionInFlight) return;

      const clearPendingSelection = () => {
        setPendingSelectionId(null);
        setSelectedPlayerId((currentPlayerId) =>
          currentPlayerId === player.id ? null : currentPlayerId
        );
      };

      setPendingSelectionId(player.id);
      setSelectedPlayerId(player.id);

      const selectionResult = onPlayerSelect(player);

      if (isPromiseLike(selectionResult)) {
        void selectionResult.finally(clearPendingSelection);
        return;
      }

      clearPendingSelection();
    },
    [canMakePick, onPlayerSelect, selectionInFlight]
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, playerIndex: number) => {
      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const nextIndex = Math.min(playerIndex + 1, filteredPlayers.length - 1);
          setFocusedRow(nextIndex);
          rowRefs.current[nextIndex]?.scrollIntoView({ block: 'center' });
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const prevIndex = Math.max(playerIndex - 1, 0);
          setFocusedRow(prevIndex);
          rowRefs.current[prevIndex]?.scrollIntoView({ block: 'center' });
          break;
        }
        case 'Enter':
        case ' ': {
          event.preventDefault();
          void handlePlayerSelect(filteredPlayers[playerIndex]);
          break;
        }
        case 'Home': {
          event.preventDefault();
          setFocusedRow(0);
          rowRefs.current[0]?.scrollIntoView({ block: 'start' });
          break;
        }
        case 'End': {
          event.preventDefault();
          const lastIndex = filteredPlayers.length - 1;
          setFocusedRow(lastIndex);
          rowRefs.current[lastIndex]?.scrollIntoView({ block: 'end' });
          break;
        }
        default:
          break;
      }
    },
    [filteredPlayers, handlePlayerSelect]
  );

  // Focus management
  useEffect(() => {
    if (focusedRow !== null) {
      if (shouldWindowRows) {
        scrollContainerRef.current?.scrollTo?.({
          top: Math.max(0, focusedRow * VIRTUALIZED_ROW_HEIGHT - TABLE_VIEWPORT_HEIGHT / 2),
          behavior: 'auto',
        });
      } else {
        rowRefs.current[focusedRow]?.scrollIntoView({ block: 'center' });
      }
    }
  }, [focusedRow, shouldWindowRows]);

  useEffect(() => {
    rowRefs.current = [];
    setFocusedRow(null);
    setScrollTop(0);
    scrollContainerRef.current?.scrollTo?.({ top: 0, behavior: 'auto' });
  }, [searchQuery, positionFilter, sortBy, filteredPlayers.length]);

  // Empty state
  if (filteredPlayers.length === 0) {
    return (
      <PlayerGridEmptyState
        hasActiveFilters={hasActiveFilters}
        emptyStateMessage={emptyStateMessage}
        className={className}
        onClearFilters={() => {
          onSearchChange('');
          onPositionFilterChange('ALL');
          onSortChange('statlyZ');
        }}
        onScrollToTop={() => rowRefs.current[0]?.scrollIntoView({ block: 'start' })}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm',
        className
      )}
    >
      <PlayerGridControls
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        positionFilter={positionFilter}
        onPositionFilterChange={onPositionFilterChange}
        availablePositions={availablePositions}
        sortBy={sortBy}
        onSortChange={onSortChange}
        statSeason={statSeason}
        statSeasons={statSeasons}
        onStatSeasonChange={onStatSeasonChange}
        filteredPlayerCount={filteredPlayers.length}
        totalPlayers={totalPlayers}
        hasActiveFilters={hasActiveFilters}
      />

      <PlayerGridTable
        filteredPlayers={filteredPlayers}
        visiblePlayers={visiblePlayers}
        visibleCategories={visibleCategories}
        visibleRange={visibleRange}
        tableMinWidth={tableMinWidth}
        statColumnCount={statColumnCount}
        shouldWindowRows={shouldWindowRows}
        scrollContainerRef={scrollContainerRef}
        rowRefs={rowRefs}
        focusedRow={focusedRow}
        selectedPlayerId={selectedPlayerId}
        queuedIds={queuedIds}
        watchedIds={watchedIds}
        pendingWatchlistIds={pendingWatchlistIds}
        isLoading={isLoading}
        selectionInFlight={selectionInFlight}
        canMakePick={canMakePick}
        pendingSelectionId={pendingSelectionId}
        sortBy={sortBy}
        onSortChange={onSortChange}
        setScrollTop={setScrollTop}
        onKeyDown={handleKeyDown}
        onFocusChange={setFocusedRow}
        onSelect={handlePlayerSelect}
        onAddToQueue={onAddToQueue}
        onToggleWatchlist={onToggleWatchlist}
      />
    </div>
  );
}
