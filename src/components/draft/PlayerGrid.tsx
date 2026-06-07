'use client';
import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';

import { motion } from 'framer-motion';

import { CompactStatsRow } from '@/components/PlayerStatsDisplay';
import {
  FANTASY_CATEGORIES,
  type FantasyCategoryKey,
  type PlayerStats,
} from '@/types/fantasyCategories';
import type { DraftPlayer } from '@/types/draft';

interface PlayerGridProps {
  players: DraftPlayer[];
  totalPlayers: number;
  onPlayerSelect: (player: DraftPlayer) => void;
  onAddToQueue: (player: DraftPlayer) => void;
  onToggleWatchlist: (player: DraftPlayer) => void;
  canMakePick: boolean;
  queuedPlayerIds: string[];
  watchedPlayerIds: string[];
  selectedCategories: FantasyCategoryKey[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  positionFilter: string;
  onPositionFilterChange: (position: string) => void;
  availablePositions: string[];
  sortBy: 'name' | 'position' | 'club' | 'adp';
  onSortChange: (sort: 'name' | 'position' | 'club' | 'adp') => void;
  isLoading: boolean;
  emptyStateMessage?: string;
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
  selectedCategories,
  searchQuery,
  onSearchChange,
  positionFilter,
  onPositionFilterChange,
  availablePositions,
  sortBy,
  onSortChange,
  isLoading,
  emptyStateMessage,
}: PlayerGridProps): React.JSX.Element {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queuedIds = useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const watchedIds = useMemo(() => new Set(watchedPlayerIds), [watchedPlayerIds]);
  const visibleCategories = selectedCategories;
  const filteredPlayers = players;

  const hasActiveFilters =
    searchQuery.trim().length > 0 || positionFilter !== 'ALL' || sortBy !== 'adp';

  // Handle player selection
  const handlePlayerSelect = useCallback(
    (player: DraftPlayer) => {
      if (!canMakePick) return;

      setSelectedPlayerId(player.id);
      onPlayerSelect(player);

      // Clear selection after a short delay
      setTimeout(() => setSelectedPlayerId(null), 1000);
    },
    [canMakePick, onPlayerSelect]
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
          handlePlayerSelect(filteredPlayers[playerIndex]);
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
      rowRefs.current[focusedRow]?.scrollIntoView({ block: 'center' });
    }
  }, [focusedRow]);

  // Empty state
  if (filteredPlayers.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-card-foreground">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl">
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
              onClick={() => {
                onSearchChange('');
                onPositionFilterChange('ALL');
                onSortChange('adp');
              }}
              className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Clear filters
            </button>
            <button
              type="button"
              onClick={() => rowRefs.current[0]?.scrollIntoView({ block: 'start' })}
              className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Scroll to top
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm">
      {/* Search and Filter Controls */}
      <div className="border-b border-border bg-muted/50 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row">
          {/* Search Input */}
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
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search players by name, position, or club..."
                className="block w-full rounded-md border border-input bg-background py-2.5 pl-10 pr-3 leading-5 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Position Filter */}
          <div className="xl:w-48">
            <label htmlFor="position-filter" className="sr-only">
              Filter by position
            </label>
            <select
              id="position-filter"
              value={positionFilter}
              onChange={(e) => onPositionFilterChange(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2.5 leading-5 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {availablePositions.map((position) => (
                <option key={position} value={position}>
                  {position === 'ALL' ? 'All Positions' : position}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Options */}
          <div className="xl:w-48">
            <label htmlFor="sort-by" className="sr-only">
              Sort by
            </label>
            <select
              id="sort-by"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as typeof sortBy)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2.5 leading-5 text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="adp">Sort by ADP</option>
              <option value="name">Sort by Name</option>
              <option value="position">Sort by Position</option>
              <option value="club">Sort by Club</option>
            </select>
          </div>
        </div>

        {/* Results Count */}
        <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground xl:flex-row xl:items-center xl:justify-between">
          <div>
            Showing {filteredPlayers.length} of {totalPlayers} players
            {hasActiveFilters && (
              <span className="ml-2">Filtered by your current search and sort.</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleCategories.map((category) => (
              <span
                key={category}
                className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-foreground ring-1 ring-border"
              >
                {FANTASY_CATEGORIES[category].shortLabel || FANTASY_CATEGORIES[category].label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Player List */}
      <div className="relative">
        <div className="max-h-[680px] overflow-auto">
          <table
            className="w-full min-w-[1120px] border-collapse text-left"
            aria-label="Available draft players"
          >
            <caption className="sr-only">
              Available draft players with profile, league stats, and draft actions.
            </caption>
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 text-sm font-medium text-muted-foreground backdrop-blur">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium sm:px-5">
                  Player
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Profile
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  League Stats
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium sm:px-5">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredPlayers.map((player, index) => {
                const isFocused = focusedRow === index;
                const isSelected = selectedPlayerId === player.id;
                const isQueued = queuedIds.has(player.id);
                const isWatched = watchedIds.has(player.id);

                return (
                  <motion.tr
                    key={player.id}
                    ref={(element) => {
                      rowRefs.current[index] = element;
                    }}
                    className={`cursor-pointer transition-colors [content-visibility:auto] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                      isFocused ? 'bg-accent/50 ring-2 ring-inset ring-ring' : ''
                    } ${isSelected ? 'bg-primary/10' : ''}`}
                    tabIndex={0}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    onFocus={() => setFocusedRow(index)}
                    onBlur={() => setFocusedRow(null)}
                    onClick={() => {
                      if (canMakePick) handlePlayerSelect(player);
                    }}
                    aria-label={`${player.name}, ${player.position}, ${player.club}. Press Enter to select.`}
                    data-selected={isSelected ? 'true' : undefined}
                  >
                    <th scope="row" className="px-4 py-4 font-normal sm:px-5">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <span className="text-lg font-bold">
                            {player.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground">
                            {player.name}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-foreground">
                              {player.position}
                            </span>
                            <span>{player.club}</span>
                            {player.adp && <span>ADP: {player.adp}</span>}
                            {isQueued && <span className="font-medium text-primary">Queued</span>}
                            {isWatched && (
                              <span className="font-medium text-foreground">Watchlist</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </th>

                    <td className="px-4 py-4 align-middle">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">
                          {typeof player.avgPoints === 'number'
                            ? `${player.avgPoints.toFixed(1)} avg`
                            : typeof player.averagePoints === 'number'
                              ? `${player.averagePoints.toFixed(1)} avg`
                              : 'No average yet'}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {player.gamesPlayed
                            ? `${player.gamesPlayed} games tracked`
                            : 'Season profile loading'}
                        </div>

                        {player.injuryStatus && player.injuryStatus !== 'healthy' && (
                          <div className="mt-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                player.injuryStatus === 'out'
                                  ? 'bg-destructive/10 text-destructive'
                                  : player.injuryStatus === 'injured'
                                    ? 'bg-muted text-foreground'
                                    : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {player.injuryStatus === 'out'
                                ? '🚫 Out'
                                : player.injuryStatus === 'injured'
                                  ? '🩹 Injured'
                                  : '❓ Questionable'}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4 align-middle">
                      <div className="min-w-0">
                        {visibleCategories.length > 0 ? (
                          <CompactStatsRow
                            stats={player.stats as PlayerStats | undefined}
                            selectedCategories={visibleCategories}
                            maxDisplay={visibleCategories.length}
                            className="flex-wrap gap-x-3 gap-y-2"
                          />
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            League categories not configured yet.
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-4 align-middle sm:px-5">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWatchlist(player);
                          }}
                          disabled={isLoading}
                          className={`rounded-md px-3 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            !isLoading && isWatched
                              ? 'border border-border bg-accent text-accent-foreground hover:bg-accent/80'
                              : !isLoading
                                ? 'border border-input bg-background text-foreground hover:bg-muted'
                                : 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
                          }`}
                          aria-label={`${isWatched ? 'Remove' : 'Add'} ${player.name} ${isWatched ? 'from' : 'to'} watchlist`}
                        >
                          {isWatched ? 'Watched' : 'Watch'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToQueue(player);
                          }}
                          disabled={isLoading || isQueued}
                          className={`rounded-md px-3 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            !isLoading && !isQueued
                              ? 'border border-input bg-background text-foreground hover:bg-muted'
                              : 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
                          }`}
                          aria-label={
                            isQueued
                              ? `${player.name} already in queue`
                              : `Add ${player.name} to queue`
                          }
                        >
                          {isQueued ? 'Queued' : 'Queue'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayerSelect(player);
                          }}
                          disabled={!canMakePick || isLoading}
                          className={`rounded-md px-4 py-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                            canMakePick && !isLoading
                              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                              : 'cursor-not-allowed bg-muted text-muted-foreground'
                          }`}
                          aria-label={`Select ${player.name}`}
                        >
                          {isLoading ? 'Selecting...' : 'Select'}
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/75">
            <div className="text-center">
              <div
                className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-primary"
                aria-hidden="true"
              ></div>
              <p className="text-sm text-muted-foreground">Processing...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
