'use client';

import { useState, useMemo, useCallback } from 'react';
import type { Player, Team } from '../types/players';
import { useRankings } from '@/hooks/useRankings';
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
const tableSortFields: Array<[SortField, string]> = [
  ['name', 'Player'],
  ['position', 'Pos'],
  ['team', 'Club'],
  ['totalValue', 'Statly Z'],
  ['recent', 'Form'],
];
const activeSortLabel = {
  name: 'Name',
  position: 'Position',
  team: 'Club',
  totalValue: 'Statly Z',
  recent: 'Form',
} satisfies Record<SortField, string>;
const positionOrder = ['RUC', 'MID', 'DEF', 'FWD'];

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
}: {
  searchTerm: string;
  filterType: FilterType;
  filterCounts: Record<FilterType, number>;
  sortField: SortField;
  sortDirection: SortDirection;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: FilterType) => void;
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
  selectedPlayer,
  sortField,
  rosterSlotById,
  rankingById,
  onSort,
  onPlayerClick,
  onTeamAction,
  getPerformanceIcon,
}: {
  teamName: string;
  players: Player[];
  selectedPlayer: Player | null;
  sortField: SortField;
  rosterSlotById: Map<string, number>;
  rankingById: Map<string, RankingEntry>;
  onSort: (field: SortField) => void;
  onPlayerClick: (player: Player) => void;
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
  getPerformanceIcon: (player: Player) => React.ReactNode;
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm" aria-label={`${teamName} roster table`}>
      <thead className="sticky top-0 z-10 bg-slate-50">
        <tr>
          {tableSortFields.map(([field, label]) => (
            <th
              key={field}
              scope="col"
              className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                field === 'totalValue' || field === 'recent' ? 'text-right' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onSort(field)}
                className={`inline-flex items-center gap-1 rounded-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 ${
                  field === 'totalValue' || field === 'recent' ? 'justify-end' : ''
                }`}
              >
                {label}
                {sortField === field && (
                  <ArrowsUpDownIcon className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                )}
              </button>
            </th>
          ))}
          <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            Avg
          </th>
          <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            Actions
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {players.map((player, index) => (
          <RosterRow
            key={player.id}
            player={player}
            index={index}
            selected={selectedPlayer?.id === player.id}
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

function RosterRow({
  player,
  index,
  selected,
  rosterSlotById,
  ranking,
  onPlayerClick,
  onTeamAction,
  getPerformanceIcon,
}: {
  player: Player;
  index: number;
  selected: boolean;
  rosterSlotById: Map<string, number>;
  ranking?: RankingEntry;
  onPlayerClick: (player: Player) => void;
  onTeamAction?: MyTeamPanelProps['onTeamAction'];
  getPerformanceIcon: (player: Player) => React.ReactNode;
}) {
  const statlyZ = getPlayerStatlyZ(player, ranking);
  const averageScore = readPlayerScore(player, 'averageScore');
  const form = readPlayerScore(player, 'form') ?? readPlayerScore(player, 'projectedScore');
  const rosterIndex = rosterSlotById.get(String(player.id)) ?? index;
  const role = rosterIndex < 18 ? 'Starter' : 'Bench';

  return (
    <tr className={`transition hover:bg-slate-50 ${selected ? 'bg-blue-50/70' : ''}`}>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => onPlayerClick(player)}
          className="group flex min-w-64 items-center gap-3 text-left focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-600">
            {capWords(player.name).charAt(0)}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold text-slate-950 group-hover:text-blue-700">
              {capWords(player.name)}
              {getPerformanceIcon(player)}
              {player.injury && (
                <InformationCircleIcon className="h-4 w-4 text-red-500" aria-label={player.injury} />
              )}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <span>{role}</span>
              <PlayerRoleBadges player={player} />
            </span>
          </span>
        </button>
      </td>
      <td className="px-4 py-3">
        {player.position ? (
          <span className={`inline-flex items-center rounded border px-2 py-1 text-xs font-semibold ${getPositionColor(player.position)}`}>
            {capFirst(player.position)}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-4 py-3 font-medium text-slate-700">{capWords(player.team || '—')}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex flex-col items-end">
          {ranking?.rank && <span className="text-xs font-semibold text-blue-600">#{ranking.rank}</span>}
          <span className="font-semibold text-slate-950">{statlyZ === null ? '—' : statlyZ.toFixed(2)}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-semibold text-slate-800">
        {form === null ? '—' : form.toFixed(0)}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-slate-800">
        {averageScore === null ? '—' : averageScore.toFixed(1)}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          {(['view', 'captain', 'trade'] as const).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onTeamAction?.(action, player)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            >
              {capFirst(action)}
            </button>
          ))}
        </div>
      </td>
    </tr>
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
  className = '',
}: MyTeamPanelProps) => {
  const { rankings, loading: rankingsLoading } = useRankings();
  const [sortField, setSortField] = useState<SortField>(sortByValue ? 'totalValue' : 'name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const rankingEntries = getSafeRankings(rankings);

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
              selectedPlayer={selectedPlayer}
              sortField={sortField}
              rosterSlotById={rosterSlotById}
              rankingById={rankingById}
              onSort={handleSort}
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
