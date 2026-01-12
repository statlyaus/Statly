'use client';

import { useState, useMemo } from 'react';

import { motion } from 'framer-motion';
import { Search, Filter, ChevronUp, ChevronDown, BarChart3 } from 'lucide-react';

import { getStatColor } from '@/hooks/usePlayerStats';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import type { Player } from '@/types/players';

import PlayerComparison from './PlayerComparison';

interface PlayerStatsTableProps {
  players: Player[];
}

type SortDirection = 'asc' | 'desc';
type FilterType = 'all' | 'DEF' | 'MID' | 'FWD' | 'RUC';

interface StatColumn {
  key: string;
  label: string;
  accessor: (player: Player) => number | undefined;
  format?: (value: number) => string;
}

const STAT_COLUMNS: StatColumn[] = [
  { key: 'avg', label: 'Average', accessor: (p) => p.avg, format: (v) => v.toFixed(1) },
  { key: 'kicks', label: 'Kicks', accessor: (p) => p.kicks },
  { key: 'handballs', label: 'Handballs', accessor: (p) => p.handballs },
  { key: 'marks', label: 'Marks', accessor: (p) => p.marks },
  { key: 'tackles', label: 'Tackles', accessor: (p) => p.tackles },
  { key: 'goals', label: 'Goals', accessor: (p) => p.goals },
  { key: 'hitouts', label: 'Hitouts', accessor: (p) => p.hitouts },
  { key: 'clearances', label: 'Clearances', accessor: (p) => p.clearances },
  { key: 'inside50s', label: 'Inside 50s', accessor: (p) => p.inside50s },
  { key: 'rebound50s', label: 'Rebound 50s', accessor: (p) => p.rebound50s },
  {
    key: 'contestedPossessions',
    label: 'Contested Poss.',
    accessor: (p) => p.contestedPossessions,
  },
];

const TEAMS = [
  'Adelaide',
  'Brisbane',
  'Carlton',
  'Collingwood',
  'Essendon',
  'Fremantle',
  'Geelong',
  'Gold Coast',
  'GWS',
  'Hawthorn',
  'Melbourne',
  'North Melbourne',
  'Port Adelaide',
  'Richmond',
  'St Kilda',
  'Sydney',
  'West Coast',
  'Western Bulldogs',
];

export default function PlayerStatsTable({ players }: PlayerStatsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [positionFilter, setPositionFilter] = useState<FilterType>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('avg');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedStats, setSelectedStats] = useState<string[]>([
    'avg',
    'kicks',
    'handballs',
    'marks',
    'tackles',
  ]);
  const [showComparison, setShowComparison] = useState(false);
  const [selectedPlayersForComparison, setSelectedPlayersForComparison] = useState<Player[]>([]);

  // Filter and sort players
  const filteredAndSortedPlayers = useMemo(() => {
    let filtered = players.filter((player) => {
      // Search filter
      const matchesSearch =
        !searchTerm ||
        player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (player.team && player.team.toLowerCase().includes(searchTerm.toLowerCase()));

      // Position filter
      const matchesPosition = positionFilter === 'all' || player.position === positionFilter;

      // Team filter
      const matchesTeam = teamFilter === 'all' || player.team === teamFilter;

      return matchesSearch && matchesPosition && matchesTeam;
    });

    // Sort players
    filtered.sort((a, b) => {
      let aValue: number | string | undefined;
      let bValue: number | string | undefined;

      if (sortField === 'name') {
        aValue = a.name;
        bValue = b.name;
      } else if (sortField === 'team') {
        aValue = a.team || '';
        bValue = b.team || '';
      } else if (sortField === 'position') {
        aValue = a.position || '';
        bValue = b.position || '';
      } else {
        // Find the stat column
        const statColumn = STAT_COLUMNS.find((col) => col.key === sortField);
        if (statColumn) {
          aValue = statColumn.accessor(a) || 0;
          bValue = statColumn.accessor(b) || 0;
        } else {
          aValue = 0;
          bValue = 0;
        }
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      const numA = Number(aValue) || 0;
      const numB = Number(bValue) || 0;

      return sortDirection === 'asc' ? numA - numB : numB - numA;
    });

    return filtered;
  }, [players, searchTerm, positionFilter, teamFilter, sortField, sortDirection]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="w-4 h-4" />
    ) : (
      <ChevronDown className="w-4 h-4" />
    );
  };

  const toggleStatColumn = (statKey: string) => {
    setSelectedStats((prev) =>
      prev.includes(statKey) ? prev.filter((s) => s !== statKey) : [...prev, statKey]
    );
  };

  const togglePlayerSelection = (player: Player) => {
    setSelectedPlayersForComparison((prev) => {
      const isSelected = prev.find((p) => p.id === player.id);
      if (isSelected) {
        return prev.filter((p) => p.id !== player.id);
      } else if (prev.length < 4) {
        return [...prev, player];
      }
      return prev;
    });
  };

  const isPlayerSelected = (player: Player) => {
    return selectedPlayersForComparison.find((p) => p.id === player.id) !== undefined;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Player Statistics</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {filteredAndSortedPlayers.length} of {players.length} players
            {selectedPlayersForComparison.length > 0 && (
              <span className="ml-2 text-blue-600 dark:text-blue-400">
                • {selectedPlayersForComparison.length} selected for comparison
              </span>
            )}
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-3">
          <button
            onClick={() => setShowComparison(true)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Compare Players
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search players or teams..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 w-full border border-gray-300 dark:border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:text-white"
          />
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Position Filter */}
              <div>
                <label
                  htmlFor="position-filter"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Position
                </label>
                <select
                  id="position-filter"
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value as FilterType)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 dark:bg-gray-700 dark:text-white"
                >
                  <option value="all">All Positions</option>
                  <option value="DEF">Defender</option>
                  <option value="MID">Midfielder</option>
                  <option value="FWD">Forward</option>
                  <option value="RUC">Ruckman</option>
                </select>
              </div>

              {/* Team Filter */}
              <div>
                <label
                  htmlFor="team-filter"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Team
                </label>
                <select
                  id="team-filter"
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 dark:bg-gray-700 dark:text-white"
                >
                  <option value="all">All Teams</option>
                  {TEAMS.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Stat Column Selection */}
            <div>
              <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Display Statistics
              </span>
              <div className="flex flex-wrap gap-2">
                {STAT_COLUMNS.map((stat) => (
                  <button
                    key={stat.key}
                    onClick={() => toggleStatColumn(stat.key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedStats.includes(stat.key)
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {stat.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Stats Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                {/* Selection column */}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  <div className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={selectedPlayersForComparison.length > 0}
                      onChange={() => setSelectedPlayersForComparison([])}
                    />
                    <span>Compare</span>
                  </div>
                </th>

                {/* Fixed columns */}
                <th
                  onClick={() => handleSort('name')}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  <div className="flex items-center space-x-1">
                    <span>Name</span>
                    {getSortIcon('name')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('team')}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  <div className="flex items-center space-x-1">
                    <span>Team</span>
                    {getSortIcon('team')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('position')}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                  <div className="flex items-center space-x-1">
                    <span>Position</span>
                    {getSortIcon('position')}
                  </div>
                </th>

                {/* Dynamic stat columns */}
                {STAT_COLUMNS.filter((stat) => selectedStats.includes(stat.key)).map((stat) => (
                  <th
                    key={stat.key}
                    onClick={() => handleSort(stat.key)}
                    className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    <div className="flex items-center justify-center space-x-1">
                      <span>{stat.label}</span>
                      {getSortIcon(stat.key)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {filteredAndSortedPlayers.map((player, index) => (
                <motion.tr
                  key={player.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  {/* Selection cell */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={isPlayerSelected(player)}
                      onChange={() => togglePlayerSelection(player)}
                      disabled={
                        !isPlayerSelected(player) && selectedPlayersForComparison.length >= 4
                      }
                    />
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {player.name}
                        </div>
                        {player.injury && (
                          <div className="text-xs text-red-600 dark:text-red-400">Injured</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                    {player.team ? (
                      <span title={player.team}>{getTeamAbbreviation(player.team)}</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        player.position === 'DEF'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          : player.position === 'MID'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : player.position === 'FWD'
                              ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                              : player.position === 'RUC'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {player.position}
                    </span>
                  </td>

                  {/* Dynamic stat columns */}
                  {STAT_COLUMNS.filter((stat) => selectedStats.includes(stat.key)).map((stat) => {
                    const value = stat.accessor(player);
                    const colorClass =
                      value !== undefined && value !== null && player.position
                        ? getStatColor(stat.key, value, player.position)
                        : 'text-gray-500 dark:text-gray-300';

                    return (
                      <td
                        key={stat.key}
                        className={`px-6 py-4 whitespace-nowrap text-center text-sm ${colorClass}`}
                      >
                        {value !== undefined && value !== null
                          ? stat.format
                            ? stat.format(value)
                            : value.toString()
                          : '-'}
                      </td>
                    );
                  })}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredAndSortedPlayers.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              No players match your search criteria.
            </p>
          </div>
        )}
      </div>

      {/* Player Comparison Modal */}
      <PlayerComparison
        players={players}
        isOpen={showComparison}
        onClose={() => setShowComparison(false)}
        initialPlayers={selectedPlayersForComparison}
      />
    </div>
  );
}
