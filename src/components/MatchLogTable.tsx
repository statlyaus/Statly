'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronUpIcon,
  ChevronDownIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  ChartBarIcon,
  EyeIcon,
  CalendarIcon,
  XMarkIcon,
  InformationCircleIcon,
  ArrowsUpDownIcon,
} from '@heroicons/react/24/outline';
import type { MatchLog } from '@/types/matchLogs';
import { getTeamAbbreviation, getTeamLogo } from '@/lib/teamLogos';

type SortDirection = 'asc' | 'desc';
type SortField = keyof MatchLog;
type QuickFilter = 'all' | 'withValue' | 'categoryData' | 'zeroValue';

interface MatchLogTableProps {
  matchLogs: MatchLog[];
  playerName?: string;
  isLoading?: boolean;
  onRefresh?: () => void;
  onMatchSelect?: (matchLog: MatchLog) => void;
  className?: string;
  showAdvancedStats?: boolean;
  compact?: boolean;
}

interface FilterState {
  searchTerm: string;
  minStatlyValue: string;
  maxStatlyValue: string;
  result: 'all' | 'W' | 'L' | 'D';
  minRound: string;
  maxRound: string;
}

const OpponentCell = ({ opponent }: { opponent: string }) => {
  const logo = getTeamLogo(opponent);
  const abbreviation = getTeamAbbreviation(opponent);

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background p-1 shadow-sm">
        <Image
          src={logo}
          alt=""
          aria-hidden="true"
          width={24}
          height={24}
          className="h-6 w-6 object-contain"
          unoptimized={logo.endsWith('.svg')}
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-foreground">{opponent}</span>
        <span className="block text-xs font-medium uppercase text-muted-foreground">{abbreviation}</span>
      </span>
    </div>
  );
};

const MatchLogTable = ({
  matchLogs,
  playerName,
  isLoading = false,
  onRefresh,
  onMatchSelect,
  className = '',
  showAdvancedStats = false,
  compact = false,
}: MatchLogTableProps) => {
  const [sortField, setSortField] = useState<SortField>('season');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<MatchLog | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filters, setFilters] = useState<FilterState>({
    searchTerm: '',
    minStatlyValue: '',
    maxStatlyValue: '',
    result: 'all',
    minRound: '',
    maxRound: '',
  });

  // Calculate statistics
  const stats = useMemo(() => {
    if (!matchLogs || matchLogs.length === 0) return null;

    const statlyValues = matchLogs
      .map((log) => log.totalValue)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const goals = matchLogs.map((log) => log.goals || 0);
    const disposals = matchLogs.map((log) => log.disposals || 0);
    const tackles = matchLogs.map((log) => log.tackles || 0);
    const clearances = matchLogs.map((log) => log.clearances || 0);

    return {
      totalMatches: matchLogs.length,
      avgStatlyValue:
        statlyValues.length > 0
          ? statlyValues.reduce((a, b) => a + b, 0) / statlyValues.length
          : null,
      bestStatlyValue: statlyValues.length > 0 ? Math.max(...statlyValues) : null,
      totalGoals: goals.reduce((a, b) => a + b, 0),
      avgGoals: (goals.reduce((a, b) => a + b, 0) / matchLogs.length).toFixed(1),
      avgDisposals: Math.round(disposals.reduce((a, b) => a + b, 0) / matchLogs.length),
      avgTackles: (tackles.reduce((a, b) => a + b, 0) / matchLogs.length).toFixed(1),
      avgClearances: (clearances.reduce((a, b) => a + b, 0) / matchLogs.length).toFixed(1),
      wins: matchLogs.filter((log) => log.result === 'W').length,
      losses: matchLogs.filter((log) => log.result === 'L').length,
      draws: matchLogs.filter((log) => log.result === 'D').length,
    };
  }, [matchLogs]);

  const quickFilterCounts = useMemo<Record<QuickFilter, number>>(() => {
    const hasCategoryData = (log: MatchLog) =>
      [log.goals, log.disposals, log.marks, log.tackles, log.clearances, log.inside50s, log.rebound50s, log.hitouts].some(
        (value) => typeof value === 'number' && value > 0
      );

    return {
      all: matchLogs.length,
      withValue: matchLogs.filter((log) => typeof log.totalValue === 'number' && log.totalValue > 0).length,
      categoryData: matchLogs.filter(hasCategoryData).length,
      zeroValue: matchLogs.filter((log) => !log.totalValue).length,
    };
  }, [matchLogs]);

  // Filter and sort data
  const filteredAndSortedLogs = useMemo(() => {
    let filtered = [...matchLogs];

    // Apply filters
    if (filters.searchTerm) {
      const normalizedSearch = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (log) =>
          log.opponent.toLowerCase().includes(normalizedSearch) ||
          log.venue?.toLowerCase().includes(normalizedSearch) ||
          String(log.season ?? '').includes(normalizedSearch) ||
          String(log.round ?? '').includes(normalizedSearch)
      );
    }

    if (filters.minStatlyValue) {
      filtered = filtered.filter(
        (log) => (log.totalValue || 0) >= Number(filters.minStatlyValue)
      );
    }

    if (filters.maxStatlyValue) {
      filtered = filtered.filter(
        (log) => (log.totalValue || 0) <= Number(filters.maxStatlyValue)
      );
    }

    if (filters.result !== 'all') {
      filtered = filtered.filter((log) => log.result === filters.result);
    }

    if (filters.minRound) {
      filtered = filtered.filter((log) => log.round >= parseInt(filters.minRound));
    }

    if (filters.maxRound) {
      filtered = filtered.filter((log) => log.round <= parseInt(filters.maxRound));
    }

    if (quickFilter === 'withValue') {
      filtered = filtered.filter((log) => typeof log.totalValue === 'number' && log.totalValue > 0);
    } else if (quickFilter === 'categoryData') {
      filtered = filtered.filter((log) =>
        [log.goals, log.disposals, log.marks, log.tackles, log.clearances, log.inside50s, log.rebound50s, log.hitouts].some(
          (value) => typeof value === 'number' && value > 0
        )
      );
    } else if (quickFilter === 'zeroValue') {
      filtered = filtered.filter((log) => !log.totalValue);
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
      const seasonDelta = (a.season ?? 0) - (b.season ?? 0);
      if (seasonDelta !== 0) return sortDirection === 'asc' ? seasonDelta : -seasonDelta;
      const roundDelta = (a.round ?? 0) - (b.round ?? 0);
      if (roundDelta !== 0) return sortDirection === 'asc' ? roundDelta : -roundDelta;
      return a.opponent.localeCompare(b.opponent);
    });

    return filtered;
  }, [matchLogs, filters, quickFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setQuickFilter('all');
    setFilters({
      searchTerm: '',
      minStatlyValue: '',
      maxStatlyValue: '',
      result: 'all',
      minRound: '',
      maxRound: '',
    });
  };

  const activeFilterCount = [
    quickFilter !== 'all' ? quickFilter : '',
    filters.searchTerm,
    filters.minStatlyValue,
    filters.maxStatlyValue,
    filters.minRound,
    filters.maxRound,
    filters.result !== 'all' ? filters.result : '',
  ].filter(Boolean).length;

  const sortOptions: Array<{ field: SortField; label: string }> = [
    { field: 'season', label: 'Season' },
    { field: 'round', label: 'Round' },
    { field: 'opponent', label: 'Opponent' },
    { field: 'totalValue', label: 'Statly Value' },
    { field: 'disposals', label: 'Disposals' },
    { field: 'marks', label: 'Marks' },
    { field: 'tackles', label: 'Tackles' },
    { field: 'clearances', label: 'Clearances' },
  ];
  const quickFilterLabels: Record<QuickFilter, string> = {
    all: 'All',
    withValue: 'Value',
    categoryData: 'Categories',
    zeroValue: 'Zero',
  };

  const getValueColor = (value: number | undefined, averageValue: number | null) => {
    if (typeof value !== 'number' || averageValue === null) return 'text-muted-foreground';
    if (value >= averageValue + 0.35) return 'text-emerald-700 font-semibold';
    if (value >= averageValue - 0.35) return 'text-foreground';
    return 'text-amber-700';
  };

  const formatVenue = (venue: string | undefined): string => {
    const value = venue?.trim();
    return value ? value : 'Venue unavailable';
  };

  const formatRound = (round: number | undefined): string => {
    return typeof round === 'number' && Number.isFinite(round) && round > 0 ? String(round) : 'TBC';
  };

  const formatNumberCell = (value: number | undefined): string => {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
  };

  const getResultBadge = (result: string | undefined) => {
    switch (result) {
      case 'W':
        return <span className="badge badge-success badge-sm">W</span>;
      case 'L':
        return <span className="badge badge-error badge-sm">L</span>;
      case 'D':
        return <span className="badge badge-warning badge-sm">D</span>;
      default:
        return <span className="badge badge-ghost badge-sm">-</span>;
    }
  };

  const SortButton = ({
    field,
    children,
    align = 'left',
  }: {
    field: SortField;
    children: React.ReactNode;
    align?: 'left' | 'center' | 'right';
  }) => (
    <button
      onClick={() => handleSort(field)}
      className={`flex w-full items-center gap-1 font-medium transition-colors duration-200 hover:text-primary ${
        align === 'right'
          ? 'justify-end text-right'
          : align === 'center'
            ? 'justify-center text-center'
            : 'justify-start text-left'
      }`}
      aria-label={`Sort by ${field}`}
    >
      {children}
      {sortField === field && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.2 }}>
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
      <div className={`rounded-lg border border-border bg-card shadow-sm ${className}`}>
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <ArrowPathIcon className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading match logs...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!matchLogs || matchLogs.length === 0) {
    return (
      <div className={`rounded-lg border border-border bg-card p-5 shadow-sm ${className}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">Match Logs</h2>
            <p className="mt-1 text-sm text-muted-foreground">Round-by-round AFL category records</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-dashed border-border bg-muted/30 p-6">
          <ChartBarIcon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h3 className="mt-4 text-base font-semibold text-card-foreground">
            No match data available
          </h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {playerName
              ? `No match logs were returned for ${playerName}.`
              : 'No match logs were returned for this player.'}
          </p>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
              Refresh Data
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-w-0 space-y-3 ${className}`}>
      {/* Controls */}
      <div className="min-w-0 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">
                {playerName ? `${playerName}'s Match Logs` : 'Match Logs'}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {filteredAndSortedLogs.length} matches
                </div>
                {activeFilterCount > 0 ? (
                  <div className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  showFilters
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                }`}
              >
                <FunnelIcon className="h-4 w-4" />
                Filters
              </button>
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  Refresh
                </button>
              )}
            </div>
          </div>

          <div className="mb-4 border-t border-border pt-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative min-w-0 flex-1">
                <label htmlFor="match-log-search" className="sr-only">
                  Search match logs
                </label>
                <MagnifyingGlassIcon
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  id="match-log-search"
                  type="search"
                  placeholder="Search season, round, opponent, or ground"
                  value={filters.searchTerm}
                  onChange={(event) => handleFilterChange('searchTerm', event.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="match-log-sort-field" className="sr-only">
                  Sort match logs
                </label>
                <select
                  id="match-log-sort-field"
                  value={sortField}
                  onChange={(event) => {
                    setSortField(event.target.value as SortField);
                    setSortDirection('desc');
                  }}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                >
                  {sortOptions.map((option) => (
                    <option key={option.field} value={option.field}>
                      Sort by {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-2"
                  aria-label={`Sort ${sortDirection === 'desc' ? 'low to high' : 'high to low'}`}
                >
                  <ArrowsUpDownIcon className="h-4 w-4" aria-hidden="true" />
                  {sortDirection === 'desc' ? 'High first' : 'Low first'}
                </button>
                {(Object.keys(quickFilterLabels) as QuickFilter[]).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setQuickFilter(filter)}
                    className={`rounded-md border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                      quickFilter === filter
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border bg-background text-foreground hover:bg-muted'
                    }`}
                  >
                    {quickFilterLabels[filter]}
                    <span
                      className={
                        quickFilter === filter
                          ? 'ml-2 text-primary-foreground/80'
                          : 'ml-2 text-muted-foreground'
                      }
                    >
                      {quickFilterCounts[filter]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Sorted by {sortOptions.find((option) => option.field === sortField)?.label ?? 'Round'}{' '}
              {sortDirection === 'desc' ? 'high to low' : 'low to high'}.
            </div>
          </div>

          {/* Filters */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 border-t border-border pt-4"
              >
                <div className="grid grid-cols-[minmax(180px,1fr)_140px_auto] items-end gap-3">
                  <div className="form-control">
                    <label
                      htmlFor="min-points-input"
                      className="mb-1 block text-xs font-semibold text-muted-foreground"
                    >
                      Statly Value
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="min-points-input"
                        type="number"
                        placeholder="Min"
                        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring"
                        value={filters.minStatlyValue}
                        onChange={(e) => handleFilterChange('minStatlyValue', e.target.value)}
                      />
                      <input
                        id="max-points-input"
                        type="number"
                        placeholder="Max"
                        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring"
                        value={filters.maxStatlyValue}
                        onChange={(e) => handleFilterChange('maxStatlyValue', e.target.value)}
                        aria-label="Maximum Statly value"
                      />
                    </div>
                  </div>

                  <div className="form-control">
                    <label
                      htmlFor="result-select"
                      className="mb-1 block text-xs font-semibold text-muted-foreground"
                    >
                      Result
                    </label>
                    <select
                      id="result-select"
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring"
                      value={filters.result}
                      onChange={(e) => handleFilterChange('result', e.target.value)}
                    >
                      <option value="all">All Results</option>
                      <option value="W">Wins</option>
                      <option value="L">Losses</option>
                      <option value="D">Draws</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      onClick={clearFilters}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <XMarkIcon className="h-4 w-4" />
                      Clear Filters
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Table */}
          <div className="max-h-[680px] max-w-full overflow-auto rounded-md border border-border">
            <table
              className="w-full table-fixed border-separate border-spacing-0 text-left text-sm"
              style={{ minWidth: compact ? 980 : 1240 }}
              aria-label={`${playerName ?? 'Player'} match logs table`}
              aria-rowcount={filteredAndSortedLogs.length + 1}
            >
              <colgroup>
                <col className="w-20" />
                <col className="w-20" />
                <col className="w-[260px]" />
                <col className="w-[180px]" />
                {!compact && <col className="w-20" />}
                {!compact && <col className="w-20" />}
                <col className="w-16" />
                <col className="w-16" />
                <col className="w-16" />
                <col className="w-16" />
                {!compact && <col className="w-16" />}
                {!compact && <col className="w-16" />}
                {!compact && <col className="w-16" />}
                <col className="w-24" />
                {!compact && <col className="w-24" />}
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 text-sm font-medium text-muted-foreground backdrop-blur">
                <tr className="text-xs font-semibold uppercase text-muted-foreground">
                  <th className="border-b border-border px-3 py-3 text-left">
                    <SortButton field="season">Season</SortButton>
                  </th>
                  <th className="border-b border-border px-3 py-3 text-left">
                    <SortButton field="round">Round</SortButton>
                  </th>
                  <th className="border-b border-border px-3 py-3 text-left">
                    <SortButton field="opponent">Opponent</SortButton>
                  </th>
                  <th className="border-b border-border px-3 py-3 text-left">Ground</th>
                  {!compact && <th className="border-b border-border px-3 py-3 text-center">Result</th>}
                  {!compact && (
                    <th className="border-b border-border px-3 py-3 text-center">
                      <SortButton field="goals" align="center">Goals</SortButton>
                    </th>
                  )}
                  <th className="border-b border-border px-3 py-3 text-center">
                    <SortButton field="disposals" align="center">D</SortButton>
                  </th>
                  <th className="border-b border-border px-3 py-3 text-center">
                    <SortButton field="marks" align="center">M</SortButton>
                  </th>
                  <th className="border-b border-border px-3 py-3 text-center">
                    <SortButton field="tackles" align="center">T</SortButton>
                  </th>
                  <th className="border-b border-border px-3 py-3 text-center">
                    <SortButton field="clearances" align="center">CLR</SortButton>
                  </th>
                  {!compact && (
                    <>
                      <th className="border-b border-border px-3 py-3 text-center">
                        <SortButton field="inside50s" align="center">I50</SortButton>
                      </th>
                      <th className="border-b border-border px-3 py-3 text-center">
                        <SortButton field="rebound50s" align="center">R50</SortButton>
                      </th>
                      <th className="border-b border-border px-3 py-3 text-center">
                        <SortButton field="hitouts" align="center">HO</SortButton>
                      </th>
                    </>
                  )}
                  <th className="border-b border-border px-3 py-3 text-right">
                    <SortButton field="totalValue" align="right">Value</SortButton>
                  </th>
                  {showAdvancedStats && !compact && (
                    <>
                      <th className="border-b border-border px-2 py-2 text-right">
                        <SortButton field="superCoachScore" align="right">SC Score</SortButton>
                      </th>
                      <th className="border-b border-border px-2 py-2 text-right">
                        <SortButton field="dreamTeamScore" align="right">DT Score</SortButton>
                      </th>
                      <th className="border-b border-border px-2 py-2 text-center">TOG%</th>
                    </>
                  )}
                  {!compact && <th className="border-b border-border px-3 py-3 text-center">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                <AnimatePresence>
                  {filteredAndSortedLogs.map((log, index) => (
                    <motion.tr
                      key={`${log.round}-${log.opponent}-${log.matchDate ?? 'no-date'}-${index}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ delay: index * 0.05 }}
                      className="cursor-pointer transition-colors duration-200 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      tabIndex={0}
                      aria-label={`${log.season ?? 'Unknown season'} round ${formatRound(log.round)} versus ${log.opponent} at ${formatVenue(log.venue)}. Press Enter to review.`}
                      aria-rowindex={index + 2}
                      onClick={() => {
                        setSelectedMatch(log);
                        onMatchSelect?.(log);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedMatch(log);
                          onMatchSelect?.(log);
                        }
                      }}
                    >
                      <td className="px-3 py-3 font-semibold text-foreground tabular-nums">{log.season ?? '—'}</td>
                      <td className="px-3 py-3 font-semibold text-foreground tabular-nums">{formatRound(log.round)}</td>
                      <td className="px-3 py-3">
                        <OpponentCell opponent={log.opponent} />
                      </td>
                      <td className="px-3 py-3 text-sm text-muted-foreground">
                        <span className="block truncate">{formatVenue(log.venue)}</span>
                      </td>
                      {!compact && <td className="px-3 py-3 text-center">{getResultBadge(log.result)}</td>}
                      {!compact && <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.goals)}</td>}
                      <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.disposals)}</td>
                      <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.marks)}</td>
                      <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.tackles)}</td>
                      <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.clearances)}</td>
                      {!compact && (
                        <>
                          <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.inside50s)}</td>
                          <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.rebound50s)}</td>
                          <td className="px-3 py-3 text-center font-medium tabular-nums">{formatNumberCell(log.hitouts)}</td>
                        </>
                      )}
                      <td
                        className={`px-3 py-3 text-right font-semibold tabular-nums ${
                          stats
                            ? getValueColor(log.totalValue, stats.avgStatlyValue)
                            : ''
                        }`}
                      >
                        {typeof log.totalValue === 'number' ? log.totalValue.toFixed(2) : '-'}
                      </td>
                      {showAdvancedStats && !compact && (
                        <>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">{log.superCoachScore ?? '—'}</td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">{log.dreamTeamScore ?? '—'}</td>
                          <td className="px-3 py-3 text-center font-medium tabular-nums">
                            {log.timeOnGround ? `${log.timeOnGround}%` : '-'}
                          </td>
                        </>
                      )}
                      {!compact && (
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMatch(log);
                            }}
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="View match details"
                          >
                            <EyeIcon className="h-3.5 w-3.5" />
                            View
                          </button>
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {filteredAndSortedLogs.length === 0 && (
            <div className="py-8 text-center">
              <InformationCircleIcon className="mx-auto mb-2 h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No matches found with current filters</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-3 rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
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
                {selectedMatch.season ? `${selectedMatch.season} ` : ''}Round {formatRound(selectedMatch.round)} vs {selectedMatch.opponent}
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
                <div className="stat-title">Statly Value</div>
                <div className="stat-value text-primary">
                  {typeof selectedMatch.totalValue === 'number'
                    ? selectedMatch.totalValue.toFixed(2)
                    : '-'}
                </div>
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
                  {!selectedMatch.venue && (
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-base-content/60" />
                      <span>Venue unavailable</span>
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
