'use client';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';

import type { TradePlayerDto } from '@/server/leagues/trades/tradeContracts';
import { FANTASY_CATEGORIES, formatStatValue } from '@/types/fantasyCategories';
import type { LeaguePlayerStatDatasetDto } from '@/types/leaguePlayerStats';

interface TradeRosterTableProps {
  label: string;
  description: string;
  players: TradePlayerDto[];
  playerStats: LeaguePlayerStatDatasetDto;
  selectedIds: string[];
  disabled: boolean;
  onSelectionChange: (ids: string[]) => void;
}

type SortKey = 'player' | LeaguePlayerStatDatasetDto['columns'][number]['key'];

export function TradeRosterTable({
  label,
  description,
  players,
  playerStats,
  selectedIds,
  disabled,
  onSelectionChange,
}: TradeRosterTableProps): React.JSX.Element {
  const id = useId();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('player');
  const [sortDirection, setSortDirection] = useState<'ascending' | 'descending'>('ascending');
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePlayers = useMemo(() => {
    const filtered = players.filter((player) =>
      [player.name, player.club, player.position].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      )
    );

    return [...filtered].sort((left, right) => {
      const comparison =
        sortKey === 'player'
          ? left.name.localeCompare(right.name)
          : compareNullableNumbers(
              playerStats.playersById[left.id]?.values[sortKey],
              playerStats.playersById[right.id]?.values[sortKey]
            );
      return sortDirection === 'ascending' ? comparison : -comparison;
    });
  }, [normalizedQuery, playerStats.playersById, players, sortDirection, sortKey]);

  function updateSort(nextKey: SortKey): void {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === 'ascending' ? 'descending' : 'ascending'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === 'player' ? 'ascending' : 'descending');
  }

  function togglePlayer(playerId: string): void {
    onSelectionChange(
      selectedIds.includes(playerId)
        ? selectedIds.filter((selectedId) => selectedId !== playerId)
        : [...selectedIds, playerId]
    );
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="min-w-0 overflow-hidden rounded-xl border border-[color:var(--trade-border)] border-t-[3px] border-t-[color:var(--trade-direction)] bg-[color:var(--trade-surface)]"
    >
      <div className="space-y-4 border-b border-[color:var(--trade-border)] bg-[color:var(--trade-direction-soft)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id={`${id}-heading`} className="text-base font-bold text-[color:var(--trade-text)]">
              {label}
            </h4>
            <p className="mt-0.5 text-xs text-[color:var(--trade-text-muted)]">{description}</p>
          </div>
          <span className="shrink-0 rounded-md border border-[color:var(--trade-direction)]/25 bg-[color:var(--trade-surface)] px-2 py-1 text-xs font-bold tabular-nums text-[color:var(--trade-direction)]">
            {selectedIds.length} selected
          </span>
        </div>
        <div>
          <label
            htmlFor={`${id}-search`}
            className="text-xs font-semibold text-[color:var(--trade-text)]"
          >
            Search roster <span className="sr-only">for {label.toLowerCase()}</span>
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
        aria-label={`${label} roster table, horizontally scrollable`}
        className="max-h-[32rem] overflow-auto focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[color:var(--trade-focus)]"
      >
        <table className="w-full min-w-max border-collapse text-left">
          <caption className="sr-only">
            {label}. Season {playerStats.context.season} per-game averages. {selectedIds.length}{' '}
            selected.
          </caption>
          <thead className="sticky top-0 z-20 bg-[color:var(--trade-surface-subtle)]">
            <tr className="h-11 border-b border-[color:var(--trade-border-strong)]">
              <th
                scope="col"
                aria-sort={sortKey === 'player' ? sortDirection : 'none'}
                className="sticky left-0 z-30 min-w-52 bg-[color:var(--trade-surface-subtle)] px-3 py-1.5"
              >
                <SortButton
                  label="Player"
                  active={sortKey === 'player'}
                  direction={sortDirection}
                  onClick={() => updateSort('player')}
                />
              </th>
              {playerStats.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sortKey === column.key ? sortDirection : 'none'}
                  className="min-w-20 px-3 py-1.5 text-right"
                >
                  <SortButton
                    label={column.shortLabel}
                    accessibleLabel={`${column.label}, ${column.direction === 'LOW_WINS' ? 'lower' : 'higher'} is better`}
                    active={sortKey === column.key}
                    direction={sortDirection}
                    onClick={() => updateSort(column.key)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePlayers.map((player) => {
              const selected = selectedIds.includes(player.id);
              return (
                <tr
                  key={player.id}
                  aria-selected={selected}
                  className={`group h-12 border-b border-[color:var(--trade-border)] transition-colors last:border-0 hover:bg-[color:var(--trade-action-soft)] ${
                    selected ? 'bg-[color:var(--trade-direction-soft)]' : ''
                  }`}
                >
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 border-l-[3px] px-3 py-2 font-normal transition-colors group-hover:bg-[color:var(--trade-action-soft)] ${
                      selected
                        ? 'border-l-[color:var(--trade-direction)] bg-[color:var(--trade-direction-soft)]'
                        : 'border-l-transparent bg-[color:var(--trade-surface)]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        id={`${id}-player-${player.id}`}
                        type="checkbox"
                        checked={selected}
                        disabled={disabled}
                        onChange={() => togglePlayer(player.id)}
                        className="mt-0.5 size-4.5 rounded border-[color:var(--trade-border-strong)] accent-[var(--trade-direction)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)] focus-visible:ring-offset-1"
                      />
                      <label
                        htmlFor={`${id}-player-${player.id}`}
                        className="min-w-0 cursor-pointer"
                      >
                        <span className="block text-sm font-semibold text-[color:var(--trade-text)]">
                          {player.name}
                        </span>
                        <span className="block text-xs text-[color:var(--trade-text-muted)]">
                          {[player.position, player.club].filter(Boolean).join(' · ')}
                        </span>
                      </label>
                    </div>
                  </th>
                  {playerStats.columns.map((column) => (
                    <td
                      key={column.key}
                      className="px-3 py-2 text-right text-[13px] font-medium tabular-nums text-[color:var(--trade-text)]"
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
          </tbody>
        </table>
        {visiblePlayers.length === 0 && (
          <p className="bg-[color:var(--trade-surface-subtle)] p-6 text-center text-sm text-[color:var(--trade-text-muted)]">
            {players.length === 0 ? 'No rostered players are available.' : 'No players match.'}
          </p>
        )}
      </div>
    </section>
  );
}

function SortButton({
  label,
  accessibleLabel,
  active,
  direction,
  onClick,
}: {
  label: string;
  accessibleLabel?: string;
  active: boolean;
  direction: 'ascending' | 'descending';
  onClick: () => void;
}): React.JSX.Element {
  const completeLabel = accessibleLabel ?? label;
  const actionLabel = active
    ? `${completeLabel}, sorted ${direction}. Activate to sort ${
        direction === 'ascending' ? 'descending' : 'ascending'
      }.`
    : `${completeLabel}. Activate to sort.`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={actionLabel}
      className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-xs font-bold text-[color:var(--trade-text)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--trade-focus)]"
    >
      <span aria-hidden="true">{label}</span>
      {active &&
        (direction === 'ascending' ? (
          <ArrowUp aria-hidden="true" className="size-3.5 text-[color:var(--trade-action)]" />
        ) : (
          <ArrowDown aria-hidden="true" className="size-3.5 text-[color:var(--trade-action)]" />
        ))}
    </button>
  );
}

function compareNullableNumbers(left: number | null | undefined, right: number | null | undefined) {
  if (typeof left !== 'number') return typeof right === 'number' ? 1 : 0;
  if (typeof right !== 'number') return -1;
  return left - right;
}
