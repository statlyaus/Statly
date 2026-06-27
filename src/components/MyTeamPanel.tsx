'use client';

import { useState, useMemo, useCallback } from 'react';
import Image from 'next/image';
import type { Player, Team } from '../types/players';
import { useRankings } from '@/hooks/useRankings';
import { getTeamAbbreviation, getTeamLogo } from '@/lib/teamLogos';
import {
  FANTASY_CATEGORIES,
  type FantasyCategory,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import {
  UserIcon,
  TrophyIcon,
  ChartBarIcon,
  ArrowsUpDownIcon,
  MagnifyingGlassIcon,
  FireIcon,
  UserPlusIcon,
  ArrowPathIcon,
  InformationCircleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { ArrowLeftRight, Crown, Eye } from 'lucide-react';

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
  /** Optional: league-selected scoring categories to show as per-game averages */
  selectedCategories?: FantasyCategoryKey[];
  className?: string;
};

type SortField = 'name' | 'position' | 'team' | 'totalValue' | 'recent';
type FilterType = 'all' | 'starters' | 'bench' | 'captain' | 'injury';

interface TeamStats {
  totalPlayers: number;
  totalValue: number;
  avgValue: number;
  averageScore: number;
  projectedScore: number;
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
  rank?: number;
  totalValue?: number;
  valueOverReplacement?: number;
  price?: number;
  averageScore?: number;
  lastGameScore?: number;
  projectedScore?: number;
  form?: number;
}

type RankingEntry = {
  id: string | number;
  rank?: number;
  totalValue?: number;
  valueOverReplacement?: number;
};

type SortDirection = 'asc' | 'desc';

function capWords(str = '') {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function capFirst(str = '') {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
}

const rosterTarget = 22;
const filterTypes: FilterType[] = ['all', 'starters', 'bench', 'captain', 'injury'];
const sortControlFields: Array<[SortField, string]> = [
  ['totalValue', 'Statly Z'],
  ['recent', 'Form'],
  ['name', 'Name'],
  ['position', 'Position'],
  ['team', 'Club'],
];
const activeSortLabel = {
  name: 'Name',
  position: 'Position',
  team: 'Club',
  totalValue: 'Statly Z',
  recent: 'Form',
} satisfies Record<SortField, string>;
const positionOrder = ['RUC', 'MID', 'DEF', 'FWD'];
const ROSTER_PLAYER_COLUMN_WIDTH = 340;
const ROSTER_PROFILE_COLUMN_WIDTH = 180;
const ROSTER_STAT_COLUMN_WIDTH = 88;
const ROSTER_ACTIONS_COLUMN_WIDTH = 236;
const ROSTER_ACTION_BUTTON_BASE_CLASS =
  'inline-flex h-10 w-full items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const ROSTER_ACTION_BUTTON_OUTLINE_CLASS =
  'border border-input bg-background text-foreground hover:bg-muted';
const ROSTER_ACTION_BUTTON_PRIMARY_CLASS =
  'border border-border bg-accent text-accent-foreground hover:bg-accent/80';

function getSafeRankings(rankings: unknown): RankingEntry[] {
  return Array.isArray(rankings) ? rankings : [];
}

function formatMetric(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function getPositionColor(position: string) {
  const colors = {
    DEF: 'text-blue-600 bg-blue-50',
    MID: 'text-green-600 bg-green-50',
    FWD: 'text-red-600 bg-red-50',
    RUC: 'text-purple-600 bg-purple-50',
  };
  return colors[position as keyof typeof colors] || 'text-gray-600 bg-gray-50';
}

function getRosterSlotById(players: Player[]) {
  return new Map(players.map((player, index) => [String(player.id), index]));
}

function getPositionBreakdownEntries(positionBreakdown: Record<string, number>) {
  return Object.entries(positionBreakdown).sort(([a], [b]) => {
    const aIndex = positionOrder.indexOf(a);
    const bIndex = positionOrder.indexOf(b);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
}

function isCaptainRole(player: Player) {
  const extPlayer = player as ExtendedPlayer;
  return extPlayer.isCaptain || extPlayer.isViceCaptain;
}

function getFilterCounts(players: Player[]): Record<FilterType, number> {
  return {
    all: players.length,
    starters: players.slice(0, 18).length,
    bench: players.slice(18).length,
    captain: players.filter(isCaptainRole).length,
    injury: players.filter((player) => player.injury).length,
  };
}

function filterByRosterRole(players: Player[], filterType: FilterType): Player[] {
  switch (filterType) {
    case 'starters':
      return players.slice(0, 18);
    case 'bench':
      return players.slice(18);
    case 'captain':
      return players.filter(isCaptainRole);
    case 'injury':
      return players.filter((player) => player.injury);
    default:
      return players;
  }
}

function playerMatchesSearch(player: Player, searchTerm: string) {
  const normalized = searchTerm.toLowerCase();
  return (
    player.name.toLowerCase().includes(normalized) ||
    (player.team && player.team.toLowerCase().includes(normalized)) ||
    (player.position && player.position.toLowerCase().includes(normalized))
  );
}

function readPlayerScore(player: Player, key: 'averageScore' | 'projectedScore' | 'form') {
  const value = (player as ExtendedPlayer)[key] ?? (key === 'averageScore' ? player.avg : undefined);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeCategoryColumns(
  selectedCategories: readonly FantasyCategoryKey[]
): FantasyCategoryKey[] {
  const seen = new Set<FantasyCategoryKey>();

  return selectedCategories.filter((category) => {
    if (!FANTASY_CATEGORIES[category] || seen.has(category)) return false;
    seen.add(category);
    return true;
  });
}

function readCategoryAverage(player: Player, category: FantasyCategoryKey): number | null {
  const statValue = player.stats?.[category];
  if (typeof statValue === 'number' && Number.isFinite(statValue)) return statValue;
  if (typeof statValue === 'string' && statValue.trim()) {
    const parsed = Number.parseFloat(statValue);
    if (Number.isFinite(parsed)) return parsed;
  }

  const playerValue = (player as unknown as Record<string, unknown>)[category];
  return typeof playerValue === 'number' && Number.isFinite(playerValue) ? playerValue : null;
}

function formatCategoryAverage(value: number | null, category: FantasyCategory): string {
  if (value === null) return '—';

  switch (category.format) {
    case 'percentage':
      return `${value.toFixed(1)}%`;
    case 'decimal':
      return value.toFixed(2);
    case 'number':
    default:
      return value.toFixed(1);
  }
}

function getPlayerStatlyZ(player: Player, ranking?: RankingEntry): number | null {
  const extPlayer = player as ExtendedPlayer;
  const value =
    ranking?.totalValue ??
    ranking?.valueOverReplacement ??
    extPlayer.totalValue ??
    extPlayer.valueOverReplacement;

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function calculateTeamStats(
  draftedPlayers: Player[],
  rankingById: Map<string, RankingEntry>
): TeamStats {
  const positionBreakdown: Record<string, number> = {};
  const statlyZValues: number[] = [];
  const averageScores: number[] = [];
  const projectedScores: number[] = [];
  let captainSet = false;
  let viceCaptainSet = false;

  draftedPlayers.forEach((player) => {
    const extPlayer = player as ExtendedPlayer;
    const position = player.position || 'UNK';
    positionBreakdown[position] = (positionBreakdown[position] || 0) + 1;

    const statlyZ = getPlayerStatlyZ(player, rankingById.get(String(player.id)));
    if (statlyZ !== null) statlyZValues.push(statlyZ);

    const averageScore = readPlayerScore(player, 'averageScore');
    if (averageScore !== null) averageScores.push(averageScore);

    const projectedScore = readPlayerScore(player, 'projectedScore');
    if (projectedScore !== null) projectedScores.push(projectedScore);

    if (extPlayer.isCaptain) captainSet = true;
    if (extPlayer.isViceCaptain) viceCaptainSet = true;
  });

  const totalValue = statlyZValues.reduce((sum, value) => sum + value, 0);
  const sumAverage = averageScores.reduce((sum, value) => sum + value, 0);
  const sumProjected = projectedScores.reduce((sum, value) => sum + value, 0);

  return {
    totalPlayers: draftedPlayers.length,
    totalValue,
    avgValue: statlyZValues.length > 0 ? totalValue / statlyZValues.length : 0,
    averageScore: averageScores.length > 0 ? sumAverage / averageScores.length : 0,
    projectedScore: projectedScores.length > 0 ? sumProjected / projectedScores.length : 0,
    positionBreakdown,
    captainSet,
    viceCaptainSet,
    rosterComplete: draftedPlayers.length >= rosterTarget,
  };
}

function getSortValue(player: Player, field: SortField, rankingById: Map<string, RankingEntry>) {
  switch (field) {
    case 'name':
      return player.name.toLowerCase();
    case 'position':
      return player.position || 'ZZZ';
    case 'team':
      return player.team || 'ZZZ';
    case 'totalValue':
      return getPlayerStatlyZ(player, rankingById.get(String(player.id))) ?? -Infinity;
    case 'recent':
      return readPlayerScore(player, 'form') ?? (player as ExtendedPlayer).recentForm ?? 0;
  }
}

function sortPlayers(
  players: Player[],
  sortField: SortField,
  sortDirection: SortDirection,
  rankingById: Map<string, RankingEntry>
) {
  return [...players].sort((a, b) => {
    const aVal = getSortValue(a, sortField, rankingById);
    const bVal = getSortValue(b, sortField, rankingById);

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

function getFilteredAndSortedPlayers(params: {
  players: Player[];
  searchTerm: string;
  filterType: FilterType;
  sortField: SortField;
  sortDirection: SortDirection;
  rankingById: Map<string, RankingEntry>;
}) {
  const searched = params.searchTerm
    ? params.players.filter((player) => playerMatchesSearch(player, params.searchTerm))
    : params.players;
  const filtered = filterByRosterRole(searched, params.filterType);
  return sortPlayers(filtered, params.sortField, params.sortDirection, params.rankingById);
}

function EmptyTeamState({
  className,
  onTeamAction,
}: Pick<MyTeamPanelProps, 'className' | 'onTeamAction'>) {
  return (
    <section aria-labelledby="team-heading" className={className}>
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <UserIcon className="mx-auto mb-3 h-12 w-12 text-slate-300" />
        <h2 id="team-heading" className="mb-2 text-lg font-semibold text-slate-950">
          No Team Selected
        </h2>
        <p className="mb-4 text-sm text-slate-600">
          Join a league or create a team to get started.
        </p>
        <button
          type="button"
          onClick={() => onTeamAction?.('create')}
          className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          Create Team
        </button>
      </div>
    </section>
  );
}

function EmptyRosterState({
  hasDraftedPlayers,
  onClearFilters,
  onTeamAction,
}: {
  hasDraftedPlayers: boolean;
  onClearFilters: () => void;
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      {!hasDraftedPlayers ? (
        <>
          <UserPlusIcon className="mb-3 h-12 w-12 text-slate-300" aria-hidden="true" />
          <p className="mb-4 text-sm text-slate-600">No players drafted yet.</p>
          <button
            type="button"
            onClick={() => onTeamAction?.('draft')}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            Start Drafting
          </button>
        </>
      ) : (
        <>
          <InformationCircleIcon className="mb-2 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="text-sm text-slate-600">No players match your filters.</p>
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            Clear Filters
          </button>
        </>
      )}
    </div>
  );
}

function PlayerRoleBadges({ player }: { player: Player }) {
  const extPlayer = player as ExtendedPlayer;
  return (
    <>
      {extPlayer.isCaptain && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">C</span>
      )}
      {extPlayer.isViceCaptain && (
        <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800">VC</span>
      )}
    </>
  );
}

function TeamPanelHeader({
  teamName,
  compact,
  rosterComplete,
  openSlots,
  isLoading,
  showAdvancedFeatures,
  onTeamAction,
  onRefresh,
}: {
  teamName: string;
  compact: boolean;
  rosterComplete: boolean;
  openSlots: number;
  isLoading: boolean;
  showAdvancedFeatures: boolean;
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-blue-200 bg-blue-50">
            <TrophyIcon className="h-5 w-5 text-blue-600" aria-hidden="true" />
          </span>
          <div>
            <h2 id="team-heading" className={`${compact ? 'text-base' : 'text-xl'} font-semibold text-slate-950`}>
              {teamName}
            </h2>
            <p className="text-sm text-slate-600">
              {rosterComplete ? 'Completed roster review' : `${openSlots} open roster ${openSlots === 1 ? 'slot' : 'slots'}`}
            </p>
          </div>
          {isLoading && (
            <span className="ml-1 h-2.5 w-2.5 rounded-full bg-blue-500" aria-label="Loading team data" />
          )}
        </div>
      </div>

      {showAdvancedFeatures && (
        <TeamPanelActions onTeamAction={onTeamAction} onRefresh={onRefresh} />
      )}
    </div>
  );
}

function TeamPanelActions({
  onTeamAction,
  onRefresh,
}: {
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onTeamAction?.('optimize')}
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
      >
        <FireIcon className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        Optimize
      </button>
      <button
        type="button"
        onClick={() => onTeamAction?.('trade')}
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
      >
        <ArrowsUpDownIcon className="h-4 w-4 text-blue-600" aria-hidden="true" />
        Trade
      </button>
      <button
        type="button"
        onClick={() => onTeamAction?.('analyze')}
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
      >
        <ChartBarIcon className="h-4 w-4 text-indigo-600" aria-hidden="true" />
        Analyze
      </button>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          aria-label="Refresh team data"
        >
          <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function TeamMetricGrid({
  teamStats,
  openSlots,
  rankingStatus,
  positionBreakdownEntries,
}: {
  teamStats: TeamStats;
  openSlots: number;
  rankingStatus: string;
  positionBreakdownEntries: Array<[string, number]>;
}) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Roster" value={`${teamStats.totalPlayers} / ${rosterTarget}`}>
        {teamStats.rosterComplete ? 'Complete' : `${openSlots} slots remaining`}
      </MetricCard>
      <MetricCard label="Avg Statly Z" value={formatMetric(teamStats.avgValue, 2)}>
        {rankingStatus}
      </MetricCard>
      <MetricCard label="Scoring Profile" value={formatMetric(teamStats.averageScore, 1)}>
        Projection {formatMetric(teamStats.projectedScore, 1)}
      </MetricCard>
      <MetricCard label="Composition" value={null}>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {positionBreakdownEntries.length > 0 ? (
            positionBreakdownEntries.map(([position, count]) => (
              <span
                key={position}
                className={`inline-flex items-center rounded border px-2 py-1 text-xs font-semibold ${getPositionColor(position)}`}
              >
                {position} {count}
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-500">No positions yet</span>
          )}
        </div>
      </MetricCard>
    </div>
  );
}

function MetricCard({
  label,
  value,
  children,
}: {
  label: string;
  value: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {value !== null && <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>}
      <div className="mt-1 text-sm text-slate-600">{children}</div>
    </div>
  );
}

function RosterToolbar({
  searchTerm,
  filterType,
  filterCounts,
  sortField,
  sortDirection,
  onSearchChange,
  onFilterChange,
  onSortFieldChange,
  onSortDirectionToggle,
}: {
  searchTerm: string;
  filterType: FilterType;
  filterCounts: Record<FilterType, number>;
  sortField: SortField;
  sortDirection: SortDirection;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: FilterType) => void;
  onSortFieldChange: (value: SortField) => void;
  onSortDirectionToggle: () => void;
}) {
  return (
    <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search players by name, position, or club"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="roster-sort-field" className="sr-only">
            Sort roster
          </label>
          <select
            id="roster-sort-field"
            value={sortField}
            onChange={(event) => onSortFieldChange(event.target.value as SortField)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
          >
            {sortControlFields.map(([field, label]) => (
              <option key={field} value={field}>
                Sort by {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onSortDirectionToggle}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-2"
            aria-label={`Sort ${sortDirection === 'desc' ? 'low to high' : 'high to low'}`}
          >
            <ArrowsUpDownIcon className="h-4 w-4" aria-hidden="true" />
            {sortDirection === 'desc' ? 'High first' : 'Low first'}
          </button>
          {filterTypes.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => onFilterChange(filter)}
              className={`rounded-md border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${
                filterType === filter
                  ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {capFirst(filter)}
              <span className={filterType === filter ? 'ml-2 text-blue-100' : 'ml-2 text-slate-500'}>
                {filterCounts[filter]}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 text-sm text-slate-600">
        Sorted by {activeSortLabel[sortField]} {sortDirection === 'desc' ? 'high to low' : 'low to high'}.
      </div>
    </div>
  );
}

function RosterTable({
  teamName,
  players,
  categoryColumns,
  selectedPlayer,
  rosterSlotById,
  rankingById,
  onPlayerClick,
  onTeamAction,
  getPerformanceIcon,
}: {
  teamName: string;
  players: Player[];
  categoryColumns: FantasyCategoryKey[];
  selectedPlayer: Player | null;
  rosterSlotById: Map<string, number>;
  rankingById: Map<string, RankingEntry>;
  onPlayerClick: (player: Player) => void;
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
  getPerformanceIcon: (player: Player) => React.ReactNode;
}) {
  const statColumnCount = Math.max(categoryColumns.length, 1);
  const tableMinWidth =
    ROSTER_PLAYER_COLUMN_WIDTH +
    ROSTER_PROFILE_COLUMN_WIDTH +
    statColumnCount * ROSTER_STAT_COLUMN_WIDTH +
    ROSTER_ACTIONS_COLUMN_WIDTH;
  const headerRowCount = categoryColumns.length > 0 ? 2 : 1;

  return (
    <table
      className="w-full table-fixed border-collapse text-left text-sm"
      style={{ minWidth: tableMinWidth }}
      aria-label={`${teamName} roster table`}
      aria-rowcount={players.length + headerRowCount}
    >
      <caption className="sr-only">
        {teamName} roster players with profile, league stats, and roster actions.
      </caption>
      <colgroup>
        <col style={{ width: ROSTER_PLAYER_COLUMN_WIDTH }} />
        <col style={{ width: ROSTER_PROFILE_COLUMN_WIDTH }} />
        {categoryColumns.length > 0 ? (
          categoryColumns.map((category) => (
            <col key={category} style={{ width: ROSTER_STAT_COLUMN_WIDTH }} />
          ))
        ) : (
          <col style={{ width: ROSTER_STAT_COLUMN_WIDTH }} />
        )}
        <col style={{ width: ROSTER_ACTIONS_COLUMN_WIDTH }} />
      </colgroup>
      <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 text-sm font-medium text-muted-foreground backdrop-blur">
        <tr>
          <th scope="col" rowSpan={headerRowCount} className="px-4 py-3 text-left font-medium sm:px-5">
            Player
          </th>
          <th scope="col" rowSpan={headerRowCount} className="px-4 py-3 text-left font-medium">
            Profile
          </th>
          <th
            scope={categoryColumns.length > 0 ? 'colgroup' : 'col'}
            colSpan={statColumnCount}
            className="border-x border-border/70 px-4 py-3 text-center font-medium"
          >
            League Stats
          </th>
          <th scope="col" rowSpan={headerRowCount} className="px-4 py-3 text-left font-medium">
            Actions
          </th>
        </tr>
        {categoryColumns.length > 0 && (
          <tr className="border-t border-border/70">
            {categoryColumns.map((category) => {
              const categoryData = FANTASY_CATEGORIES[category];
              const shortLabel = categoryData.abbrev ?? categoryData.shortLabel ?? categoryData.label;

              return (
                <th
                  key={category}
                  scope="col"
                  aria-label={categoryData.label}
                  title={categoryData.label}
                  className="border-l border-border/60 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide"
                >
                  {shortLabel}
                </th>
              );
            })}
          </tr>
        )}
      </thead>
      <tbody className="divide-y divide-border bg-background">
        {players.map((player, index) => (
          <RosterRow
            key={player.id}
            player={player}
            index={index}
            selected={selectedPlayer?.id === player.id}
            categoryColumns={categoryColumns}
            rosterSlotById={rosterSlotById}
            ranking={rankingById.get(String(player.id))}
            onPlayerClick={onPlayerClick}
            onTeamAction={onTeamAction}
            getPerformanceIcon={getPerformanceIcon}
          />
        ))}
      </tbody>
    </table>
  );
}

function getRosterPositionLabel(player: Player) {
  return player.position ? player.position.toUpperCase() : '—';
}

function getRosterClubLabel(player: Player) {
  return player.team ? capWords(player.team) : '—';
}

function RosterRow({
  player,
  index,
  selected,
  categoryColumns,
  rosterSlotById,
  ranking,
  onPlayerClick,
  onTeamAction,
  getPerformanceIcon,
}: {
  player: Player;
  index: number;
  selected: boolean;
  categoryColumns: FantasyCategoryKey[];
  rosterSlotById: Map<string, number>;
  ranking?: RankingEntry;
  onPlayerClick: (player: Player) => void;
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
  getPerformanceIcon: (player: Player) => React.ReactNode;
}) {
  const rosterIndex = rosterSlotById.get(String(player.id)) ?? index;
  const role = rosterIndex < 18 ? 'Starter' : 'Bench';
  const rowClassName = `cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
    selected ? 'bg-primary/10' : ''
  }`;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPlayerClick(player);
    }
  };

  return (
    <tr
      className={rowClassName}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => onPlayerClick(player)}
      aria-label={`${capWords(player.name)}, ${getRosterPositionLabel(player)}, ${getRosterClubLabel(player)}. Press Enter to review.`}
      aria-rowindex={index + (categoryColumns.length > 0 ? 3 : 2)}
      data-selected={selected ? 'true' : undefined}
    >
      <RosterIdentityCell
        player={player}
        role={role}
        getPerformanceIcon={getPerformanceIcon}
      />
      <RosterProfileCell player={player} ranking={ranking} />
      <RosterStatCells player={player} categoryColumns={categoryColumns} />
      <RosterRowActions player={player} onTeamAction={onTeamAction} />
    </tr>
  );
}

function RosterIdentityCell({
  player,
  role,
  getPerformanceIcon,
}: {
  player: Player;
  role: string;
  getPerformanceIcon: (player: Player) => React.ReactNode;
}) {
  const club = player.team || '';
  const teamLogo = getTeamLogo(club);
  const teamAbbreviation = club ? getTeamAbbreviation(club) : '—';

  return (
    <th scope="row" className="px-4 py-4 font-normal sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md border border-border bg-background p-1.5 shadow-sm">
          <Image
            src={teamLogo}
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            unoptimized={teamLogo.endsWith('.svg')}
            className="h-8 max-w-8 object-contain"
            style={{ width: 'auto' }}
          />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold text-foreground">
              {capWords(player.name)}
            </span>
            {getPerformanceIcon(player)}
            {player.injury && (
              <InformationCircleIcon className="h-4 w-4 text-destructive" aria-label={player.injury} />
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-semibold text-foreground">
              {getRosterPositionLabel(player)}
            </span>
            <span className="rounded-md border border-border bg-background px-2 py-0.5 font-medium text-foreground">
              {teamAbbreviation}
            </span>
            <span>{getRosterClubLabel(player)}</span>
            <span className="rounded-md bg-muted px-2 py-0.5">{role}</span>
            <PlayerRoleBadges player={player} />
          </div>
        </div>
      </div>
    </th>
  );
}

function RosterProfileCell({
  player,
  ranking,
}: {
  player: Player;
  ranking?: RankingEntry;
}) {
  const statlyZ = getPlayerStatlyZ(player, ranking);
  const averageScore = readPlayerScore(player, 'averageScore');

  return (
    <td className="px-4 py-4 align-middle">
      <div className="min-w-0 space-y-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Statly Z
          </div>
          <div className="mt-1 text-lg font-semibold leading-none text-foreground">
            {statlyZ === null ? 'Pending' : statlyZ.toFixed(2)}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Combined Z score across this league&apos;s selected scoring categories.
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {ranking?.rank && (
            <span className="rounded-md bg-primary/10 px-2 py-1 font-semibold text-primary">
              #{ranking.rank}
            </span>
          )}
          {averageScore !== null && (
            <span className="rounded-md bg-muted px-2 py-1 font-medium text-muted-foreground">
              Avg {averageScore.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </td>
  );
}

function RosterStatCells({
  player,
  categoryColumns,
}: {
  player: Player;
  categoryColumns: FantasyCategoryKey[];
}) {
  if (categoryColumns.length === 0) {
    return (
      <td className="border-l border-border/60 px-4 py-4 align-middle text-sm text-muted-foreground">
        League categories pending.
      </td>
    );
  }

  return (
    <>
      {categoryColumns.map((category) => {
        const categoryData = FANTASY_CATEGORIES[category];
        const value = readCategoryAverage(player, category);
        const displayValue = formatCategoryAverage(value, categoryData);

        return (
          <td
            key={category}
            className="border-l border-border/60 px-3 py-4 text-center align-middle text-sm font-semibold text-foreground"
            aria-label={`${categoryData.label}: ${displayValue}`}
          >
            <span className="inline-flex min-w-12 justify-center tabular-nums">
              {displayValue}
            </span>
          </td>
        );
      })}
    </>
  );
}

function RosterRowActions({
  player,
  onTeamAction,
}: {
  player: Player;
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
}) {
  return (
    <td className="border-l border-border/60 px-3 py-4 align-middle">
      <div className="grid grid-cols-3 items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTeamAction?.('view', player);
          }}
          className={`${ROSTER_ACTION_BUTTON_BASE_CLASS} ${ROSTER_ACTION_BUTTON_OUTLINE_CLASS}`}
          aria-label={`View ${player.name}`}
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          <span className="hidden 2xl:inline">View</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTeamAction?.('captain', player);
          }}
          className={`${ROSTER_ACTION_BUTTON_BASE_CLASS} ${ROSTER_ACTION_BUTTON_PRIMARY_CLASS}`}
          aria-label={`Set ${player.name} as captain`}
        >
          <Crown className="h-4 w-4" aria-hidden="true" />
          <span className="hidden 2xl:inline">Captain</span>
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTeamAction?.('trade', player);
          }}
          className={`${ROSTER_ACTION_BUTTON_BASE_CLASS} ${ROSTER_ACTION_BUTTON_OUTLINE_CLASS}`}
          aria-label={`Open trade for ${player.name}`}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          <span className="hidden 2xl:inline">Trade</span>
        </button>
      </div>
    </td>
  );
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
  selectedCategories = [],
  className = '',
}: MyTeamPanelProps) => {
  const { rankings, loading: rankingsLoading } = useRankings();
  const [sortField, setSortField] = useState<SortField>(sortByValue ? 'totalValue' : 'name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const rankingEntries = getSafeRankings(rankings);
  const categoryColumns = useMemo(
    () => normalizeCategoryColumns(selectedCategories),
    [selectedCategories]
  );

  const draftedPlayers = useMemo(() => {
    if (!team) return [];
    return players.filter((p) => (team.players ?? []).map(String).includes(String(p.id)));
  }, [team, players]);

  const rosterSlotById = useMemo(() => {
    return getRosterSlotById(draftedPlayers);
  }, [draftedPlayers]);

  const rankingById = useMemo(() => {
    return new Map(rankingEntries.map((ranking) => [String(ranking.id), ranking]));
  }, [rankingEntries]);

  // Calculate team statistics
  const teamStats = useMemo<TeamStats>(() => {
    return calculateTeamStats(draftedPlayers, rankingById);
  }, [draftedPlayers, rankingById]);

  // Filter and sort players
  const filteredAndSortedPlayers = useMemo(() => {
    return getFilteredAndSortedPlayers({
      players: draftedPlayers,
      searchTerm,
      filterType,
      sortField,
      sortDirection,
      rankingById,
    });
  }, [draftedPlayers, searchTerm, filterType, sortField, sortDirection, rankingById]);

  const handleSortFieldChange = useCallback((field: SortField) => {
    setSortField(field);
    setSortDirection('desc');
  }, []);

  const handleSortDirectionToggle = useCallback(() => {
    setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
  }, []);

  const handlePlayerClick = useCallback(
    (player: Player) => {
      setSelectedPlayer(player);
      onPlayerSelect?.(player);
    },
    [onPlayerSelect]
  );

  const getPerformanceIcon = (player: Player) => {
    const value = getPlayerStatlyZ(player, rankingById.get(String(player.id))) ?? 0;
    const avgValue = teamStats.avgValue;

    if (avgValue === 0) return null;

    if (value > avgValue * 1.2) {
      return <StarIconSolid className="w-4 h-4 text-yellow-500" />;
    } else if (value < avgValue * 0.8) {
      return <InformationCircleIcon className="w-4 h-4 text-orange-500" />;
    }
    return null;
  };

  if (!team) {
    return <EmptyTeamState className={className} onTeamAction={onTeamAction} />;
  }

  const openSlots = Math.max(rosterTarget - teamStats.totalPlayers, 0);
  const filterCounts = getFilterCounts(draftedPlayers);
  const positionBreakdownEntries = getPositionBreakdownEntries(teamStats.positionBreakdown);
  const rankingStatus = rankingsLoading
    ? 'Updating rankings'
    : `${rankingById.size.toLocaleString()} rankings loaded`;

  return (
    <section aria-labelledby="team-heading" className={className}>
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-4 sm:px-5">
          <TeamPanelHeader
            teamName={team.name || 'My Team'}
            compact={compact}
            rosterComplete={teamStats.rosterComplete}
            openSlots={openSlots}
            isLoading={isLoading}
            showAdvancedFeatures={showAdvancedFeatures}
            onTeamAction={onTeamAction}
            onRefresh={onRefresh}
          />
          <TeamMetricGrid
            teamStats={teamStats}
            openSlots={openSlots}
            rankingStatus={rankingStatus}
            positionBreakdownEntries={positionBreakdownEntries}
          />
        </div>

        {showAdvancedFeatures && draftedPlayers.length > 0 && (
          <RosterToolbar
            searchTerm={searchTerm}
            filterType={filterType}
            filterCounts={filterCounts}
            sortField={sortField}
            sortDirection={sortDirection}
            onSearchChange={setSearchTerm}
            onFilterChange={setFilterType}
            onSortFieldChange={handleSortFieldChange}
            onSortDirectionToggle={handleSortDirectionToggle}
          />
        )}

        <div className="flex-1 overflow-auto" style={{ maxHeight }}>
          {filteredAndSortedPlayers.length === 0 ? (
            <EmptyRosterState
              hasDraftedPlayers={draftedPlayers.length > 0}
              onClearFilters={() => {
                setSearchTerm('');
                setFilterType('all');
              }}
              onTeamAction={onTeamAction}
            />
          ) : (
            <RosterTable
              teamName={team.name || 'My Team'}
              players={filteredAndSortedPlayers}
              categoryColumns={categoryColumns}
              selectedPlayer={selectedPlayer}
              rosterSlotById={rosterSlotById}
              rankingById={rankingById}
              onPlayerClick={handlePlayerClick}
              onTeamAction={onTeamAction}
              getPerformanceIcon={getPerformanceIcon}
            />
          )}
        </div>
      </div>
    </section>
  );
};

export default MyTeamPanel;
