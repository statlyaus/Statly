'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';

import dynamic from 'next/dynamic';

import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  Funnel,
  Search,
  Star,
  Trophy,
  UserPlus,
  Zap,
} from 'lucide-react';

import { UITable, tableClasses } from '@/components/ui/table';
import { TeamLogo } from '@/components/TeamLogo';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useRankings } from '@/hooks/useRankings';
import { getTeamAbbreviation } from '@/lib/teamLogos';
import { getTeamToken } from '@/lib/teamTokens';
import type { PlayerLite } from '@/types/players';

import type { FixedSizeListProps, ListChildComponentProps } from 'react-window';

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

// Threshold for switching to virtualized rendering (higher to preserve native features like Ctrl+F)
const VIRTUALIZE_THRESHOLD = 700;

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
    const [searchTerm, setSearchTerm] = useLocalStorage('playersTable.search', '');
    const [sortField, setSortField] = useState<SortField>('value');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [positionFilter, setPositionFilter] = useLocalStorage('playersTable.position', 'ALL');
    const [teamFilter, setTeamFilter] = useLocalStorage('playersTable.team', 'ALL');
    const [showFilters, setShowFilters] = useState(false);
    const [viewMode, setViewMode] = useLocalStorage<'compact' | 'detailed'>(
      'playersTable.viewMode',
      'compact'
    );
    const [density, setDensity] = useLocalStorage<'comfortable' | 'compact'>(
      'playersTable.density',
      'comfortable'
    );
    const [columns, setColumns] = useLocalStorage<{
      team: boolean;
      position: boolean;
      value: boolean;
      actions: boolean;
    }>('playersTable.columns', { team: true, position: true, value: true, actions: true });
    const [accessibleMode, setAccessibleMode] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState<number>(0);
    const listOuterRef = useRef<HTMLDivElement | null>(null);
    const PAGE_SIZE = 100;
    const [page, setPage] = useState(1);

    // Enhanced player data with rankings
    const enhancedPlayers = useMemo<EnhancedPlayer[]>(() => {
      return players.map<EnhancedPlayer>((player) => {
        const rankingData = rankings.find((r) => r.id === String(player.id));
        const enhanced: EnhancedPlayer = {
          ...player,
          isWatched: watchlist.includes(String(player.id)),
          isDrafted: draftedPlayers.includes(String(player.id)),
        };
        if (rankingData) {
          enhanced.ranking = {
            rank: rankingData.rank,
            valueOverReplacement: rankingData.valueOverReplacement,
          };
        }
        return enhanced;
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

    // Virtualized row list (loaded only when needed)
    const VirtualList = useMemo(
      () =>
        dynamic<FixedSizeListProps>(() => import('react-window').then((m) => m.FixedSizeList), {
          ssr: false,
        }),
      []
    );

    const ROW_HEIGHT = 56;
    const scrollToIndex = useCallback((index: number) => {
      const container = listOuterRef.current;
      if (!container) return;
      const targetTop = index * ROW_HEIGHT;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (targetTop < viewTop) {
        container.scrollTo({ top: targetTop, behavior: 'auto' });
      } else if (targetTop + ROW_HEIGHT > viewBottom) {
        container.scrollTo({
          top: targetTop - container.clientHeight + ROW_HEIGHT,
          behavior: 'auto',
        });
      }
    }, []);

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

    useEffect(() => {
      setFocusedIndex(0);
      setPage(1);
    }, [filteredPlayers.length]);

    const visiblePlayers = useMemo(() => {
      if (accessibleMode && filteredPlayers.length > VIRTUALIZE_THRESHOLD) {
        return filteredPlayers.slice(0, page * PAGE_SIZE);
      }
      return filteredPlayers;
    }, [filteredPlayers, accessibleMode, page]);

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
      if (!rank) return 'text-muted-foreground';
      if (rank <= 10) return 'text-primary font-bold';
      if (rank <= 25) return 'text-primary font-semibold';
      if (rank <= 50) return 'text-accent-foreground font-medium';
      if (rank <= 100) return 'text-foreground';
      return 'text-muted-foreground';
    }, []);

    // Get rank badge styling
    const getRankBadge = useCallback((rank?: number) => {
      if (!rank) return 'bg-muted text-muted-foreground';
      if (rank <= 10) return 'bg-primary text-primary-foreground';
      if (rank <= 25) return 'bg-accent text-accent-foreground';
      return 'bg-muted text-muted-foreground';
    }, []);

    // Render sort icon
    const renderSortIcon = (field: SortField) => {
      if (sortField !== field) {
        return <ChevronsUpDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />;
      }
      return sortDirection === 'asc' ? (
        <ChevronUp className="w-4 h-4 text-primary" aria-hidden="true" />
      ) : (
        <ChevronDown className="w-4 h-4 text-primary" aria-hidden="true" />
      );
    };

    // Error state
    if (error) {
      return (
        <div className={`rounded-lg border border-border bg-card p-6 ${className}`}>
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-medium text-foreground">Error Loading Rankings</h3>
              <p className="text-sm text-destructive mt-1">{error}</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden ${className}`}
      >
        {/* Header with search and filters */}
        <div className="border-b border-border bg-muted/40 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Available Players</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''} available
                {searchTerm && ` (filtered from ${enhancedPlayers.length})`}
              </p>
              {/* Live region announcing changes for assistive tech */}
              <div className="sr-only" aria-live="polite" aria-atomic="true">
                {`Sorted by ${sortField} ${sortDirection}. ${filteredPlayers.length} results.`}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Density toggle */}
              <div className="rounded-lg border border-border bg-background p-1 flex">
                <button
                  onClick={() => setDensity('comfortable')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${density === 'comfortable' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Comfortable
                </button>
                <button
                  onClick={() => setDensity('compact')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${density === 'compact' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Compact
                </button>
              </div>
              {/* View mode toggle */}
              <div className="rounded-lg border border-border bg-background p-1 flex">
                <button
                  onClick={() => setViewMode('compact')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    viewMode === 'compact'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Compact
                </button>
                <button
                  onClick={() => setViewMode('detailed')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    viewMode === 'detailed'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Detailed
                </button>
              </div>

              {/* Column chooser */}
              <div className="relative">
                <details className="rounded-lg border border-border bg-background">
                  <summary className="list-none px-3 py-2 text-sm font-medium cursor-pointer">
                    Columns
                  </summary>
                  <div className="p-3 border-t border-border grid grid-cols-2 gap-2 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={columns.team}
                        onChange={(e) => setColumns((c) => ({ ...c, team: e.target.checked }))}
                      />{' '}
                      Team
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={columns.position}
                        onChange={(e) => setColumns((c) => ({ ...c, position: e.target.checked }))}
                      />{' '}
                      Position
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={columns.value}
                        onChange={(e) => setColumns((c) => ({ ...c, value: e.target.checked }))}
                      />{' '}
                      Value
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={columns.actions}
                        onChange={(e) => setColumns((c) => ({ ...c, actions: e.target.checked }))}
                      />{' '}
                      Actions
                    </label>
                  </div>
                </details>
              </div>

              {/* Filters toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  showFilters
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <Funnel className="w-4 h-4" aria-hidden="true" />
                Filters
              </button>

              {/* Accessibility mode toggle (alternative to virtualization) */}
              {filteredPlayers.length > VIRTUALIZE_THRESHOLD && (
                <button
                  onClick={() => setAccessibleMode((v) => !v)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                    accessibleMode
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                  title={
                    accessibleMode
                      ? 'Using accessible list with Load more'
                      : 'Switch to accessible list with Load more'
                  }
                >
                  {accessibleMode ? 'Accessible list' : 'Accessible list'}
                </button>
              )}
            </div>
          </div>

          {/* Export button */}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={async () => {
                try {
                  const rows = visiblePlayers.map((p) => ({
                    id: p.id,
                    name: p.name,
                    team: p.team,
                    position: p.position,
                    rank: p.ranking?.rank ?? '',
                    valueOverReplacement: p.ranking?.valueOverReplacement ?? '',
                    watched: p.isWatched ? 'yes' : 'no',
                    drafted: p.isDrafted ? 'yes' : 'no',
                  }));
                  const res = await fetch('/api/export/players', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      rows,
                      columns: [
                        'id',
                        'name',
                        'team',
                        'position',
                        'rank',
                        'valueOverReplacement',
                        'watched',
                        'drafted',
                      ],
                      fileName: 'players.csv',
                    }),
                  });
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'players.csv';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  console.error('Export failed', e);
                }
              }}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-border bg-background hover:bg-accent hover:text-accent-foreground text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Export CSV
            </button>
          </div>

          {/* Search bar */}
          <div className="mt-4 relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search players, teams, or positions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:border-ring transition-colors"
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
                    className="block text-xs font-medium text-muted-foreground mb-1"
                  >
                    Position
                  </label>
                  <select
                    id="position-filter"
                    value={positionFilter}
                    onChange={(e) => setPositionFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring"
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
                    className="block text-xs font-medium text-muted-foreground mb-1"
                  >
                    Team
                  </label>
                  <select
                    id="team-filter"
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:ring-2 focus:ring-ring focus:border-ring"
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
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-muted border-t-primary rounded-full animate-spin"></div>
              Loading player rankings...
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredPlayers.length === 0 && (
          <div className="p-8 text-center">
            <UserPlus
              className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3"
              aria-hidden="true"
            />
            <h3 className="text-sm font-medium text-foreground mb-1">No players found</h3>
            <p className="text-sm text-muted-foreground">
              {searchTerm || positionFilter !== 'ALL' || teamFilter !== 'ALL'
                ? 'Try adjusting your search or filter criteria.'
                : 'No players are currently available for drafting.'}
            </p>
          </div>
        )}

        {/* Table */}
        {!loading && filteredPlayers.length > 0 && (
          <div className={tableClasses.container}>
            {filteredPlayers.length > VIRTUALIZE_THRESHOLD && !accessibleMode ? (
              <div role="table" aria-label="Available players" className="min-w-full">
                <VirtualList
                  height={560}
                  itemCount={filteredPlayers.length}
                  itemSize={ROW_HEIGHT}
                  width="100%"
                  itemKey={(index: number) => String(filteredPlayers[index]?.id ?? index)}
                  outerRef={listOuterRef}
                >
                  {({ index, style }: ListChildComponentProps) => {
                    const player = filteredPlayers[index];
                    if (!player) return null;
                    const isActive = index === focusedIndex;
                    return (
                      <div
                        role="row"
                        aria-rowindex={index + 1}
                        aria-selected={isActive}
                        style={style}
                        tabIndex={isActive ? 0 : -1}
                        onFocus={() => setFocusedIndex(index)}
                        onClick={(e) => {
                          setFocusedIndex(index);
                          (e.currentTarget as HTMLDivElement).focus();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const next = Math.min(filteredPlayers.length - 1, index + 1);
                            setFocusedIndex(next);
                            scrollToIndex(next);
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            const prev = Math.max(0, index - 1);
                            setFocusedIndex(prev);
                            scrollToIndex(prev);
                          } else if (e.key === 'Home') {
                            e.preventDefault();
                            setFocusedIndex(0);
                            scrollToIndex(0);
                          } else if (e.key === 'End') {
                            e.preventDefault();
                            const last = filteredPlayers.length - 1;
                            setFocusedIndex(last);
                            scrollToIndex(last);
                          } else if ((e.key === 'Enter' || e.key === ' ') && onViewDetails) {
                            e.preventDefault();
                            onViewDetails(player);
                          }
                        }}
                        className={`flex items-center border-b border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-150 ${
                          player.isDrafted ? 'opacity-50' : ''
                        } ${player.isWatched ? 'bg-primary/5' : ''}`}
                      >
                        {/* Name cell with min-width and indicators */}
                        <div
                          role="cell"
                          className="px-4 py-3 flex items-center gap-2 min-w-[200px] flex-[2] overflow-hidden"
                        >
                          <span className="truncate text-sm font-semibold text-foreground">
                            {player.name}
                          </span>
                          {player.isWatched && (
                            <Star
                              className="w-4 h-4 text-primary flex-none fill-current"
                              aria-hidden="true"
                            />
                          )}
                          {player.isDrafted && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground flex-none">
                              Drafted
                            </span>
                          )}
                          {viewMode === 'compact' && player.ranking?.rank && (
                            <span className="text-[11px] text-muted-foreground ml-1 flex-none">
                              #{player.ranking.rank}
                            </span>
                          )}
                        </div>

                        {/* Team/Position cell with explicit min-width */}
                        <div
                          role="cell"
                          className="px-4 py-3 flex items-center gap-3 min-w-[160px] flex-[1]"
                        >
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                            title={player.team || undefined}
                          >
                            {player.team ? (
                              <>
                                <TeamLogo team={player.team} size={16} withCircle decorative />
                                <span>{getTeamAbbreviation(player.team)}</span>
                              </>
                            ) : (
                              '—'
                            )}
                          </span>
                          <span className="text-sm font-medium text-foreground">
                            {player.position || '—'}
                          </span>
                        </div>

                        {/* Fantasy value cell that does not shrink */}
                        <div
                          role="cell"
                          className="px-4 py-3 text-right basis-[120px] shrink-0 ml-auto"
                        >
                          <span
                            className={`text-sm font-mono ${getValueColor(player.ranking?.rank)}`}
                          >
                            {player.ranking?.valueOverReplacement?.toFixed?.(2) ?? '—'}
                          </span>
                        </div>

                        {/* Actions cell with accessible buttons; lightweight wrapper for hybrid expansion */}
                        <div
                          role="cell"
                          className="px-4 py-3 whitespace-nowrap text-right basis-[112px] shrink-0"
                        >
                          <div className="flex items-center justify-end gap-1 group">
                            {onViewDetails && (
                              <button
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  onViewDetails(player);
                                }}
                                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                title="View player details"
                                aria-label={`View details for ${player.name}`}
                              >
                                <span className="inline-flex items-center">
                                  <Eye className="w-4 h-4" aria-hidden="true" />
                                  <span className="ml-1 hidden md:inline text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                    View
                                  </span>
                                </span>
                              </button>
                            )}
                            {onAddToWatchlist && !player.isDrafted && (
                              <button
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  onAddToWatchlist(player);
                                }}
                                className={`p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ${
                                  player.isWatched
                                    ? 'text-primary hover:text-primary/80'
                                    : 'text-muted-foreground hover:text-primary'
                                }`}
                                title={
                                  player.isWatched ? 'Remove from watchlist' : 'Add to watchlist'
                                }
                                aria-label={`${player.isWatched ? 'Remove' : 'Add'} ${player.name} ${player.isWatched ? 'from' : 'to'} watchlist`}
                                aria-pressed={player.isWatched}
                              >
                                <span className="inline-flex items-center">
                                  {player.isWatched ? (
                                    <Star className="w-4 h-4 fill-current" aria-hidden="true" />
                                  ) : (
                                    <Star className="w-4 h-4" aria-hidden="true" />
                                  )}
                                  <span className="ml-1 hidden md:inline text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                    {player.isWatched ? 'Unwatch' : 'Watch'}
                                  </span>
                                </span>
                              </button>
                            )}
                            {onDraftPlayer && !player.isDrafted && (
                              <button
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  onDraftPlayer(player);
                                }}
                                className="p-1.5 text-primary hover:text-primary/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                title="Draft this player"
                                aria-label={`Draft ${player.name}`}
                              >
                                <span className="inline-flex items-center">
                                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                                  <span className="ml-1 hidden md:inline text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                                    Draft
                                  </span>
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </VirtualList>
              </div>
            ) : (
              <UITable className="min-w-full">
                <thead className={tableClasses.thead}>
                  <tr>
                    {viewMode === 'detailed' && (
                      <th scope="col" className={`${tableClasses.th} text-left`}>
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
                      className={`${tableClasses.th} cursor-pointer text-left transition-colors hover:bg-muted/60 group`}
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
                      className={`${tableClasses.th} cursor-pointer text-left transition-colors hover:bg-muted/60 group`}
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
                      className={`${tableClasses.th} cursor-pointer text-left transition-colors hover:bg-muted/60 group`}
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
                      className={`${tableClasses.th} cursor-pointer text-right transition-colors hover:bg-muted/60 group`}
                      onClick={() => handleSort('value')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Fantasy Value
                        {renderSortIcon('value')}
                      </div>
                    </th>

                    <th scope="col" className={`${tableClasses.th} text-right`}>
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody className={`${tableClasses.tbody} ${tableClasses.trZebra}`}>
                  <AnimatePresence>
                    {visiblePlayers.map((player, index) => (
                      <motion.tr
                        key={player.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ delay: index * 0.02, duration: 0.2 }}
                        className={`transition-all duration-150 hover:bg-muted/40 ${
                          player.isDrafted ? 'opacity-50' : ''
                        } ${player.isWatched ? 'bg-primary/5' : ''}`}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          const row = e.currentTarget as HTMLTableRowElement;
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            (row.nextElementSibling as HTMLElement | null)?.focus();
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            (row.previousElementSibling as HTMLElement | null)?.focus();
                          }
                        }}
                      >
                        {/* Rank column (detailed view only) */}
                        {viewMode === 'detailed' && (
                          <td
                            className={`${tableClasses.td} ${density === 'compact' ? 'py-2' : 'py-3'} whitespace-nowrap`}
                          >
                            {player.ranking?.rank ? (
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${getRankBadge(player.ranking.rank)}`}
                                >
                                  {player.ranking.rank}
                                </span>
                                {player.ranking.rank === 1 && (
                                  <Trophy className="w-4 h-4 text-primary" aria-hidden="true" />
                                )}
                                {player.ranking.rank <= 10 && player.ranking.rank > 1 && (
                                  <Zap className="w-4 h-4 text-primary" aria-hidden="true" />
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Unranked</span>
                            )}
                          </td>
                        )}

                        {/* Player name (sticky first column) */}
                        <td
                          className={`${tableClasses.td} ${density === 'compact' ? 'py-2' : 'py-3'} sticky left-0 z-10 whitespace-nowrap bg-background`}
                        >
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-foreground">
                                  {player.name}
                                </span>
                                {player.isWatched && (
                                  <Star
                                    className="w-4 h-4 text-primary fill-current"
                                    aria-hidden="true"
                                  />
                                )}
                                {player.isDrafted && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                    Drafted
                                  </span>
                                )}
                              </div>
                              {viewMode === 'compact' && player.ranking?.rank && (
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  Rank #{player.ranking.rank}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Team */}
                        {columns.team && (
                          <td
                            className={`${tableClasses.td} ${density === 'compact' ? 'py-2' : 'py-3'} whitespace-nowrap`}
                          >
                            {(() => {
                              const token = getTeamToken(player.team);
                              const style = token
                                ? {
                                    backgroundColor: token.subtle,
                                    color: token.onSubtle,
                                    borderColor: token.border,
                                  }
                                : undefined;
                              return (
                                <span
                                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                                  style={style}
                                  title={player.team || undefined}
                                >
                                  {player.team ? (
                                    <>
                                      <TeamLogo
                                        team={player.team}
                                        size={16}
                                        withCircle
                                        decorative
                                      />
                                      <span>{getTeamAbbreviation(player.team)}</span>
                                    </>
                                  ) : (
                                    '—'
                                  )}
                                </span>
                              );
                            })()}
                          </td>
                        )}

                        {/* Position */}
                        {columns.position && (
                          <td className={`${tableClasses.td} whitespace-nowrap`}>
                            <span className="text-sm font-medium">{player.position || '—'}</span>
                          </td>
                        )}

                        {/* Fantasy value */}
                        {columns.value && (
                          <td
                            className={`${tableClasses.tdNumeric} ${density === 'compact' ? 'py-2' : 'py-3'} whitespace-nowrap`}
                          >
                            {player.ranking?.valueOverReplacement ? (
                              <div className="text-right">
                                <div
                                  className={`text-sm font-mono ${getValueColor(player.ranking.rank)}`}
                                >
                                  {player.ranking.valueOverReplacement.toFixed(2)}
                                </div>
                                {viewMode === 'detailed' && (
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    pts above replacement
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </td>
                        )}

                        {/* Actions */}
                        {columns.actions && (
                          <td
                            className={`${tableClasses.td} ${density === 'compact' ? 'py-2' : 'py-3'} whitespace-nowrap text-right`}
                          >
                            <div className="flex items-center justify-end gap-1">
                              {/* View details */}
                              {onViewDetails && (
                                <button
                                  onClick={() => onViewDetails(player)}
                                  className="p-1.5 text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                  title="View player details"
                                  aria-label={`View details for ${player.name}`}
                                >
                                  <Eye className="w-4 h-4" aria-hidden="true" />
                                </button>
                              )}

                              {/* Add to watchlist */}
                              {onAddToWatchlist && !player.isDrafted && (
                                <button
                                  onClick={() => onAddToWatchlist(player)}
                                  className={`p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ${
                                    player.isWatched
                                      ? 'text-primary hover:text-primary/80'
                                      : 'text-muted-foreground hover:text-primary'
                                  }`}
                                  title={
                                    player.isWatched ? 'Remove from watchlist' : 'Add to watchlist'
                                  }
                                  aria-label={`${player.isWatched ? 'Remove' : 'Add'} ${player.name} ${player.isWatched ? 'from' : 'to'} watchlist`}
                                  aria-pressed={player.isWatched}
                                >
                                  {player.isWatched ? (
                                    <Star className="w-4 h-4 fill-current" aria-hidden="true" />
                                  ) : (
                                    <Star className="w-4 h-4" aria-hidden="true" />
                                  )}
                                </button>
                              )}

                              {/* Draft player */}
                              {onDraftPlayer && !player.isDrafted && (
                                <button
                                  onClick={() => onDraftPlayer(player)}
                                  className="p-1.5 text-primary transition-colors hover:text-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                  title="Draft this player"
                                  aria-label={`Draft ${player.name}`}
                                >
                                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </UITable>
            )}
          </div>
        )}

        {/* Load more for accessible list mode */}
        {!loading && accessibleMode && filteredPlayers.length > VIRTUALIZE_THRESHOLD && (
          <div className="px-4 py-3 border-t border-border flex justify-center">
            {visiblePlayers.length < filteredPlayers.length ? (
              <button
                onClick={() => setPage((p) => p + 1)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground bg-background hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Load more
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">All players loaded</span>
            )}
          </div>
        )}

        {/* Footer with summary stats */}
        {!loading && filteredPlayers.length > 0 && (
          <div className="bg-muted/40 px-4 py-3 border-t border-border">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 text-xs text-muted-foreground">
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
