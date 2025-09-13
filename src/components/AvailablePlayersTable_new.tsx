'use client';

import React, { useState, useMemo, useCallback } from 'react';

import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  StarIcon,
  TrophyIcon,
  BoltIcon,
  UserPlusIcon,
  EyeIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';

import { useRankings } from '@/hooks/useRankings';
import type { PlayerLite } from '@/types/players';

type Props = {
  players: PlayerLite[];
  onAddToWatchlist?: (player: PlayerLite) => void;
  onDraftPlayer?: (player: PlayerLite) => void;
  onViewDetails?: (player: PlayerLite) => void;
  watchlist?: string[];
  draftedPlayers?: string[];
  className?: string;
};

type SortField = 'name' | 'team' | 'position' | 'value' | 'rank';
type SortDirection = 'asc' | 'desc';

interface EnhancedPlayer extends PlayerLite {
  ranking?: {
    rank: number;
    valueOverReplacement: number;
  };
  isWatched: boolean;
  isDrafted: boolean;
}

const AvailablePlayersTable = React.memo<Props>(
  ({
    players,
    onAddToWatchlist,
    onDraftPlayer,
    onViewDetails,
    watchlist = [],
    draftedPlayers = [],
    className = '',
  }) => {
    const { rankings, loading, error } = useRankings();

    // State for sorting, filtering, and search
    const [searchTerm, setSearchTerm] = useState('');
    const [sortField, setSortField] = useState<SortField>('value');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [positionFilter, setPositionFilter] = useState<string>('ALL');
    const [teamFilter, setTeamFilter] = useState<string>('ALL');
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact');

    // Enhanced player data with rankings
    const enhancedPlayers = useMemo<EnhancedPlayer[]>(() => {
      return players.map((player) => {
        const rankingData = rankings.find((r) => r.id === String(player.id));
        return {
          ...player,
          ranking: rankingData
            ? {
                rank: rankingData.rank,
                valueOverReplacement: rankingData.valueOverReplacement,
              }
            : undefined,
          isWatched: watchlist.includes(String(player.id)),
          isDrafted: draftedPlayers.includes(String(player.id)),
        };
      });
    }, [players, rankings, watchlist, draftedPlayers]);

    // Get unique positions and teams for filters
    const { positions, teams } = useMemo(() => {
      const positionSet = new Set<string>();
      const teamSet = new Set<string>();

      enhancedPlayers.forEach((player) => {
        if (player.position) positionSet.add(player.position);
        if (player.team) teamSet.add(player.team);
      });

      return {
        positions: Array.from(positionSet).sort(),
        teams: Array.from(teamSet).sort(),
      };
    }, [enhancedPlayers]);

    // Filtered and sorted players
    const filteredPlayers = useMemo(() => {
      let filtered = enhancedPlayers;

      // Apply search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        filtered = filtered.filter(
          (player) =>
            player.name.toLowerCase().includes(search) ||
            player.team?.toLowerCase().includes(search) ||
            player.position?.toLowerCase().includes(search)
        );
      }

      // Apply position filter
      if (positionFilter !== 'ALL') {
        filtered = filtered.filter((player) => player.position === positionFilter);
      }

      // Apply team filter
      if (teamFilter !== 'ALL') {
        filtered = filtered.filter((player) => player.team === teamFilter);
      }

      // Sort players
      filtered.sort((a, b) => {
        let aValue: string | number, bValue: string | number;

        switch (sortField) {
          case 'name':
            aValue = a.name;
            bValue = b.name;
            break;
          case 'team':
            aValue = a.team || '';
            bValue = b.team || '';
            break;
          case 'position':
            aValue = a.position || '';
            bValue = b.position || '';
            break;
          case 'value':
            aValue = a.ranking?.valueOverReplacement || 0;
            bValue = b.ranking?.valueOverReplacement || 0;
            break;
          case 'rank':
            aValue = a.ranking?.rank || 999;
            bValue = b.ranking?.rank || 999;
            break;
          default:
            return 0;
        }

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          const comparison = aValue.localeCompare(bValue);
          return sortDirection === 'asc' ? comparison : -comparison;
        }

        const comparison = (aValue as number) - (bValue as number);
        return sortDirection === 'asc' ? comparison : -comparison;
      });

      return filtered;
    }, [enhancedPlayers, searchTerm, positionFilter, teamFilter, sortField, sortDirection]);

    // Handle sorting
    const handleSort = useCallback(
      (field: SortField) => {
        if (sortField === field) {
          setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
          setSortField(field);
          setSortDirection(field === 'value' || field === 'rank' ? 'desc' : 'asc');
        }
      },
      [sortField]
    );

    // Get value color based on ranking
    const getValueColor = useCallback((rank?: number) => {
      if (!rank) return 'text-gray-400';
      if (rank <= 10) return 'text-green-600 font-bold';
      if (rank <= 25) return 'text-blue-600 font-semibold';
      if (rank <= 50) return 'text-purple-600 font-medium';
      if (rank <= 100) return 'text-orange-600';
      return 'text-gray-600';
    }, []);

    // Get rank badge styling
    const getRankBadge = useCallback((rank?: number) => {
      if (!rank) return 'bg-gray-100 text-gray-500';
      if (rank === 1) return 'bg-gradient-to-r from-amber-400 to-yellow-500 text-white';
      if (rank <= 3) return 'bg-gradient-to-r from-emerald-400 to-green-500 text-white';
      if (rank <= 10) return 'bg-gradient-to-r from-blue-400 to-indigo-500 text-white';
      if (rank <= 25) return 'bg-gradient-to-r from-purple-400 to-violet-500 text-white';
      if (rank <= 50) return 'bg-gray-600 text-white';
      return 'bg-gray-200 text-gray-700';
    }, []);

    // Render sort icon
    const renderSortIcon = (field: SortField) => {
      if (sortField !== field) {
        return <ChevronUpDownIcon className="w-4 h-4 text-gray-400" />;
      }
      return sortDirection === 'asc' ? (
        <ChevronUpIcon className="w-4 h-4 text-blue-600" />
      ) : (
        <ChevronDownIcon className="w-4 h-4 text-blue-600" />
      );
    };

    // Error state
    if (error) {
      return (
        <div className={`bg-red-50 border border-red-200 rounded-lg p-6 ${className}`}>
          <div className="flex items-center gap-3">
            <InformationCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-red-800">Error Loading Rankings</h3>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden ${className}`}
      >
        {/* Header with search and filters */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Available Players</h2>
              <p className="text-sm text-gray-600 mt-1">
                {filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''} available
                {searchTerm && ` (filtered from ${enhancedPlayers.length})`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div className="bg-white rounded-lg border border-gray-200 p-1 flex">
                <button
                  onClick={() => setViewMode('compact')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    viewMode === 'compact'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Compact
                </button>
                <button
                  onClick={() => setViewMode('detailed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    viewMode === 'detailed'
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Detailed
                </button>
              </div>

              {/* Filters toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  showFilters
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <FunnelIcon className="w-4 h-4" />
                Filters
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="mt-4 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search players, teams, or positions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Filters panel */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                <div>
                  <label
                    htmlFor="position-filter"
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    Position
                  </label>
                  <select
                    id="position-filter"
                    value={positionFilter}
                    onChange={(e) => setPositionFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="ALL">All Positions</option>
                    {positions.map((position) => (
                      <option key={position} value={position}>
                        {position}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="team-filter"
                    className="block text-xs font-medium text-gray-700 mb-1"
                  >
                    Team
                  </label>
                  <select
                    id="team-filter"
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="ALL">All Teams</option>
                    {teams.map((team) => (
                      <option key={team} value={team}>
                        {team}
                      </option>
                    ))}
                  </select>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="p-8 text-center">
            <div className="inline-flex items-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
              Loading player rankings...
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredPlayers.length === 0 && (
          <div className="p-8 text-center">
            <UserPlusIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-gray-900 mb-1">No players found</h3>
            <p className="text-sm text-gray-500">
              {searchTerm || positionFilter !== 'ALL' || teamFilter !== 'ALL'
                ? 'Try adjusting your search or filter criteria.'
                : 'No players are currently available for drafting.'}
            </p>
          </div>
        )}

        {/* Table */}
        {!loading && filteredPlayers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  {viewMode === 'detailed' && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rank
                    </th>
                  )}

                  <th
                    role="columnheader"
                    aria-sort={
                      sortField === 'name'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSort('name');
                    }}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors group"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      Player
                      {renderSortIcon('name')}
                    </div>
                  </th>

                  <th
                    role="columnheader"
                    aria-sort={
                      sortField === 'team'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSort('team');
                    }}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors group"
                    onClick={() => handleSort('team')}
                  >
                    <div className="flex items-center gap-1">
                      Team
                      {renderSortIcon('team')}
                    </div>
                  </th>

                  <th
                    role="columnheader"
                    aria-sort={
                      sortField === 'position'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSort('position');
                    }}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors group"
                    onClick={() => handleSort('position')}
                  >
                    <div className="flex items-center gap-1">
                      Position
                      {renderSortIcon('position')}
                    </div>
                  </th>

                  <th
                    role="columnheader"
                    aria-sort={
                      sortField === 'value'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleSort('value');
                    }}
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors group"
                    onClick={() => handleSort('value')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Fantasy Value
                      {renderSortIcon('value')}
                    </div>
                  </th>

                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                <AnimatePresence>
                  {filteredPlayers.map((player, index) => (
                    <motion.tr
                      key={player.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ delay: index * 0.02, duration: 0.2 }}
                      className={`hover:bg-gray-50 transition-all duration-150 ${
                        player.isDrafted ? 'opacity-50' : ''
                      } ${player.isWatched ? 'bg-blue-50' : ''}`}
                    >
                      {/* Rank column (detailed view only) */}
                      {viewMode === 'detailed' && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {player.ranking?.rank ? (
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${getRankBadge(player.ranking.rank)}`}
                              >
                                {player.ranking.rank}
                              </span>
                              {player.ranking.rank === 1 && (
                                <TrophyIcon className="w-4 h-4 text-amber-500" />
                              )}
                              {player.ranking.rank <= 10 && player.ranking.rank > 1 && (
                                <BoltIcon className="w-4 h-4 text-blue-500" />
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">Unranked</span>
                          )}
                        </td>
                      )}

                      {/* Player name */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-900">
                                {player.name}
                              </span>
                              {player.isWatched && (
                                <StarIconSolid className="w-4 h-4 text-yellow-500" />
                              )}
                              {player.isDrafted && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                  Drafted
                                </span>
                              )}
                            </div>
                            {viewMode === 'compact' && player.ranking?.rank && (
                              <div className="text-xs text-gray-500 mt-0.5">
                                Rank #{player.ranking.rank}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Team */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          {player.team || '—'}
                        </span>
                      </td>

                      {/* Position */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-900">
                          {player.position || '—'}
                        </span>
                      </td>

                      {/* Fantasy value */}
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {player.ranking?.valueOverReplacement ? (
                          <div className="text-right">
                            <div
                              className={`text-sm font-mono ${getValueColor(player.ranking.rank)}`}
                            >
                              {player.ranking.valueOverReplacement.toFixed(2)}
                            </div>
                            {viewMode === 'detailed' && (
                              <div className="text-xs text-gray-500 mt-0.5">
                                pts above replacement
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* View details */}
                          {onViewDetails && (
                            <button
                              onClick={() => onViewDetails(player)}
                              className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                              title="View player details"
                            >
                              <EyeIcon className="w-4 h-4" />
                            </button>
                          )}

                          {/* Add to watchlist */}
                          {onAddToWatchlist && !player.isDrafted && (
                            <button
                              onClick={() => onAddToWatchlist(player)}
                              className={`p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${
                                player.isWatched
                                  ? 'text-yellow-500 hover:text-yellow-600'
                                  : 'text-gray-400 hover:text-yellow-500'
                              }`}
                              title={
                                player.isWatched ? 'Remove from watchlist' : 'Add to watchlist'
                              }
                            >
                              {player.isWatched ? (
                                <StarIconSolid className="w-4 h-4" />
                              ) : (
                                <StarIcon className="w-4 h-4" />
                              )}
                            </button>
                          )}

                          {/* Draft player */}
                          {onDraftPlayer && !player.isDrafted && (
                            <button
                              onClick={() => onDraftPlayer(player)}
                              className="p-1.5 text-blue-500 hover:text-blue-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                              title="Draft this player"
                            >
                              <UserPlusIcon className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}

        {/* Footer with summary stats */}
        {!loading && filteredPlayers.length > 0 && (
          <div className="bg-gray-50 px-4 py-3 border-t border-gray-200">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 text-xs text-gray-500">
              <div>
                Showing {filteredPlayers.length} of {enhancedPlayers.length} available players
              </div>
              <div className="flex items-center gap-4">
                <span>Ranked: {filteredPlayers.filter((p) => p.ranking?.rank).length}</span>
                <span>Watchlisted: {filteredPlayers.filter((p) => p.isWatched).length}</span>
                <span>Drafted: {enhancedPlayers.filter((p) => p.isDrafted).length}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

AvailablePlayersTable.displayName = 'AvailablePlayersTable';

export default AvailablePlayersTable;
