'use client';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import Image from 'next/image';
import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';

import { getTeamAbbreviation, getTeamLogo, getTeamName } from '@/lib/teamLogos';
import type { TradeTeamDto } from '@/server/leagues/trades/tradeContracts';
import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

interface TradeRosterTableProps {
  team: TradeTeamDto;
  playerStats: LeaguePlayerStatDatasetDto;
  selectedIds: string[];
  disabled: boolean;
  onTogglePlayer: (playerId: string) => void;
  /** Replaces the selected count at the end of the toolbar, e.g. a "Next" step. */
  toolbarEnd?: React.ReactNode;
}

type SortKey = 'player' | LeaguePlayerStatDatasetDto['columns'][number]['key'];

const POSITION_FILTERS = ['ALL', 'DEF', 'MID', 'RUC', 'FWD'] as const;
type PositionFilter = (typeof POSITION_FILTERS)[number];
type SortDirection = 'ascending' | 'descending';

export function TradeRosterTable({
  team,
  playerStats,
  selectedIds,
  disabled,
  onTogglePlayer,
  toolbarEnd,
}: TradeRosterTableProps): React.JSX.Element {
  const id = useId();
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<PositionFilter>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('player');
  const [sortDirection, setSortDirection] = useState<SortDirection>('ascending');
  const normalizedQuery = query.trim().toLowerCase();
  const heading = `${team.teamName} sends`;
  const visiblePlayers = useMemo(() => {
    const filtered = team.players.filter(
      (player) =>
        (position === 'ALL' ||
          player.position
            .split('/')
            .map((part) => part.trim().toUpperCase())
            .includes(position)) &&
        [player.name, player.club, player.position].some((value) =>
          value.toLowerCase().includes(normalizedQuery)
        )
    );

    return [...filtered].sort((left, right) => {
      if (sortKey === 'player') {
        const comparison = left.name.localeCompare(right.name);
        return sortDirection === 'ascending' ? comparison : -comparison;
      }

      return compareNullableNumbers(
        playerStats.playersById[left.id]?.values[sortKey],
        playerStats.playersById[right.id]?.values[sortKey],
        sortDirection
      );
    });
  }, [normalizedQuery, playerStats.playersById, position, sortDirection, sortKey, team.players]);

  function updateSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === 'ascending' ? 'descending' : 'ascending'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'player' ? 'ascending' : 'descending');
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="min-w-0 bg-[color:var(--trade-surface)]">
      <h4 id={`${id}-heading`} className="sr-only">
        {heading}
      </h4>
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--trade-border)] px-3 py-2.5">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search {team.teamName} roster
        </label>
        <div className="relative min-w-0 flex-1 basis-44">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--trade-text-muted)]"
          />
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full rounded-md border sm:h-9 border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] pl-9 pr-3 text-sm text-[color:var(--trade-text)] outline-none placeholder:text-[color:var(--trade-text-muted)] focus:border-[color:var(--trade-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]/20 disabled:opacity-60"
            placeholder="Search players"
          />
        </div>
        <div
          role="group"
          aria-label={`Filter ${team.teamName} by position`}
          className="flex h-11 items-stretch rounded-md sm:h-9 border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] p-0.5"
        >
          {POSITION_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={position === option}
              disabled={disabled}
              onClick={() => setPosition(option)}
              className={`rounded px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--trade-focus)] disabled:opacity-60 ${
                position === option
                  ? 'bg-[color:var(--trade-selection)] text-white'
                  : 'text-[color:var(--trade-text-muted)] hover:text-[color:var(--trade-text)]'
              }`}
            >
              {option === 'ALL' ? 'All' : option}
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center">
          {toolbarEnd ?? (
            <span className="text-xs font-semibold tabular-nums text-[color:var(--trade-text-muted)]">
              {selectedIds.length} selected
            </span>
          )}
        </div>
      </div>

      {/* A focus target is required so keyboard users can scroll the wide data table. */}
      <div
        tabIndex={0}
        aria-label={`${team.teamName} roster table, horizontally scrollable`}
        className="relative max-h-[min(36rem,65dvh)] overflow-auto focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)]"
      >
        <table className="w-full min-w-max border-collapse text-left">
          <caption className="sr-only">
            {heading}. Season {playerStats.context.season} per-game averages. {selectedIds.length}{' '}
            selected.
          </caption>
          <thead className="sticky top-0 z-20 bg-[color:var(--trade-surface-subtle)]">
            <tr className="border-b border-[color:var(--trade-border)]">
              <th
                scope="col"
                aria-sort={sortKey === 'player' ? sortDirection : 'none'}
                className="sticky left-0 z-30 min-w-56 border-l-[3px] border-l-transparent bg-[color:var(--trade-surface-subtle)] px-3"
              >
                <SortButton
                  label="Player"
                  active={sortKey === 'player'}
                  direction={sortDirection}
                  kind="player"
                  onClick={() => updateSort('player')}
                />
              </th>
              {playerStats.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sortKey === column.key ? sortDirection : 'none'}
                  className="w-14 min-w-14 px-2 text-right"
                >
                  <SortButton
                    label={column.shortLabel}
                    accessibleLabel={`${column.label}, ${column.direction === 'LOW_WINS' ? 'lower' : 'higher'} is better`}
                    active={sortKey === column.key}
                    direction={sortDirection}
                    kind="numeric"
                    onClick={() => updateSort(column.key)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePlayers.map((player) => {
              const selected = selectedIds.includes(player.id);
              const teamLogo = getTeamLogo(player.club);
              const teamAbbreviation = getTeamAbbreviation(player.club);
              const teamName = getTeamName(player.club);

              return (
                <tr
                  key={player.id}
                  aria-selected={selected}
                  onClick={(event) => {
                    if (
                      disabled ||
                      (event.target instanceof Element &&
                        event.target.closest('input, label, button, a'))
                    ) {
                      return;
                    }
                    onTogglePlayer(player.id);
                  }}
                  className={`group h-12 border-b border-[color:var(--trade-border)] transition-colors last:border-0 ${
                    disabled ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    selected
                      ? 'bg-[color:var(--trade-selection-soft)]'
                      : disabled
                        ? 'bg-[color:var(--trade-surface)]'
                        : 'bg-[color:var(--trade-surface)] hover:bg-[color:var(--trade-surface-subtle)]'
                  }`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 border-l-[3px] px-3 py-1.5 font-normal transition-colors ${
                      selected
                        ? 'border-l-[color:var(--trade-selection)] bg-[color:var(--trade-selection-soft)]'
                        : disabled
                          ? 'border-l-transparent bg-[color:var(--trade-surface)]'
                          : 'border-l-transparent bg-[color:var(--trade-surface)] group-hover:bg-[color:var(--trade-surface-subtle)]'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <input
                        id={`${id}-player-${player.id}`}
                        type="checkbox"
                        checked={selected}
                        disabled={disabled}
                        onChange={() => onTogglePlayer(player.id)}
                        className="size-5 shrink-0 rounded border-[color:var(--trade-border-strong)] accent-[var(--trade-selection)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-1"
                      />
                      <label
                        htmlFor={`${id}-player-${player.id}`}
                        className={`flex min-w-0 flex-1 items-center gap-2.5 ${
                          disabled ? 'cursor-default' : 'cursor-pointer'
                        }`}
                      >
                        <Image
                          src={teamLogo}
                          alt={`${teamName} logo`}
                          width={24}
                          height={24}
                          unoptimized={teamLogo.endsWith('.svg')}
                          className="size-6 shrink-0 object-contain"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[color:var(--trade-text)]">
                            {player.name}
                          </span>
                          <span className="block truncate text-xs text-[color:var(--trade-text-muted)]">
                            <span className="font-semibold">{player.position}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{teamAbbreviation}</span>
                          </span>
                        </span>
                      </label>
                    </div>
                  </th>
                  {playerStats.columns.map((column) => (
                    <td
                      key={column.key}
                      className="px-2 py-2 text-right text-sm tabular-nums text-[color:var(--trade-text)]"
                    >
                      {formatStatValue(
                        playerStats.playersById[player.id]?.values[column.key],
                        FANTASY_CATEGORIES[column.key]
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {visiblePlayers.length === 0 && (
              <tr>
                <td
                  colSpan={playerStats.columns.length + 1}
                  className="bg-[color:var(--trade-surface-subtle)] p-6 text-center text-sm text-[color:var(--trade-text-muted)]"
                >
                  {team.players.length === 0 ? 'No players on this roster.' : 'No players match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortButton({
  label,
  accessibleLabel,
  active,
  direction,
  kind,
  onClick,
}: {
  label: string;
  accessibleLabel?: string;
  active: boolean;
  direction: SortDirection;
  kind: 'player' | 'numeric';
  onClick: () => void;
}): React.JSX.Element {
  const completeLabel = accessibleLabel ?? label;
  const accessibleState = getAccessibleSortState(active, direction, kind);
  const actionLabel = active
    ? `${completeLabel}. ${accessibleState}. Activate to sort ${getAccessibleSortState(true, toggleDirection(direction), kind).replace('Sorted ', '').toLowerCase()}.`
    : `${completeLabel}. ${accessibleState}. Activate to sort.`;

  return (
    <button
      type="button"
      title={`${completeLabel}. ${accessibleState}.`}
      onClick={onClick}
      aria-label={actionLabel}
      className={`inline-flex h-10 w-full items-center gap-1 rounded p-0 text-xs font-semibold text-[color:var(--trade-text-muted)] hover:text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] ${
        kind === 'player' ? 'justify-start' : 'justify-end'
      }`}
    >
      <span aria-hidden="true">{label}</span>
      {active &&
        (direction === 'ascending' ? (
          <ArrowUp aria-hidden="true" className="size-3.5 text-[color:var(--trade-selection)]" />
        ) : (
          <ArrowDown aria-hidden="true" className="size-3.5 text-[color:var(--trade-selection)]" />
        ))}
    </button>
  );
}

function getAccessibleSortState(
  active: boolean,
  direction: SortDirection,
  kind: 'player' | 'numeric'
): string {
  if (!active) return 'Not sorted';
  if (kind === 'player') return direction === 'ascending' ? 'Sorted A to Z' : 'Sorted Z to A';
  return direction === 'ascending' ? 'Sorted low to high' : 'Sorted high to low';
}

function toggleDirection(direction: SortDirection): SortDirection {
  return direction === 'ascending' ? 'descending' : 'ascending';
}

function compareNullableNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: SortDirection
): number {
  const leftIsNumber = isSortableNumber(left);
  const rightIsNumber = isSortableNumber(right);

  if (!leftIsNumber) return rightIsNumber ? 1 : 0;
  if (!rightIsNumber) return -1;

  const comparison = left - right;
  return direction === 'ascending' ? comparison : -comparison;
}

function isSortableNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
