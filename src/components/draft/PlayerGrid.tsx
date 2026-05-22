'use client';
import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';

import { motion } from 'framer-motion';

import { CompactStatsRow } from '@/components/PlayerStatsDisplay';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';
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
}: PlayerGridProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queuedIds = useMemo(() => new Set(queuedPlayerIds), [queuedPlayerIds]);
  const watchedIds = useMemo(() => new Set(watchedPlayerIds), [watchedPlayerIds]);
  const visibleCategories = useMemo(() => selectedCategories.slice(0, 4), [selectedCategories]);
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
      <div className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">
          🔍
        </div>
        <h3 className="text-lg font-semibold text-gray-900">
          {hasActiveFilters ? 'No players match your filters' : 'No players found'}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-600">
          {hasActiveFilters
            ? 'Clear your search or filters to bring the full board back into view.'
            : 'The player pool is empty right now. Refresh the draft room or try again once players are loaded.'}
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
              className="inline-flex items-center rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              Clear filters
            </button>
            <button
              type="button"
              onClick={() => rowRefs.current[0]?.scrollIntoView({ block: 'start' })}
              className="inline-flex items-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
            >
              Scroll to top
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      {/* Search and Filter Controls */}
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row">
          {/* Search Input */}
          <div className="flex-1">
            <label htmlFor="player-search" className="sr-only">
              Search players
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg
                  className="h-5 w-5 text-gray-400"
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
                className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 leading-5 text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 leading-5 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 leading-5 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="adp">Sort by ADP</option>
              <option value="name">Sort by Name</option>
              <option value="position">Sort by Position</option>
              <option value="club">Sort by Club</option>
            </select>
          </div>
        </div>

        {/* Results Count */}
        <div className="mt-3 flex flex-col gap-2 text-sm text-slate-600 xl:flex-row xl:items-center xl:justify-between">
          <div>
            Showing {filteredPlayers.length} of {totalPlayers} players
            {hasActiveFilters && (
              <span className="ml-2 text-slate-500">Filtered by your current search and sort.</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleCategories.map((category) => (
              <span
                key={category}
                className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
              >
                {FANTASY_CATEGORIES[category].shortLabel || FANTASY_CATEGORIES[category].label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Virtualized Player List */}
      <div className="relative">
        {/* Column Headers */}
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 py-3 text-sm font-medium text-slate-700 backdrop-blur sm:px-5">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(220px,1.4fr)_auto] items-center gap-4">
            <div>Player</div>
            <div>Profile</div>
            <div>League Stats</div>
            <div className="text-right">Actions</div>
          </div>
        </div>

        <div className="max-h-[680px] overflow-y-auto" role="rowgroup">
          {filteredPlayers.map((player, index) => {
            const isFocused = focusedRow === index;
            const isSelected = selectedPlayerId === player.id;
            const isQueued = queuedIds.has(player.id);
            const isWatched = watchedIds.has(player.id);

            return (
              <motion.div
                key={player.id}
                ref={(element) => {
                  rowRefs.current[index] = element;
                }}
                className={`grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(220px,1.4fr)_auto] items-center gap-4 border-b border-slate-100 px-4 py-4 transition-colors [content-visibility:auto] ${
                  isFocused ? 'ring-2 ring-blue-200 bg-blue-50' : ''
                } ${isSelected ? 'bg-green-50 border-green-200' : ''}`}
                role="row"
                tabIndex={0}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onFocus={() => setFocusedRow(index)}
                onBlur={() => setFocusedRow(null)}
                onClick={() => {
                  if (canMakePick) handlePlayerSelect(player);
                }}
                aria-selected={isSelected}
                aria-rowindex={index + 1}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-blue-200">
                    <span className="text-lg font-bold text-blue-600">
                      {player.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900">{player.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                      <span className="px-2 py-1 bg-gray-100 rounded text-xs font-medium">
                        {player.position}
                      </span>
                      <span>{player.club}</span>
                      {player.adp && <span>ADP: {player.adp}</span>}
                      {isQueued && <span className="font-medium text-blue-600">Queued</span>}
                      {isWatched && <span className="font-medium text-amber-600">Watchlist</span>}
                    </div>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    {typeof player.avgPoints === 'number'
                      ? `${player.avgPoints.toFixed(1)} avg`
                      : typeof player.averagePoints === 'number'
                        ? `${player.averagePoints.toFixed(1)} avg`
                        : 'No average yet'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {player.gamesPlayed
                      ? `${player.gamesPlayed} games tracked`
                      : 'Season profile loading'}
                  </div>

                  {player.injuryStatus && player.injuryStatus !== 'healthy' && (
                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          player.injuryStatus === 'out'
                            ? 'bg-red-100 text-red-800'
                            : player.injuryStatus === 'injured'
                              ? 'bg-orange-100 text-orange-800'
                              : 'bg-yellow-100 text-yellow-800'
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

                <div className="min-w-0">
                  {visibleCategories.length > 0 ? (
                    <CompactStatsRow
                      stats={player.stats as any}
                      selectedCategories={visibleCategories}
                      maxDisplay={visibleCategories.length}
                      className="flex-wrap gap-x-3 gap-y-2"
                    />
                  ) : (
                    <div className="text-sm text-slate-500">
                      League categories not configured yet.
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleWatchlist(player);
                    }}
                    disabled={isLoading}
                    className={`px-3 py-2 rounded-md font-medium transition-colors ${
                      !isLoading && isWatched
                        ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 focus:ring-2 focus:ring-amber-400 focus:ring-offset-2'
                        : !isLoading
                          ? 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2'
                          : 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
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
                    className={`px-3 py-2 rounded-md font-medium transition-colors ${
                      !isLoading && !isQueued
                        ? 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2'
                        : 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                    aria-label={
                      isQueued ? `${player.name} already in queue` : `Add ${player.name} to queue`
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
                    className={`px-4 py-2 rounded-md font-medium transition-colors ${
                      canMakePick && !isLoading
                        ? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                    aria-label={`Select ${player.name}`}
                  >
                    {isLoading ? 'Selecting...' : 'Select'}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-white/75 flex items-center justify-center">
            <div className="text-center">
              <div
                className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"
                aria-hidden="true"
              ></div>
              <p className="text-sm text-gray-600">Processing...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
