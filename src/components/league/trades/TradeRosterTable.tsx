'use client';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide data tables need a named keyboard-scroll target. */

import { useId, useMemo, useState } from 'react';

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
    <section aria-labelledby={`${id}-heading`} className="min-w-0 rounded-lg border border-border">
      <div className="space-y-3 border-b border-border bg-muted/20 p-3">
        <div>
          <h4 id={`${id}-heading`} className="text-sm font-semibold text-foreground">
            {label}
          </h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div>
          <label htmlFor={`${id}-search`} className="text-xs font-medium text-foreground">
            Search this roster
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            placeholder="Player, club, or position"
          />
        </div>
      </div>

      {/* A focus target is required so keyboard users can scroll the wide data table. */}
      <div
        tabIndex={0}
        aria-label={`${label} roster table, horizontally scrollable`}
        className="max-h-96 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <caption className="sr-only">
            {label}. Season {playerStats.context.season} per-game averages. {selectedIds.length}{' '}
            selected.
          </caption>
          <thead className="sticky top-0 z-20 bg-background">
            <tr className="border-b border-border">
              <th
                scope="col"
                aria-sort={sortKey === 'player' ? sortDirection : 'none'}
                className="sticky left-0 z-30 min-w-52 bg-background px-3 py-2"
              >
                <SortButton label="Player" onClick={() => updateSort('player')} />
              </th>
              {playerStats.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sortKey === column.key ? sortDirection : 'none'}
                  className="min-w-20 px-3 py-2 text-right"
                >
                  <SortButton
                    label={column.shortLabel}
                    accessibleLabel={`${column.label}, ${column.direction === 'LOW_WINS' ? 'lower' : 'higher'} is better`}
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
                <tr key={player.id} className="border-b border-border last:border-0">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 font-normal">
                    <div className="flex items-start gap-2">
                      <input
                        id={`${id}-player-${player.id}`}
                        type="checkbox"
                        checked={selected}
                        disabled={disabled}
                        onChange={() => togglePlayer(player.id)}
                        className="mt-0.5 size-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <label
                        htmlFor={`${id}-player-${player.id}`}
                        className="min-w-0 cursor-pointer"
                      >
                        <span className="block font-medium text-foreground">{player.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[player.position, player.club].filter(Boolean).join(' · ')}
                        </span>
                      </label>
                    </div>
                  </th>
                  {playerStats.columns.map((column) => (
                    <td
                      key={column.key}
                      className="px-3 py-2 text-right tabular-nums text-foreground"
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
          <p className="p-5 text-center text-sm text-muted-foreground">
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
  onClick,
}: {
  label: string;
  accessibleLabel?: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 items-center rounded px-1 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden={Boolean(accessibleLabel)}>{label}</span>
      {accessibleLabel && <span className="sr-only">{accessibleLabel}</span>}
    </button>
  );
}

function compareNullableNumbers(left: number | null | undefined, right: number | null | undefined) {
  if (typeof left !== 'number') return typeof right === 'number' ? 1 : 0;
  if (typeof right !== 'number') return -1;
  return left - right;
}
