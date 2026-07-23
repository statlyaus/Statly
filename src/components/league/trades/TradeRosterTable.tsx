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
}

type SortKey = 'player' | LeaguePlayerStatDatasetDto['columns'][number]['key'];
type SortDirection = 'ascending' | 'descending';

export function TradeRosterTable({
  team,
  playerStats,
  selectedIds,
  disabled,
  onTogglePlayer,
}: TradeRosterTableProps): React.JSX.Element {
  const id = useId();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('player');
  const [sortDirection, setSortDirection] = useState<SortDirection>('ascending');
  const normalizedQuery = query.trim().toLowerCase();
  const heading = `${team.teamName} sends`;
  const visiblePlayers = useMemo(() => {
    const filtered = team.players.filter((player) =>
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
  }, [normalizedQuery, playerStats.playersById, sortDirection, sortKey, team.players]);

  function updateSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === 'ascending' ? 'descending' : 'ascending'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'player' ? 'ascending' : 'descending');
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="min-w-0 overflow-hidden rounded-xl border border-[color:var(--trade-border)] bg-[color:var(--trade-surface)]"
    >
      <div className="space-y-4 border-b border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id={`${id}-heading`} className="text-base font-bold text-[color:var(--trade-text)]">
              {heading}
            </h4>
            <p className="mt-0.5 text-xs text-[color:var(--trade-text-muted)]">
              Select players from {team.teamName}
            </p>
          </div>
          <span className="shrink-0 rounded-md border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] px-2 py-1 text-xs font-bold tabular-nums text-[color:var(--trade-text)]">
            {selectedIds.length} selected
          </span>
        </div>
        <div>
          <label
            htmlFor={`${id}-search`}
            className="text-xs font-semibold text-[color:var(--trade-text)]"
          >
            Search <span className="sr-only">{team.teamName} </span>roster
          </label>
          <div className="relative mt-1.5">
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
              className="h-11 w-full rounded-lg border border-[color:var(--trade-border-strong)] bg-[color:var(--trade-surface)] pl-10 pr-3 text-sm text-[color:var(--trade-text)] outline-none placeholder:text-[color:var(--trade-text-muted)] focus:border-[color:var(--trade-focus)] focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]/20 disabled:opacity-60"
              placeholder="Player, club, or position"
            />
          </div>
        </div>
      </div>

      {/* A focus target is required so keyboard users can scroll the wide data table. */}
      <div
        tabIndex={0}
        aria-label={`${team.teamName} roster table, horizontally scrollable`}
        className="max-h-[32rem] overflow-auto focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)]"
      >
        <table className="w-full min-w-max border-collapse text-left">
          <caption className="sr-only">
            {heading}. Season {playerStats.context.season} per-game averages. {selectedIds.length}{' '}
            selected.
          </caption>
          <thead className="sticky top-0 z-20 bg-[color:var(--trade-surface-subtle)]">
            <tr className="border-b border-[color:var(--trade-border-strong)]">
              <th
                scope="col"
                aria-sort={sortKey === 'player' ? sortDirection : 'none'}
                className="sticky left-0 z-30 min-w-60 bg-[color:var(--trade-surface-subtle)] px-3"
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
                  className="min-w-24 px-3 text-right"
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
                  className={`group h-14 border-b border-[color:var(--trade-border)] transition-colors last:border-0 ${
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
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[color:var(--trade-text-muted)]">
                            <span className="rounded border border-[color:var(--trade-border)] bg-[color:var(--trade-surface-subtle)] px-1.5 py-0.5 font-semibold text-[color:var(--trade-text)]">
                              {player.position}
                            </span>
                            <span className="font-medium">{teamAbbreviation}</span>
                          </span>
                        </span>
                      </label>
                    </div>
                  </th>
                  {playerStats.columns.map((column) => (
                    <td
                      key={column.key}
                      className="px-3 py-2 text-right text-sm font-medium tabular-nums text-[color:var(--trade-text)]"
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
                  {team.players.length === 0
                    ? 'No rostered players are available.'
                    : 'No players match.'}
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
  const visibleState = getVisibleSortState(active, direction, kind);
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
      className="inline-flex h-11 w-full items-center justify-end gap-1.5 rounded px-1 text-xs font-bold text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]"
    >
      <span aria-hidden="true">{label}</span>
      <span
        aria-hidden="true"
        className={`whitespace-nowrap text-xs font-semibold ${
          active ? 'text-[color:var(--trade-selection)]' : 'text-[color:var(--trade-text-muted)]'
        }`}
      >
        {visibleState}
      </span>
      {active &&
        (direction === 'ascending' ? (
          <ArrowUp aria-hidden="true" className="size-3.5 text-[color:var(--trade-selection)]" />
        ) : (
          <ArrowDown aria-hidden="true" className="size-3.5 text-[color:var(--trade-selection)]" />
        ))}
    </button>
  );
}

function getVisibleSortState(
  active: boolean,
  direction: SortDirection,
  kind: 'player' | 'numeric'
): string {
  if (!active) return '—';
  if (kind === 'player') return direction === 'ascending' ? 'A–Z' : 'Z–A';
  return direction === 'ascending' ? 'Low–high' : 'High–low';
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
