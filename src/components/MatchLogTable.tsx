'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronUpIcon,
  ChevronDownIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  ChartBarIcon,
  TrophyIcon,
  FireIcon,
  EyeIcon,
  CalendarIcon,
  UserIcon,
  XMarkIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';

type MatchLog = {
  round: number;
  opponent: string;
  goals?: number;
  disposals?: number;
  marks?: number;
  tackles?: number;
  fantasyPoints?: number;
  matchDate?: string;
  venue?: string;
  result?: 'W' | 'L' | 'D';
  margin?: number;
  kickingAccuracy?: string;
  timeOnGround?: number;
  superCoachScore?: number;
  dreamTeamScore?: number;
};

type SortDirection = 'asc' | 'desc';
type SortField = keyof MatchLog;

interface MatchLogTableProps {
  matchLogs: MatchLog[];
  playerName?: string;
  isLoading?: boolean;
  onRefresh?: () => void;
  onMatchSelect?: (matchLog: MatchLog) => void;
  className?: string;
  showAdvancedStats?: boolean;
}

interface FilterState {
  searchTerm: string;
  minFantasyPoints: string;
  maxFantasyPoints: string;
  result: 'all' | 'W' | 'L' | 'D';
  minRound: string;
  maxRound: string;
}

const MatchLogTable = ({ 
  matchLogs, 
  playerName,
  isLoading = false,
  onRefresh,
  onMatchSelect,
  className = '',
  showAdvancedStats = false
}: MatchLogTableProps) => {
  const [sortField, setSortField] = useState<SortField>('round');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<MatchLog | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: '',
    minFantasyPoints: '',
    maxFantasyPoints: '',
    result: 'all',
    minRound: '',
    maxRound: ''
  });

  // Calculate statistics
  const stats = useMemo(() => {
    if (!matchLogs || matchLogs.length === 0) return null;

    const validLogs = matchLogs.filter(log => log.fantasyPoints != null);
    if (validLogs.length === 0) return null;

    const fantasyPoints = validLogs.map(log => log.fantasyPoints!);
    const goals = matchLogs.map(log => log.goals || 0);
    const disposals = matchLogs.map(log => log.disposals || 0);
    
    return {
      totalMatches: matchLogs.length,
      avgFantasyPoints: Math.round(fantasyPoints.reduce((a, b) => a + b, 0) / fantasyPoints.length),
      bestFantasyPoints: Math.max(...fantasyPoints),
      worstFantasyPoints: Math.min(...fantasyPoints),
      totalGoals: goals.reduce((a, b) => a + b, 0),
      avgGoals: (goals.reduce((a, b) => a + b, 0) / matchLogs.length).toFixed(1),
      avgDisposals: Math.round(disposals.reduce((a, b) => a + b, 0) / matchLogs.length),
      wins: matchLogs.filter(log => log.result === 'W').length,
      losses: matchLogs.filter(log => log.result === 'L').length,
      draws: matchLogs.filter(log => log.result === 'D').length
    };
  }, [matchLogs]);

  // Filter and sort data
  const filteredAndSortedLogs = useMemo(() => {
    let filtered = [...matchLogs];

    // Apply filters
    if (filters.searchTerm) {
      filtered = filtered.filter(log =>
        log.opponent.toLowerCase().includes(filters.searchTerm.toLowerCase()) ||
        log.venue?.toLowerCase().includes(filters.searchTerm.toLowerCase())
      );
    }

    if (filters.minFantasyPoints) {
      filtered = filtered.filter(log => 
        (log.fantasyPoints || 0) >= parseInt(filters.minFantasyPoints)
      );
    }

    if (filters.maxFantasyPoints) {
      filtered = filtered.filter(log => 
        (log.fantasyPoints || 0) <= parseInt(filters.maxFantasyPoints)
      );
    }

    if (filters.result !== 'all') {
      filtered = filtered.filter(log => log.result === filters.result);
    }

    if (filters.minRound) {
      filtered = filtered.filter(log => log.round >= parseInt(filters.minRound));
    }

    if (filters.maxRound) {
      filtered = filtered.filter(log => log.round <= parseInt(filters.maxRound));
    }

    // Sort data
    filtered.sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];

      // Handle null/undefined values
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return sortDirection === 'asc' ? -1 : 1;
      if (bValue == null) return sortDirection === 'asc' ? 1 : -1;

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [matchLogs, filters, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      searchTerm: '',
      minFantasyPoints: '',
      maxFantasyPoints: '',
      result: 'all',
      minRound: '',
      maxRound: ''
    });
  };

  const getPerformanceColor = (points: number | undefined, avgPoints: number) => {
    if (!points) return 'text-base-content/50';
    if (points >= avgPoints * 1.2) return 'text-success font-semibold';
    if (points >= avgPoints * 0.8) return 'text-base-content';
    return 'text-warning';
  };

  const getResultBadge = (result: string | undefined) => {
    switch (result) {
      case 'W': return <span className="badge badge-success badge-sm">W</span>;
      case 'L': return <span className="badge badge-error badge-sm">L</span>;
      case 'D': return <span className="badge badge-warning badge-sm">D</span>;
      default: return <span className="badge badge-ghost badge-sm">-</span>;
    }
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-primary transition-colors duration-200 font-medium"
      aria-label={`Sort by ${field}`}
    >
      {children}
      {sortField === field && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          {sortDirection === 'asc' ? (
            <ChevronUpIcon className="w-4 h-4" />
          ) : (
            <ChevronDownIcon className="w-4 h-4" />
          )}
        </motion.div>
      )}
    </button>
  );

  if (isLoading) {
    return (
      <div className={`card bg-base-100 shadow-xl ${className}`}>
        <div className="card-body">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <ArrowPathIcon className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
              <p className="text-base-content/70">Loading match logs...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!matchLogs || matchLogs.length === 0) {
    return (
      <div className={`card bg-base-100 shadow-xl ${className}`}>
        <div className="card-body">
          <div className="text-center py-12">
            <ChartBarIcon className="w-16 h-16 text-base-content/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-base-content mb-2">No Match Data Available</h3>
            <p className="text-base-content/70 mb-4">
              {playerName ? `No match logs found for ${playerName}` : 'No match logs available to display'}
            </p>
            {onRefresh && (
              <button onClick={onRefresh} className="btn btn-primary gap-2">
                <ArrowPathIcon className="w-4 h-4" />
                Refresh Data
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Statistics Overview */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4"
        >
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-figure text-primary">
              <TrophyIcon className="w-8 h-8" />
            </div>
            <div className="stat-title text-xs">Matches</div>
            <div className="stat-value text-2xl">{stats.totalMatches}</div>
          </div>
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-figure text-secondary">
              <ChartBarIcon className="w-8 h-8" />
            </div>
            <div className="stat-title text-xs">Avg Points</div>
            <div className="stat-value text-2xl">{stats.avgFantasyPoints}</div>
          </div>
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-figure text-success">
              <FireIcon className="w-8 h-8" />
            </div>
            <div className="stat-title text-xs">Best</div>
            <div className="stat-value text-2xl">{stats.bestFantasyPoints}</div>
          </div>
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-figure text-info">
              <UserIcon className="w-8 h-8" />
            </div>
            <div className="stat-title text-xs">Wins</div>
            <div className="stat-value text-2xl">{stats.wins}</div>
          </div>
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-title text-xs">Avg Goals</div>
            <div className="stat-value text-2xl">{stats.avgGoals}</div>
          </div>
          <div className="stat bg-base-200 rounded-lg p-4">
            <div className="stat-title text-xs">Avg Disposals</div>
            <div className="stat-value text-2xl">{stats.avgDisposals}</div>
          </div>
        </motion.div>
      )}

      {/* Controls */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-base-content">
                {playerName ? `${playerName}'s Match Logs` : 'Match Logs'}
              </h2>
              <div className="badge badge-primary">{filteredAndSortedLogs.length} matches</div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`btn btn-sm gap-2 ${showFilters ? 'btn-primary' : 'btn-outline'}`}
              >
                <FunnelIcon className="w-4 h-4" />
                Filters
              </button>
              {onRefresh && (
                <button onClick={onRefresh} className="btn btn-sm btn-outline gap-2">
                  <ArrowPathIcon className="w-4 h-4" />
                  Refresh
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-base-300 pt-4 mb-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="form-control">
                    <label htmlFor="search-input" className="label">
                      <span className="label-text">Search</span>
                    </label>
                    <div className="relative">
                      <input
                        id="search-input"
                        type="text"
                        placeholder="Search opponent or venue..."
                        className="input input-bordered w-full pl-10"
                        value={filters.searchTerm}
                        onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                      />
                      <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/40" />
                    </div>
                  </div>

                  <div className="form-control">
                    <label htmlFor="min-points-input" className="label">
                      <span className="label-text">Fantasy Points Range</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="min-points-input"
                        type="number"
                        placeholder="Min"
                        className="input input-bordered flex-1"
                        value={filters.minFantasyPoints}
                        onChange={(e) => handleFilterChange('minFantasyPoints', e.target.value)}
                      />
                      <input
                        id="max-points-input"
                        type="number"
                        placeholder="Max"
                        className="input input-bordered flex-1"
                        value={filters.maxFantasyPoints}
                        onChange={(e) => handleFilterChange('maxFantasyPoints', e.target.value)}
                        aria-label="Maximum fantasy points"
                      />
                    </div>
                  </div>

                  <div className="form-control">
                    <label htmlFor="result-select" className="label">
                      <span className="label-text">Result</span>
                    </label>
                    <select
                      id="result-select"
                      className="select select-bordered"
                      value={filters.result}
                      onChange={(e) => handleFilterChange('result', e.target.value)}
                    >
                      <option value="all">All Results</option>
                      <option value="W">Wins</option>
                      <option value="L">Losses</option>
                      <option value="D">Draws</option>
                    </select>
                  </div>

                  <div className="form-control">
                    <label htmlFor="min-round-input" className="label">
                      <span className="label-text">Round Range</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="min-round-input"
                        type="number"
                        placeholder="Min"
                        className="input input-bordered flex-1"
                        value={filters.minRound}
                        onChange={(e) => handleFilterChange('minRound', e.target.value)}
                      />
                      <input
                        id="max-round-input"
                        type="number"
                        placeholder="Max"
                        className="input input-bordered flex-1"
                        value={filters.maxRound}
                        onChange={(e) => handleFilterChange('maxRound', e.target.value)}
                        aria-label="Maximum round"
                      />
                    </div>
                  </div>

                  <div className="form-control">
                    <div className="label">
                      <span className="label-text">Actions</span>
                    </div>
                    <button onClick={clearFilters} className="btn btn-outline gap-2">
                      <XMarkIcon className="w-4 h-4" />
                      Clear Filters
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th className="text-left">
                    <SortButton field="round">Round</SortButton>
                  </th>
                  <th className="text-left">
                    <SortButton field="opponent">Opponent</SortButton>
                  </th>
                  <th className="text-center">Result</th>
                  <th className="text-right">
                    <SortButton field="goals">Goals</SortButton>
                  </th>
                  <th className="text-right">
                    <SortButton field="disposals">Disposals</SortButton>
                  </th>
                  <th className="text-right">
                    <SortButton field="marks">Marks</SortButton>
                  </th>
                  <th className="text-right">
                    <SortButton field="tackles">Tackles</SortButton>
                  </th>
                  <th className="text-right">
                    <SortButton field="fantasyPoints">Fantasy Points</SortButton>
                  </th>
                  {showAdvancedStats && (
                    <>
                      <th className="text-right">
                        <SortButton field="superCoachScore">SC Score</SortButton>
                      </th>
                      <th className="text-right">
                        <SortButton field="dreamTeamScore">DT Score</SortButton>
                      </th>
                      <th className="text-center">TOG%</th>
                    </>
                  )}
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filteredAndSortedLogs.map((log, index) => (
                    <motion.tr
                      key={`${log.round}-${log.opponent}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ delay: index * 0.05 }}
                      className="hover:bg-base-200/50 cursor-pointer transition-colors duration-200"
                      onClick={() => onMatchSelect?.(log)}
                    >
                      <td className="font-medium">{log.round}</td>
                      <td>
                        <div>
                          <div className="font-medium">{log.opponent}</div>
                          {log.venue && (
                            <div className="text-xs text-base-content/60">{log.venue}</div>
                          )}
                        </div>
                      </td>
                      <td className="text-center">{getResultBadge(log.result)}</td>
                      <td className="text-right font-mono">{log.goals ?? '-'}</td>
                      <td className="text-right font-mono">{log.disposals ?? '-'}</td>
                      <td className="text-right font-mono">{log.marks ?? '-'}</td>
                      <td className="text-right font-mono">{log.tackles ?? '-'}</td>
                      <td className={`text-right font-mono font-semibold ${
                        stats ? getPerformanceColor(log.fantasyPoints, stats.avgFantasyPoints) : ''
                      }`}>
                        {log.fantasyPoints ?? '-'}
                      </td>
                      {showAdvancedStats && (
                        <>
                          <td className="text-right font-mono">{log.superCoachScore ?? '-'}</td>
                          <td className="text-right font-mono">{log.dreamTeamScore ?? '-'}</td>
                          <td className="text-center font-mono">{log.timeOnGround ? `${log.timeOnGround}%` : '-'}</td>
                        </>
                      )}
                      <td className="text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMatch(log);
                          }}
                          className="btn btn-ghost btn-xs gap-1"
                          aria-label="View match details"
                        >
                          <EyeIcon className="w-3 h-3" />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {filteredAndSortedLogs.length === 0 && (
            <div className="text-center py-8">
              <InformationCircleIcon className="w-12 h-12 text-base-content/30 mx-auto mb-2" />
              <p className="text-base-content/70">No matches found with current filters</p>
              <button onClick={clearFilters} className="btn btn-sm btn-outline mt-2">
                Clear Filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Match Detail Modal */}
      {selectedMatch && (
        <div className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">
                Round {selectedMatch.round} vs {selectedMatch.opponent}
              </h3>
              <button
                onClick={() => setSelectedMatch(null)}
                className="btn btn-sm btn-circle btn-ghost"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title">Fantasy Points</div>
                <div className="stat-value text-primary">{selectedMatch.fantasyPoints ?? '-'}</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title">Goals</div>
                <div className="stat-value">{selectedMatch.goals ?? '-'}</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title">Disposals</div>
                <div className="stat-value">{selectedMatch.disposals ?? '-'}</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title">Marks</div>
                <div className="stat-value">{selectedMatch.marks ?? '-'}</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title">Tackles</div>
                <div className="stat-value">{selectedMatch.tackles ?? '-'}</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title">Result</div>
                <div className="stat-value">{getResultBadge(selectedMatch.result)}</div>
              </div>
            </div>

            {(selectedMatch.venue || selectedMatch.matchDate) && (
              <div className="bg-base-200 rounded-lg p-4 mb-4">
                <h4 className="font-semibold mb-2">Match Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  {selectedMatch.venue && (
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-base-content/60" />
                      <span>Venue: {selectedMatch.venue}</span>
                    </div>
                  )}
                  {selectedMatch.matchDate && (
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-base-content/60" />
                      <span>Date: {selectedMatch.matchDate}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="modal-action">
              <button onClick={() => setSelectedMatch(null)} className="btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchLogTable;
