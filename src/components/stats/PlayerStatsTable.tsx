'use client';

import { useState, useMemo } from 'react';

import { motion } from 'framer-motion';
import { Search, Filter, ChevronUp, ChevronDown, BarChart3 } from 'lucide-react';

import { getStatColor } from '@/hooks/usePlayerStats';
import { TeamLogo } from '@/components/TeamLogo';
import { UITable, tableClasses, tableStateClasses } from '@/components/ui/table';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import { cn } from '@/lib/utils';
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

const headerActionClasses =
  'inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const fieldClasses =
  'rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-primary/20 focus:outline-none focus:ring-2 focus:ring-ring';

const sortableHeaderButtonClasses =
  'flex w-full items-center gap-1 text-inherit transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

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
      <ChevronUp className="w-4 h-4" aria-hidden="true" />
    ) : (
      <ChevronDown className="w-4 h-4" aria-hidden="true" />
    );
  };

  const getSortAria = (field: string) => {
    if (sortField !== field) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const renderSortableHeader = (
    field: string,
    label: string,
    align: 'left' | 'center' = 'left'
  ) => (
    <th
      key={field}
      scope="col"
      aria-sort={getSortAria(field)}
      className={cn(tableClasses.th, 'px-6 py-3', align === 'center' ? 'text-center' : 'text-left')}
    >
      <button
        type="button"
        onClick={() => handleSort(field)}
        className={cn(
          sortableHeaderButtonClasses,
          align === 'center' ? 'justify-center' : 'justify-start'
        )}
      >
        <span>{label}</span>
        {getSortIcon(field)}
      </button>
    </th>
  );

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
          <h1 className="text-2xl font-bold text-foreground">Player Statistics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filteredAndSortedPlayers.length} of {players.length} players
            {selectedPlayersForComparison.length > 0 && (
              <span className="ml-2 text-primary">
                • {selectedPlayersForComparison.length} selected for comparison
              </span>
            )}
          </p>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-3">
          <button onClick={() => setShowComparison(true)} className={headerActionClasses}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Compare Players
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={headerActionClasses}
            aria-expanded={showFilters}
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
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search players or teams..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={cn(fieldClasses, 'w-full pl-10 pr-4')}
          />
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-muted/40 rounded-lg p-4 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Position Filter */}
              <div>
                <label
                  htmlFor="position-filter"
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Position
                </label>
                <select
                  id="position-filter"
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value as FilterType)}
                  className={cn(fieldClasses, 'w-full')}
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
                  className="block text-sm font-medium text-foreground mb-2"
                >
                  Team
                </label>
                <select
                  id="team-filter"
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className={cn(fieldClasses, 'w-full')}
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
              <span className="block text-sm font-medium text-foreground mb-2">
                Display Statistics
              </span>
              <div className="flex flex-wrap gap-2">
                {STAT_COLUMNS.map((stat) => (
                  <button
                    key={stat.key}
                    onClick={() => toggleStatColumn(stat.key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedStats.includes(stat.key)
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-foreground hover:bg-accent hover:text-accent-foreground'
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
      <div className={tableClasses.container}>
        <UITable className="min-w-full">
          <caption className="sr-only">Player statistics table</caption>
          <thead className={tableClasses.thead}>
            <tr>
              {/* Selection column */}
              <th scope="col" className={cn(tableClasses.th, 'px-4 py-3 text-left')}>
                <div className="flex items-center space-x-1">
                  <input
                    type="checkbox"
                    className="rounded border-border text-primary focus:ring-ring"
                    checked={selectedPlayersForComparison.length > 0}
                    onChange={() => setSelectedPlayersForComparison([])}
                    aria-label="Clear player comparison selections"
                  />
                  <span>Compare</span>
                </div>
              </th>

              {/* Fixed columns */}
              {renderSortableHeader('name', 'Name')}
              {renderSortableHeader('team', 'Team')}
              {renderSortableHeader('position', 'Position')}

              {/* Dynamic stat columns */}
              {STAT_COLUMNS.filter((stat) => selectedStats.includes(stat.key)).map((stat) =>
                renderSortableHeader(stat.key, stat.label, 'center')
              )}
            </tr>
          </thead>
          <tbody className={tableClasses.tbody}>
            {filteredAndSortedPlayers.length === 0 ? (
              <tr>
                <td colSpan={selectedStats.length + 4} className={tableStateClasses.empty}>
                  No players match your search criteria.
                </td>
              </tr>
            ) : (
              filteredAndSortedPlayers.map((player, index) => (
                <motion.tr
                  key={player.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-muted/40"
                >
                  {/* Selection cell */}
                  <td className={cn(tableClasses.td, 'px-4 py-4 whitespace-nowrap')}>
                    <input
                      type="checkbox"
                      className="rounded border-border text-primary focus:ring-ring"
                      checked={isPlayerSelected(player)}
                      onChange={() => togglePlayerSelection(player)}
                      disabled={
                        !isPlayerSelected(player) && selectedPlayersForComparison.length >= 4
                      }
                      aria-label={`Select ${player.name} for comparison`}
                    />
                  </td>

                  <td className={cn(tableClasses.td, 'px-6 py-4 whitespace-nowrap')}>
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-foreground">{player.name}</div>
                        {player.injury && <div className="text-xs text-destructive">Injured</div>}
                      </div>
                    </div>
                  </td>
                  <td
                    className={cn(
                      tableClasses.td,
                      'px-6 py-4 whitespace-nowrap text-sm text-muted-foreground'
                    )}
                  >
                    {player.team ? (
                      <span className="inline-flex items-center gap-2" title={player.team}>
                        <TeamLogo team={player.team} size={18} withCircle decorative />
                        <span>{getTeamAbbreviation(player.team)}</span>
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className={cn(tableClasses.td, 'px-6 py-4 whitespace-nowrap')}>
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        player.position === 'DEF'
                          ? 'bg-primary/10 text-primary'
                          : player.position === 'MID'
                            ? 'bg-accent text-accent-foreground'
                            : player.position === 'FWD'
                              ? 'bg-destructive/10 text-destructive'
                              : player.position === 'RUC'
                                ? 'bg-muted text-foreground'
                                : 'bg-muted text-muted-foreground'
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
                        : 'text-muted-foreground';

                    return (
                      <td
                        key={stat.key}
                        className={cn(
                          tableClasses.td,
                          'px-6 py-4 whitespace-nowrap text-center text-sm',
                          colorClass
                        )}
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
              ))
            )}
          </tbody>
        </UITable>
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
