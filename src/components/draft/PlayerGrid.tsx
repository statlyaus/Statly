'use client';
import dynamic from 'next/dynamic';

import type { FixedSizeList } from 'react-window';

const List = dynamic(
  () => import('react-window').then((m) => m.FixedSizeList),
  { ssr: false }
);

import React, { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import type { CSSProperties } from 'react';

import { motion } from 'framer-motion';

import type { DraftPlayer } from '@/types/draft';

interface PlayerGridProps {
  players: DraftPlayer[];
  onPlayerSelect: (player: DraftPlayer) => void;
  canMakePick: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  positionFilter: string;
  onPositionFilterChange: (position: string) => void;
  availablePositions: string[];
  sortBy: 'name' | 'position' | 'club' | 'adp';
  onSortChange: (sort: 'name' | 'position' | 'club' | 'adp') => void;
  isLoading: boolean;
}

const ROW_HEIGHT = 72; // Fixed row height for virtualization

export default function PlayerGrid({
  players,
  onPlayerSelect,
  canMakePick,
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
  const listRef = useRef<FixedSizeList | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Memoized filtered and sorted players
  const filteredPlayers = useMemo(() => {
    let filtered = players;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (player) =>
          player.name.toLowerCase().includes(query) ||
          player.club.toLowerCase().includes(query) ||
          player.position.toLowerCase().includes(query)
      );
    }

    // Apply position filter
    if (positionFilter !== 'ALL') {
      filtered = filtered.filter((player) => player.position === positionFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'position':
          return a.position.localeCompare(b.position);
        case 'club':
          return a.club.localeCompare(b.club);
        case 'adp':
          return (a.adp || 999) - (b.adp || 999);
        default:
          return 0;
      }
    });

    return filtered;
  }, [players, searchQuery, positionFilter, sortBy]);

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
          listRef.current?.scrollToItem(nextIndex, 'center');
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const prevIndex = Math.max(playerIndex - 1, 0);
          setFocusedRow(prevIndex);
          listRef.current?.scrollToItem(prevIndex, 'center');
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
          listRef.current?.scrollToItem(0, 'start');
          break;
        }
        case 'End': {
          event.preventDefault();
          const lastIndex = filteredPlayers.length - 1;
          setFocusedRow(lastIndex);
          listRef.current?.scrollToItem(lastIndex, 'end');
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
    if (focusedRow !== null && listRef.current) {
      listRef.current.scrollToItem(focusedRow, 'center');
    }
  }, [focusedRow]);

  // Auto-focus search input
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Row renderer for virtualization
  const Row = useCallback(
    ({ index, style }: { index: number; style: CSSProperties }) => {
      const player = filteredPlayers[index];
      const isFocused = focusedRow === index;
      const isSelected = selectedPlayerId === player.id;

      return (
        <motion.div
          style={style}
          className={`flex items-center p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
            isFocused ? 'ring-2 ring-blue-200 bg-blue-50' : ''
          } ${isSelected ? 'bg-green-50 border-green-200' : ''}`}
          role="row"
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onFocus={() => setFocusedRow(index)}
          onBlur={() => setFocusedRow(null)}
          onClick={() => handlePlayerSelect(player)}
          aria-selected={isSelected}
          aria-rowindex={index + 1}
        >
          {/* Player Avatar */}
          <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
            <span className="text-lg font-bold text-blue-600">
              {player.name.charAt(0).toUpperCase()}
            </span>
          </div>

          {/* Player Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 truncate">{player.name}</h3>
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                  <span className="px-2 py-1 bg-gray-100 rounded text-xs font-medium">
                    {player.position}
                  </span>
                  <span>•</span>
                  <span>{player.club}</span>
                  {player.adp && (
                    <>
                      <span>•</span>
                      <span>ADP: {player.adp}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="text-right">
                {player.avgPoints && (
                  <div className="text-sm font-medium text-gray-900">
                    {player.avgPoints.toFixed(1)} pts
                  </div>
                )}
                {player.fantasyPoints && (
                  <div className="text-xs text-gray-500">{player.fantasyPoints} total</div>
                )}
              </div>
            </div>

            {/* Injury Status */}
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

          {/* Action Button */}
          <div className="ml-4">
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
    },
    [
      filteredPlayers,
      focusedRow,
      selectedPlayerId,
      handlePlayerSelect,
      canMakePick,
      isLoading,
      handleKeyDown,
    ]
  );

  // Empty state
  if (filteredPlayers.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <div className="text-4xl mb-3">🔍</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No players found</h3>
        <p className="text-gray-600 text-sm max-w-md mx-auto">
          Try adjusting your search criteria or position filter to find more players.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Search and Filter Controls */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex flex-col sm:flex-row gap-4">
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
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Position Filter */}
          <div className="sm:w-48">
            <label htmlFor="position-filter" className="sr-only">
              Filter by position
            </label>
            <select
              id="position-filter"
              value={positionFilter}
              onChange={(e) => onPositionFilterChange(e.target.value)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md leading-5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              {availablePositions.map((position) => (
                <option key={position} value={position}>
                  {position === 'ALL' ? 'All Positions' : position}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Options */}
          <div className="sm:w-48">
            <label htmlFor="sort-by" className="sr-only">
              Sort by
            </label>
            <select
              id="sort-by"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as typeof sortBy)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md leading-5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="adp">Sort by ADP</option>
              <option value="name">Sort by Name</option>
              <option value="position">Sort by Position</option>
              <option value="club">Sort by Club</option>
            </select>
          </div>
        </div>

        {/* Results Count */}
        <div className="mt-3 text-sm text-gray-600">
          Showing {filteredPlayers.length} of {players.length} players
        </div>
      </div>

      {/* Virtualized Player List */}
      <div className="relative">
        {/* Column Headers */}
        <div className="sticky top-0 bg-gray-50 border-b border-gray-200 px-4 py-3 text-sm font-medium text-gray-700">
          <div className="flex items-center">
            <div className="w-16 mr-4">Player</div>
            <div className="flex-1">Info</div>
            <div className="w-24 text-right">Stats</div>
            <div className="w-24 text-center">Action</div>
          </div>
        </div>

        {/* Virtualized List */}
        <List
          ref={listRef}
          height={Math.min(filteredPlayers.length * ROW_HEIGHT, 600)}
          itemCount={filteredPlayers.length}
          itemSize={ROW_HEIGHT}
          width="100%"
          overscanCount={5}
          itemKey={(index: number) => filteredPlayers[index].id}
        >
          {Row}
        </List>

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-white/75 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2" aria-hidden="true"></div>
              <p className="text-sm text-gray-600">Processing...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
