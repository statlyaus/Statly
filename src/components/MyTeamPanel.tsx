'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Player, Team } from '../types/players';
import { useRankings } from '@/app/tradecentre/RankingsContext';
import { ValueChip } from './ValueChip';
import {
  UserIcon,
  TrophyIcon,
  StarIcon,
  ChartBarIcon,
  EyeIcon,
  ArrowsUpDownIcon,
  MagnifyingGlassIcon,
  FireIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon
} from '@heroicons/react/24/outline';
import {
  StarIcon as StarIconSolid
} from '@heroicons/react/24/solid';

type MyTeamPanelProps = {
  team: Team | undefined;
  players: Player[];
  /** Optional: sort drafted players by highest totalValue */
  sortByValue?: boolean;
  /** Optional: callback when player is selected */
  onPlayerSelect?: (player: Player) => void;
  /** Optional: callback when team action is triggered */
  onTeamAction?: (action: string, player?: Player) => void;
  /** Optional: show advanced stats and actions */
  showAdvancedFeatures?: boolean;
  /** Optional: compact mode for smaller displays */
  compact?: boolean;
  /** Optional: maximum height for scrollable area */
  maxHeight?: string;
  /** Optional: refresh callback */
  onRefresh?: () => void;
  /** Optional: loading state */
  isLoading?: boolean;
  className?: string;
};

type SortField = 'name' | 'position' | 'team' | 'totalValue' | 'recent';
type FilterType = 'all' | 'starters' | 'bench' | 'captain' | 'injury';

interface TeamStats {
  totalPlayers: number;
  totalValue: number;
  avgValue: number;
  positionBreakdown: Record<string, number>;
  captainSet: boolean;
  viceCaptainSet: boolean;
  rosterComplete: boolean;
}

// Extend Player type for captain functionality
interface ExtendedPlayer extends Player {
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  recentForm?: number;
}

function capWords(str = '') {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function capFirst(str = '') {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
}

const MyTeamPanel = ({ 
  team, 
  players, 
  sortByValue = true,
  onPlayerSelect,
  onTeamAction,
  showAdvancedFeatures = false,
  compact = false,
  maxHeight = '600px',
  onRefresh,
  isLoading = false,
  className = ''
}: MyTeamPanelProps) => {
  const rankings = useRankings();
  const [sortField, setSortField] = useState<SortField>(sortByValue ? 'totalValue' : 'name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const draftedPlayers = useMemo(() => {
    if (!team) return [];
    return players.filter((p) =>
      (team.players ?? []).map(String).includes(String(p.id))
    );
  }, [team, players]);

  // Calculate team statistics
  const teamStats = useMemo<TeamStats>(() => {
    const positionBreakdown: Record<string, number> = {};
    let totalValue = 0;
    let captainSet = false;
    let viceCaptainSet = false;

    draftedPlayers.forEach(player => {
      const extPlayer = player as ExtendedPlayer;
      const position = player.position || 'UNK';
      positionBreakdown[position] = (positionBreakdown[position] || 0) + 1;
      
      const playerValue = rankings.get(String(player.id))?.totalValue || 0;
      totalValue += playerValue;
      
      if (extPlayer.isCaptain) captainSet = true;
      if (extPlayer.isViceCaptain) viceCaptainSet = true;
    });

    return {
      totalPlayers: draftedPlayers.length,
      totalValue,
      avgValue: draftedPlayers.length > 0 ? totalValue / draftedPlayers.length : 0,
      positionBreakdown,
      captainSet,
      viceCaptainSet,
      rosterComplete: draftedPlayers.length >= 22 // Standard AFL Fantasy roster
    };
  }, [draftedPlayers, rankings]);

  // Filter and sort players
  const filteredAndSortedPlayers = useMemo(() => {
    let filtered = [...draftedPlayers];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(player =>
        player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (player.team && player.team.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (player.position && player.position.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Apply type filter
    switch (filterType) {
      case 'starters':
        // Assuming first 18 are starters (you'd implement proper logic)
        filtered = filtered.slice(0, 18);
        break;
      case 'bench':
        filtered = filtered.slice(18);
        break;
      case 'captain':
        filtered = filtered.filter(p => {
          const extP = p as ExtendedPlayer;
          return extP.isCaptain || extP.isViceCaptain;
        });
        break;
      case 'injury':
        filtered = filtered.filter(p => p.injury);
        break;
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal: string | number, bVal: string | number;

      switch (sortField) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'position':
          aVal = a.position || 'ZZZ';
          bVal = b.position || 'ZZZ';
          break;
        case 'team':
          aVal = a.team || 'ZZZ';
          bVal = b.team || 'ZZZ';
          break;
        case 'totalValue':
          aVal = rankings.get(String(a.id))?.totalValue ?? -Infinity;
          bVal = rankings.get(String(b.id))?.totalValue ?? -Infinity;
          break;
        case 'recent':
          // Sort by recent performance (you'd implement based on your data)
          aVal = (a as ExtendedPlayer).recentForm || 0;
          bVal = (b as ExtendedPlayer).recentForm || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [draftedPlayers, searchTerm, filterType, sortField, sortDirection, rankings]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  }, [sortField, sortDirection]);

  const handlePlayerClick = useCallback((player: Player) => {
    setSelectedPlayer(player);
    onPlayerSelect?.(player);
  }, [onPlayerSelect]);

  const getPositionColor = (position: string) => {
    const colors = {
      'DEF': 'text-blue-600 bg-blue-50',
      'MID': 'text-green-600 bg-green-50',
      'FWD': 'text-red-600 bg-red-50',
      'RUC': 'text-purple-600 bg-purple-50',
    };
    return colors[position as keyof typeof colors] || 'text-gray-600 bg-gray-50';
  };

  const getPerformanceIcon = (player: Player) => {
    const value = rankings.get(String(player.id))?.totalValue || 0;
    const avgValue = teamStats.avgValue;
    
    if (value > avgValue * 1.2) {
      return <StarIconSolid className="w-4 h-4 text-yellow-500" />;
    } else if (value < avgValue * 0.8) {
      return <InformationCircleIcon className="w-4 h-4 text-orange-500" />;
    }
    return null;
  };

  if (!team) {
    return (
      <section aria-labelledby="team-heading" className={className}>
        <div className="bg-base-100 rounded-xl shadow-sm border border-base-300 p-6 text-center">
          <UserIcon className="w-12 h-12 text-base-content/30 mx-auto mb-3" />
          <h2 id="team-heading" className="text-lg font-semibold mb-2">
            No Team Selected
          </h2>
          <p className="text-base-content/70 mb-4">
            Join a league or create a team to get started
          </p>
          <button 
            onClick={() => onTeamAction?.('create')}
            className="btn btn-primary btn-sm gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            Create Team
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="team-heading" className={className}>
      <div className="bg-base-100 rounded-xl shadow-sm border border-base-300 h-full flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-base-300">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrophyIcon className="w-5 h-5 text-primary" />
              <h2 id="team-heading" className={`font-bold ${compact ? 'text-sm' : 'text-lg'}`}>
                {team.name || 'My Team'}
              </h2>
              {isLoading && (
                <div className="loading loading-spinner loading-xs"></div>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="btn btn-ghost btn-xs"
                  aria-label="Refresh team data"
                >
                  <ArrowPathIcon className="w-4 h-4" />
                </button>
              )}
              
              {showAdvancedFeatures && (
                <button
                  onClick={() => setShowStats(!showStats)}
                  className="btn btn-ghost btn-xs"
                  aria-label="Toggle team statistics"
                >
                  <ChartBarIcon className="w-4 h-4" />
                  {showStats ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>

          {/* Team Stats Summary */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="text-center">
              <div className="font-semibold text-primary">{teamStats.totalPlayers}</div>
              <div className="text-base-content/70">Players</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-secondary">${(teamStats.totalValue / 1000000).toFixed(1)}M</div>
              <div className="text-base-content/70">Value</div>
            </div>
            <div className="text-center">
              <div className={`font-semibold ${teamStats.rosterComplete ? 'text-success' : 'text-warning'}`}>
                {teamStats.rosterComplete ? 'Complete' : 'Incomplete'}
              </div>
              <div className="text-base-content/70">Status</div>
            </div>
          </div>

          {/* Expanded Stats */}
          <AnimatePresence>
            {showStats && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 pt-3 border-t border-base-300"
              >
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <h4 className="font-medium mb-1">Position Breakdown</h4>
                    {Object.entries(teamStats.positionBreakdown).map(([pos, count]) => (
                      <div key={pos} className="flex justify-between">
                        <span className={`badge badge-xs ${getPositionColor(pos)}`}>{pos}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="font-medium mb-1">Team Status</h4>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {teamStats.captainSet ? (
                          <StarIconSolid className="w-3 h-3 text-yellow-500" />
                        ) : (
                          <StarIcon className="w-3 h-3 text-base-content/30" />
                        )}
                        <span className={teamStats.captainSet ? 'text-success' : 'text-base-content/70'}>
                          Captain
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {teamStats.viceCaptainSet ? (
                          <ShieldCheckIcon className="w-3 h-3 text-primary" />
                        ) : (
                          <ShieldCheckIcon className="w-3 h-3 text-base-content/30" />
                        )}
                        <span className={teamStats.viceCaptainSet ? 'text-success' : 'text-base-content/70'}>
                          Vice Captain
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Filters and Search */}
          {showAdvancedFeatures && draftedPlayers.length > 0 && (
            <div className="mt-3 space-y-2">
              {/* Search */}
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/50" />
                <input
                  type="text"
                  placeholder="Search players..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input input-xs input-bordered w-full pl-9"
                />
              </div>

              {/* Filters */}
              <div className="flex gap-1 flex-wrap">
                {(['all', 'starters', 'bench', 'captain', 'injury'] as FilterType[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setFilterType(filter)}
                    className={`btn btn-xs ${filterType === filter ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {capFirst(filter)}
                  </button>
                ))}
              </div>

              {/* Sort Options */}
              <div className="flex gap-1 text-xs">
                <span className="text-base-content/70 py-1">Sort by:</span>
                {(['name', 'position', 'totalValue', 'recent'] as SortField[]).map((field) => (
                  <button
                    key={field}
                    onClick={() => handleSort(field)}
                    className={`btn btn-xs ${sortField === field ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {capFirst(field)}
                    {sortField === field && (
                      <ArrowsUpDownIcon className="w-3 h-3 ml-1" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Players List */}
        <div className="flex-1 overflow-hidden">
          {filteredAndSortedPlayers.length === 0 ? (
            <div className="p-6 text-center">
              {draftedPlayers.length === 0 ? (
                <>
                  <UserPlusIcon className="w-12 h-12 text-base-content/30 mx-auto mb-3" />
                  <p className="text-base-content/70 mb-4">No players drafted yet.</p>
                  <button 
                    onClick={() => onTeamAction?.('draft')}
                    className="btn btn-primary btn-sm"
                  >
                    Start Drafting
                  </button>
                </>
              ) : (
                <>
                  <InformationCircleIcon className="w-8 h-8 text-base-content/30 mx-auto mb-2" />
                  <p className="text-base-content/70">No players match your filters</p>
                  <button 
                    onClick={() => {
                      setSearchTerm('');
                      setFilterType('all');
                    }}
                    className="btn btn-sm btn-outline mt-2"
                  >
                    Clear Filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-y-auto" style={{ maxHeight }}>
              <ul className={`space-y-1 p-2 ${compact ? 'text-xs' : 'text-sm'}`}>
                <AnimatePresence>
                  {filteredAndSortedPlayers.map((player, index) => (
                    <motion.li
                      key={player.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: index * 0.05 }}
                      className={`border-b border-base-200 py-2 px-2 rounded-lg hover:bg-base-200/50 transition-colors cursor-pointer ${
                        selectedPlayer?.id === player.id ? 'bg-primary/10 border-primary/20' : ''
                      }`}
                      onClick={() => handlePlayerClick(player)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {/* Player Name and Performance Icon */}
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <span className="font-medium truncate">{capWords(player.name)}</span>
                            {getPerformanceIcon(player)}
                            {player.injury && (
                              <div className="tooltip tooltip-error" data-tip={player.injury}>
                                <InformationCircleIcon className="w-4 h-4 text-error" />
                              </div>
                            )}
                          </div>
                          
                          {/* Value Chip */}
                          <ValueChip playerId={String(player.id)} compact={compact} />
                        </div>

                        {/* Player Info */}
                        <div className="flex items-center gap-2 text-base-content/70">
                          {player.team && (
                            <span className="hidden sm:inline">{capFirst(player.team)}</span>
                          )}
                          {player.position && (
                            <span className={`badge badge-xs ${getPositionColor(player.position)}`}>
                              {capFirst(player.position)}
                            </span>
                          )}
                          
                          {showAdvancedFeatures && (
                            <div className="dropdown dropdown-end">
                              <button 
                                tabIndex={0} 
                                className="btn btn-ghost btn-xs"
                                aria-label="Player actions"
                              >
                                <EyeIcon className="w-3 h-3" />
                              </button>
                              <ul className="dropdown-content menu bg-base-100 rounded-box z-[1] w-32 p-1 shadow">
                                <li>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onTeamAction?.('view', player);
                                    }}
                                    className="text-left w-full"
                                  >
                                    View Details
                                  </button>
                                </li>
                                <li>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onTeamAction?.('captain', player);
                                    }}
                                    className="text-left w-full"
                                  >
                                    Set Captain
                                  </button>
                                </li>
                                <li>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onTeamAction?.('bench', player);
                                    }}
                                    className="text-left w-full"
                                  >
                                    Move to Bench
                                  </button>
                                </li>
                                <li>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onTeamAction?.('trade', player);
                                    }}
                                    className="text-left w-full"
                                  >
                                    Trade
                                  </button>
                                </li>
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {showAdvancedFeatures && draftedPlayers.length > 0 && (
          <div className="p-3 border-t border-base-300 bg-base-50">
            <div className="flex gap-2 justify-center">
              <button 
                onClick={() => onTeamAction?.('optimize')}
                className="btn btn-sm btn-primary gap-1"
              >
                <FireIcon className="w-4 h-4" />
                Optimize
              </button>
              <button 
                onClick={() => onTeamAction?.('trade')}
                className="btn btn-sm btn-secondary gap-1"
              >
                <ArrowsUpDownIcon className="w-4 h-4" />
                Trade
              </button>
              <button 
                onClick={() => onTeamAction?.('analyze')}
                className="btn btn-sm btn-accent gap-1"
              >
                <ChartBarIcon className="w-4 h-4" />
                Analyze
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default MyTeamPanel;
