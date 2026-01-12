'use client';

import { useState, useMemo, useCallback } from 'react';

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
  PlusIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { motion, AnimatePresence } from 'framer-motion';

import { useRankings } from '@/app/tradecentre/RankingsContext';
import { getTeamAbbreviation } from '@/lib/teamLogos';

import { ValueChip } from './ValueChip';

import type { Player, Team } from '../types/players';

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
  /** Optional: read-only view (hide action buttons) */
  readOnly?: boolean;
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
type LineupSlotState = 'empty' | 'active' | 'bench' | 'emergency' | 'locked';

interface TeamStats {
  totalPlayers: number;
  totalValue: number;
  avgValue: number;
  positionBreakdown: Record<string, number>;
  captainSet: boolean;
  viceCaptainSet: boolean;
  rosterComplete: boolean;
}

type StatColumn = {
  key: string;
  label: string;
  accessor: (player: Player) => number;
};

const getStatValue = (player: Player, key: string): number => {
  const direct = (player as Record<string, unknown>)[key];
  if (typeof direct === 'number') return direct;
  const fromStats = player.stats?.[key];
  if (typeof fromStats === 'number') return fromStats;
  if (typeof fromStats === 'string') {
    const parsed = Number.parseFloat(fromStats);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
};

const STAT_COLUMNS: StatColumn[] = [
  { key: 'goals', label: 'Goals', accessor: (p) => getStatValue(p, 'goals') },
  { key: 'kicks', label: 'Kicks', accessor: (p) => getStatValue(p, 'kicks') },
  { key: 'handballs', label: 'HB', accessor: (p) => getStatValue(p, 'handballs') },
  {
    key: 'disposals',
    label: 'Disp',
    accessor: (p) => getStatValue(p, 'kicks') + getStatValue(p, 'handballs'),
  },
  { key: 'marks', label: 'Marks', accessor: (p) => getStatValue(p, 'marks') },
  { key: 'tackles', label: 'Tackles', accessor: (p) => getStatValue(p, 'tackles') },
  { key: 'hitouts', label: 'Hitouts', accessor: (p) => getStatValue(p, 'hitouts') },
  { key: 'clearances', label: 'Clr', accessor: (p) => getStatValue(p, 'clearances') },
  { key: 'inside50s', label: 'I50', accessor: (p) => getStatValue(p, 'inside50s') },
  { key: 'rebound50s', label: 'R50', accessor: (p) => getStatValue(p, 'rebound50s') },
  {
    key: 'contestedPossessions',
    label: 'CP',
    accessor: (p) => getStatValue(p, 'contestedPossessions'),
  },
  {
    key: 'effectiveDisposals',
    label: 'ED',
    accessor: (p) => getStatValue(p, 'effectiveDisposals'),
  },
  {
    key: 'scoreInvolvements',
    label: 'SI',
    accessor: (p) => getStatValue(p, 'scoreInvolvements'),
  },
  { key: 'intercepts', label: 'Int', accessor: (p) => getStatValue(p, 'intercepts') },
  {
    key: 'contestedMarks',
    label: 'CM',
    accessor: (p) => getStatValue(p, 'contestedMarks'),
  },
  { key: 'metresGained', label: 'MG', accessor: (p) => getStatValue(p, 'metresGained') },
];

const LINEUP_CONFIG = {
  starters: 18,
  interchange: 4,
  emergency: 2,
};

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

function formatTeam(team?: string) {
  return team ? getTeamAbbreviation(team) : '—';
}

const MyTeamPanel = ({
  team,
  players,
  sortByValue = true,
  onPlayerSelect,
  onTeamAction,
  showAdvancedFeatures = false,
  readOnly = false,
  compact = false,
  maxHeight = '600px',
  onRefresh,
  isLoading = false,
  className = '',
}: MyTeamPanelProps) => {
  const rankings = useRankings();
  const [sortField, setSortField] = useState<SortField>(sortByValue ? 'totalValue' : 'name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [viewMode, setViewMode] = useState<'lineup' | 'roster' | 'stats'>('roster');
  const [statSortKey, setStatSortKey] = useState<string>('goals');
  const [statSortDir, setStatSortDir] = useState<'asc' | 'desc'>('desc');
  const statsGridCols =
    'grid-cols-[minmax(0,2fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_repeat(16,minmax(0,0.9fr))_minmax(0,0.9fr)_minmax(0,1.6fr)]';

  const draftedPlayers = useMemo(() => {
    if (!team) return [];
    return players.filter((p) => (team.players ?? []).map(String).includes(String(p.id)));
  }, [team, players]);

  const lineupPlayers = useMemo(() => draftedPlayers, [draftedPlayers]);
  const lineupSections = useMemo(() => {
    const starters = lineupPlayers.slice(0, LINEUP_CONFIG.starters);
    const interchange = lineupPlayers.slice(
      LINEUP_CONFIG.starters,
      LINEUP_CONFIG.starters + LINEUP_CONFIG.interchange
    );
    const emergency = lineupPlayers.slice(
      LINEUP_CONFIG.starters + LINEUP_CONFIG.interchange,
      LINEUP_CONFIG.starters + LINEUP_CONFIG.interchange + LINEUP_CONFIG.emergency
    );
    return { starters, interchange, emergency };
  }, [lineupPlayers]);

  // Calculate team statistics
  const teamStats = useMemo<TeamStats>(() => {
    const positionBreakdown: Record<string, number> = {};
    let totalValue = 0;
    let captainSet = false;
    let viceCaptainSet = false;

    draftedPlayers.forEach((player) => {
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
      rosterComplete: draftedPlayers.length >= 22, // Standard AFL Fantasy roster
    };
  }, [draftedPlayers, rankings]);

  // Filter and sort players
  const filteredAndSortedPlayers = useMemo(() => {
    let filtered = [...draftedPlayers];

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (player) =>
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
        filtered = filtered.filter((p) => {
          const extP = p as ExtendedPlayer;
          return extP.isCaptain || extP.isViceCaptain;
        });
        break;
      case 'injury':
        filtered = filtered.filter((p) => p.injury);
        break;
    }

    // Apply sorting
    filtered.sort((a, b) => {
      if (viewMode === 'stats') {
        const col = STAT_COLUMNS.find((c) => c.key === statSortKey);
        const aVal = col ? col.accessor(a) : 0;
        const bVal = col ? col.accessor(b) : 0;
        return statSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
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
  }, [
    draftedPlayers,
    searchTerm,
    filterType,
    sortField,
    sortDirection,
    rankings,
    viewMode,
    statSortKey,
    statSortDir,
  ]);

  const handleStatSort = (key: string) => {
    if (statSortKey === key) {
      setStatSortDir(statSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setStatSortKey(key);
      setStatSortDir('desc');
    }
  };

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setSortField(field);
        setSortDirection('desc');
      }
    },
    [sortField, sortDirection]
  );

  const handlePlayerClick = useCallback(
    (player: Player) => {
      setSelectedPlayer(player);
      onPlayerSelect?.(player);
    },
    [onPlayerSelect]
  );

  const getPositionColor = (position: string) => {
    const colors = {
      DEF: 'text-blue-600 bg-blue-50',
      MID: 'text-green-600 bg-green-50',
      FWD: 'text-red-600 bg-red-50',
      RUC: 'text-purple-600 bg-purple-50',
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
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <UserIcon className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <h2 id="team-heading" className="text-lg font-semibold mb-2">
            No Team Selected
          </h2>
          <p className="mb-4 text-slate-500">Join a league or create a team to get started</p>
          <button
            onClick={() => onTeamAction?.('create')}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800"
          >
            <PlusIcon className="h-4 w-4" />
            Create Team
          </button>
        </div>
      </section>
    );
  }

  const slotClasses: Record<LineupSlotState, string> = {
    empty: 'bg-[#11151B] border border-dashed border-slate-700/70 text-slate-500',
    active: 'bg-[#141C24] border border-slate-600/70 text-slate-100',
    bench: 'bg-[#121821] border border-slate-800/80 text-slate-200',
    emergency: 'bg-[#0E1218] border border-slate-800/80 text-slate-400',
    locked: 'bg-[#0B0F14] border border-slate-900 text-slate-600',
  };

  const renderPlayerSlot = (player: Player | undefined, state: LineupSlotState) => {
    return (
      <button
        type="button"
        onClick={() => {
          if (readOnly) return;
          if (player) {
            onPlayerSelect?.(player);
          } else {
            onTeamAction?.('select');
          }
        }}
        disabled={readOnly}
        className={`flex h-[80px] w-full flex-col justify-center rounded-[10px] px-4 text-left transition ${
          slotClasses[state]
        } ${readOnly ? 'cursor-default' : 'hover:border-blue-400/60'}`}
      >
        {player ? (
          <>
            <div className="text-sm font-semibold">{player.name}</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
              {player.position ? capFirst(player.position) : 'UNK'} · {formatTeam(player.team)}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold">Select Player</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-600">
              Empty Slot
            </div>
          </>
        )}
      </button>
    );
  };

  return (
    <section aria-labelledby="team-heading" className={className}>
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Header */}
        <div className="border-b border-slate-800 bg-slate-950 px-6 py-5 text-white">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <TrophyIcon className="h-5 w-5 text-emerald-400" />
              <h2 id="team-heading" className={`font-semibold ${compact ? 'text-sm' : 'text-lg'}`}>
                {team.name || 'My Team'}
              </h2>
              {isLoading && <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white/70" />}
            </div>

            <div className="flex items-center gap-2">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 transition hover:border-white/30 hover:text-white"
                  aria-label="Refresh team data"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </button>
              )}

              {showAdvancedFeatures && (
                <button
                  onClick={() => setShowStats(!showStats)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 transition hover:border-white/30 hover:text-white"
                  aria-label="Toggle team statistics"
                >
                  <ChartBarIcon className="h-4 w-4" />
                  {showStats ? (
                    <ChevronUpIcon className="h-3 w-3" />
                  ) : (
                    <ChevronDownIcon className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Team Stats Summary */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Players</div>
              <div className="mt-1 text-lg font-semibold text-white">{teamStats.totalPlayers}</div>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Value</div>
              <div className="mt-1 text-lg font-semibold text-white">
                ${(teamStats.totalValue / 1000000).toFixed(1)}M
              </div>
            </div>
            <div className="rounded-xl bg-white/10 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Status</div>
              <div className="mt-1 text-lg font-semibold text-white">
                {teamStats.rosterComplete ? 'Complete' : 'Incomplete'}
              </div>
            </div>
          </div>

          {/* Expanded Stats */}
          <AnimatePresence>
            {showStats && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 border-t border-white/10 pt-4"
              >
                <div className="grid grid-cols-2 gap-4 text-xs text-white/70">
                  <div>
                    <h4 className="font-medium mb-2 text-white/80">Position Breakdown</h4>
                    {Object.entries(teamStats.positionBreakdown).map(([pos, count]) => (
                      <div key={pos} className="flex justify-between">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-white/70">
                          {pos}
                        </span>
                        <span className="text-white/80">{count}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="font-medium mb-2 text-white/80">Team Status</h4>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {teamStats.captainSet ? (
                          <StarIconSolid className="h-3 w-3 text-amber-300" />
                        ) : (
                          <StarIcon className="h-3 w-3 text-white/30" />
                        )}
                        <span className="text-white/70">Captain</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {teamStats.viceCaptainSet ? (
                          <ShieldCheckIcon className="h-3 w-3 text-emerald-300" />
                        ) : (
                          <ShieldCheckIcon className="h-3 w-3 text-white/30" />
                        )}
                        <span className="text-white/70">Vice Captain</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Filters and Search */}
          {showAdvancedFeatures && draftedPlayers.length > 0 && viewMode !== 'lineup' && (
            <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white px-6 py-5 text-slate-700 shadow-sm">
              {/* Search */}
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search players..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-full border border-slate-200 bg-slate-50/60 py-2.5 pl-10 pr-4 text-sm text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                {/* View + Filters */}
                <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      View
                    </span>
                {(['lineup', 'roster', 'stats'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      viewMode === mode
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'
                    }`}
                  >
                    {mode === 'roster' ? 'Roster' : mode === 'stats' ? 'All Stats' : 'Lineup'}
                  </button>
                ))}
              </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Filter
                    </span>
                    {(['all', 'starters', 'bench', 'captain', 'injury'] as FilterType[]).map(
                      (filter) => (
                        <button
                          key={filter}
                          onClick={() => setFilterType(filter)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                            filterType === filter
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'
                          }`}
                        >
                          {capFirst(filter)}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Sort Options */}
                <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      Sort by
                    </span>
                    {(['name', 'position', 'totalValue', 'recent'] as SortField[]).map((field) => (
                      <button
                        key={field}
                        onClick={() => handleSort(field)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          sortField === field
                            ? 'bg-slate-900 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800'
                        }`}
                      >
                        {capFirst(field)}
                        {sortField === field && <ArrowsUpDownIcon className="ml-1 h-3 w-3" />}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400">
                    Tap a sort to toggle direction.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Players List */}
        <div className="flex-1 overflow-hidden">
          {viewMode === 'lineup' ? (
            <div
              className="space-y-8 overflow-auto rounded-2xl border border-slate-900/70 bg-[#0B0F14] px-6 py-6 text-slate-100"
              style={{ maxHeight }}
            >
              <div className="mx-auto w-full max-w-6xl">
                <div className="sticky top-0 z-10 rounded-2xl border border-white/10 bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 px-5 py-3 text-white shadow-[0_20px_40px_rgba(2,6,23,0.6)] backdrop-blur">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.35em] text-white/50">
                        Team Lineup
                      </p>
                      <h3 className="mt-2 text-lg font-semibold">
                        {team.name || 'My Team'}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/60">
                      <span>Round 1</span>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">
                        Value ${(teamStats.totalValue / 1000000).toFixed(1)}M
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <section className="space-y-3">
                <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-900/80 bg-slate-900/40 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-lg font-semibold text-white">
                      Starting {LINEUP_CONFIG.starters}
                    </h4>
                    <div className="h-px flex-1 bg-slate-800/80" />
                    <p className="text-sm text-slate-400">Players currently scoring</p>
                  </div>
                  <div className="mt-5">
                    <svg
                      className="mx-auto block h-[720px] w-full max-w-7xl bg-black"
                      viewBox="0 0 1000 700"
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <defs>
                        <clipPath id="field-clip">
                          <ellipse cx="500" cy="350" rx="455" ry="300" />
                        </clipPath>
                      </defs>
                      <rect width="1000" height="700" fill="#000000" />
                      <ellipse
                        cx="500"
                        cy="350"
                        rx="455"
                        ry="300"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <rect
                        x="420"
                        y="270"
                        width="160"
                        height="160"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <circle cx="500" cy="350" r="30" fill="none" stroke="white" strokeWidth="2" />
                      <rect
                        x="55"
                        y="310"
                        width="80"
                        height="80"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <rect
                        x="865"
                        y="310"
                        width="80"
                        height="80"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <path
                        d="M120 150 C 300 40, 700 40, 880 150"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <path
                        d="M120 550 C 300 660, 700 660, 880 550"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                      />
                      <foreignObject x="0" y="0" width="1000" height="700" clipPath="url(#field-clip)">
                        <div className="relative h-full w-full">
                          {[
                            // Forwards (top third) - 2 rows x 3
                            { x: '28%', y: '16%' },
                            { x: '50%', y: '14%' },
                            { x: '72%', y: '16%' },
                            { x: '34%', y: '28%' },
                            { x: '50%', y: '26%' },
                            { x: '66%', y: '28%' },
                            // Midfielders (middle third) - 2 rows x 3
                            { x: '28%', y: '42%' },
                            { x: '50%', y: '40%' },
                            { x: '72%', y: '42%' },
                            { x: '34%', y: '56%' },
                            { x: '50%', y: '54%' },
                            { x: '66%', y: '56%' },
                            // Defenders (bottom third) - 2 rows x 3
                            { x: '28%', y: '70%' },
                            { x: '50%', y: '68%' },
                            { x: '72%', y: '70%' },
                            { x: '34%', y: '82%' },
                            { x: '50%', y: '80%' },
                            { x: '66%', y: '82%' },
                          ].map((pos, index) => {
                            const player = lineupSections.starters[index];
                            return (
                              <div
                                key={`starter-field-${index}`}
                                className="absolute w-[160px] -translate-x-1/2 -translate-y-1/2"
                                style={{ left: pos.x, top: pos.y }}
                              >
                                {renderPlayerSlot(player, player ? 'active' : 'empty')}
                              </div>
                            );
                          })}
                        </div>
                      </foreignObject>
                    </svg>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-900/80 bg-slate-900/30 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-lg font-semibold text-white">Interchange</h4>
                    <div className="h-px flex-1 bg-slate-800/80" />
                    <p className="text-sm text-slate-400">Bench rotation</p>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: LINEUP_CONFIG.interchange }).map((_, index) => {
                      const player = lineupSections.interchange[index];
                      return (
                        <div key={`bench-${index}`}>
                          {renderPlayerSlot(player, player ? 'bench' : 'empty')}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-900/80 bg-slate-900/20 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-lg font-semibold text-white">Emergency</h4>
                    <div className="h-px flex-1 bg-slate-800/80" />
                    <p className="text-sm text-slate-400">Lowest priority slots</p>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {Array.from({ length: LINEUP_CONFIG.emergency }).map((_, index) => {
                      const player = lineupSections.emergency[index];
                      return (
                        <div key={`emergency-${index}`}>
                          {renderPlayerSlot(player, player ? 'emergency' : 'empty')}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              {!readOnly && (
                <div className="sticky bottom-0 z-10 -mx-6 border-t border-slate-800/80 bg-[#0B0F14] px-6 py-3">
                  <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.25em] text-white/50">Actions</div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => onTeamAction?.('resetLineup')}
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/80 hover:border-white/40"
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => onTeamAction?.('autoFillLineup')}
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/80 hover:border-white/40"
                      >
                        Auto Fill
                      </button>
                      <button
                        onClick={() => onTeamAction?.('saveLineup')}
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/80 hover:border-white/40"
                      >
                        Save Team
                      </button>
                      <button
                        onClick={() => onTeamAction?.('confirmLineup')}
                        className="rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white shadow-[0_10px_24px_rgba(37,99,235,0.35)] hover:from-blue-500 hover:to-cyan-400"
                      >
                        Confirm Lineup
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : filteredAndSortedPlayers.length === 0 ? (
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
            <div className="overflow-auto" style={{ maxHeight }}>
              <div className="px-5 pb-1">
                <div
                  className={`grid ${
                    viewMode === 'stats'
                      ? statsGridCols
                      : 'grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_auto]'
                  } sticky top-0 z-10 gap-3 border-y border-slate-200 bg-slate-50 px-3 py-2 font-semibold uppercase text-slate-600 shadow-sm divide-x divide-slate-200 ${
                    viewMode === 'stats' ? 'text-[11px] tracking-[0.12em]' : 'text-[12px] tracking-[0.16em]'
                  }`}
                >
                  <button
                    onClick={() => setSortField('name')}
                    className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                  >
                    Player
                  </button>
                  {viewMode === 'stats' ? (
                    <>
                      <button
                        onClick={() => setSortField('team')}
                        className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                      >
                        Team
                      </button>
                      <button
                        onClick={() => setSortField('position')}
                        className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                      >
                        Pos
                      </button>
                      {STAT_COLUMNS.map((col) => (
                        <button
                          key={col.key}
                          onClick={() => handleStatSort(col.key)}
                          className={`text-left whitespace-nowrap hover:text-slate-900 ${
                            statSortKey === col.key ? 'text-slate-900' : 'text-slate-700'
                          }`}
                        >
                          {col.label}
                        </button>
                      ))}
                      <button
                        onClick={() => setSortField('ownership')}
                        className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                      >
                        Own
                      </button>
                      <span className="text-right whitespace-nowrap text-slate-700">Actions</span>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setSortField('totalValue')}
                        className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                      >
                        Value
                      </button>
                      <button
                        onClick={() => setSortField('team')}
                        className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                      >
                        Team
                      </button>
                      <button
                        onClick={() => setSortField('position')}
                        className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                      >
                        Pos
                      </button>
                      <button
                        onClick={() => setSortField('ownership')}
                        className="text-left whitespace-nowrap text-slate-700 hover:text-slate-900"
                      >
                        Own
                      </button>
                      <span className="text-right whitespace-nowrap text-slate-700">Actions</span>
                    </>
                  )}
                </div>
              </div>
              <ul className={`space-y-1 px-5 pb-5 ${compact ? 'text-xs' : 'text-sm'}`}>
                <AnimatePresence>
                  {filteredAndSortedPlayers.map((player, index) => (
                    <motion.li
                      key={player.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: index * 0.05 }}
                      className={`rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-slate-300 hover:bg-slate-50 ${
                        selectedPlayer?.id === player.id ? 'border-slate-900/20 bg-slate-50' : ''
                      }`}
                      onClick={() => handlePlayerClick(player)}
                    >
                      <div
                        className={`grid ${
                          viewMode === 'stats'
                            ? statsGridCols
                            : 'grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,1.4fr)]'
                        } items-center gap-3`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{capWords(player.name)}</span>
                          {getPerformanceIcon(player)}
                          {player.injury && (
                            <div className="tooltip tooltip-error" data-tip={player.injury}>
                              <InformationCircleIcon className="w-4 h-4 text-error" />
                            </div>
                          )}
                        </div>

                        {viewMode === 'stats' ? (
                          <>
                            <div className="text-base-content/70 truncate">
                              <span title={player.team ? capWords(player.team) : undefined}>
                                {formatTeam(player.team)}
                              </span>
                            </div>
                            <div>
                              {player.position ? (
                                <span
                                  className={`badge badge-xs ${getPositionColor(player.position)}`}
                                >
                                  {capFirst(player.position)}
                                </span>
                              ) : (
                                <span className="text-base-content/40">—</span>
                              )}
                            </div>
                            {STAT_COLUMNS.map((col) => (
                              <div key={col.key} className="text-base-content/70 tabular-nums">
                                {col.accessor(player) || 0}
                              </div>
                            ))}
                            <div className="text-base-content/70">
                              {typeof player.ownership === 'number' ? `${player.ownership}%` : '—'}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-xs">
                              <ValueChip playerId={String(player.id)} compact={compact} />
                            </div>
                            <div className="text-base-content/70 truncate">
                              <span title={player.team ? capWords(player.team) : undefined}>
                                {formatTeam(player.team)}
                              </span>
                            </div>
                            <div>
                              {player.position ? (
                                <span
                                  className={`badge badge-xs ${getPositionColor(player.position)}`}
                                >
                                  {capFirst(player.position)}
                                </span>
                              ) : (
                                <span className="text-base-content/40">—</span>
                              )}
                            </div>
                            <div className="text-base-content/70">
                              {typeof player.ownership === 'number' ? `${player.ownership}%` : '—'}
                            </div>
                          </>
                        )}

                        {showAdvancedFeatures && !readOnly && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onTeamAction?.('view', player);
                              }}
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                            >
                              View
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onTeamAction?.('captain', player);
                              }}
                              className="rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 hover:border-emerald-300 hover:text-emerald-800"
                            >
                              Captain
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onTeamAction?.('bench', player);
                              }}
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                            >
                              Bench
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onTeamAction?.('trade', player);
                              }}
                              className="rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 hover:border-amber-300 hover:text-amber-800"
                            >
                              Trade
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {showAdvancedFeatures && !readOnly && draftedPlayers.length > 0 && (
          <div className="border-t border-slate-200 bg-white px-6 py-4">
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={() => onTeamAction?.('optimize')}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500"
              >
                <FireIcon className="h-4 w-4" />
                Optimize
              </button>
              <button
                onClick={() => onTeamAction?.('trade')}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800"
              >
                <ArrowsUpDownIcon className="h-4 w-4" />
                Trade
              </button>
              <button
                onClick={() => onTeamAction?.('analyze')}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:text-slate-900"
              >
                <ChartBarIcon className="h-4 w-4" />
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
