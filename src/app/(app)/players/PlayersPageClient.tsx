'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import {
  FANTASY_CATEGORIES,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
}

type SortKey = 'name' | 'games' | FantasyCategoryKey;
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;

const CATEGORY_COLUMNS = REAL_DATA_NINE_CATEGORY_PRESET.map((key) => ({
  key,
  label: FANTASY_CATEGORIES[key].label,
  shortLabel: FANTASY_CATEGORIES[key].shortLabel ?? FANTASY_CATEGORIES[key].label,
}));

function gamesPlayed(player: Player): number {
  const games = (player as Player & { games?: unknown }).games;
  return typeof games === 'number' && games > 0 ? games : 0;
}

/** Season totals divided by games played; null when the player has no games or no value. */
function perGame(player: Player, key: FantasyCategoryKey): number | null {
  const games = gamesPlayed(player);
  const total = Number(player.stats?.[key]);
  if (!games || !Number.isFinite(total)) return null;
  return total / games;
}

function sortValue(player: Player, key: SortKey): string | number | null {
  if (key === 'name') return player.name;
  if (key === 'games') return gamesPlayed(player) || null;
  return perGame(player, key);
}

function formatAverage(value: number | null): string {
  if (value === null) return '–';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function PlayersPageClient({ players }: PlayersPageClientProps) {
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const teams = useMemo(
    () =>
      Array.from(
        new Set(
          players.map((player) => player.team?.trim()).filter((team): team is string => !!team)
        )
      ).sort(),
    [players]
  );

  const season = useMemo(
    () => Math.max(0, ...players.map((player) => player.statsSeason ?? 0)) || null,
    [players]
  );

  const visiblePlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const direction = sortDir === 'asc' ? 1 : -1;

    return players
      .filter(
        (player) =>
          (teamFilter === 'ALL' || player.team === teamFilter) &&
          (normalizedQuery.length === 0 ||
            player.name.toLowerCase().includes(normalizedQuery) ||
            player.team?.toLowerCase().includes(normalizedQuery))
      )
      .sort((a, b) => {
        const aValue = sortValue(a, sortKey);
        const bValue = sortValue(b, sortKey);
        if (aValue === null && bValue === null) return a.name.localeCompare(b.name);
        if (aValue === null) return 1;
        if (bValue === null) return -1;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return (aValue - bValue) * direction || a.name.localeCompare(b.name);
        }
        return String(aValue).localeCompare(String(bValue)) * direction;
      });
  }, [players, teamFilter, query, sortDir, sortKey]);

  const shownPlayers = visiblePlayers.slice(0, visibleCount);
  const nextPageCount = Math.min(PAGE_SIZE, visiblePlayers.length - shownPlayers.length);

  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      // Names read A–Z; games and categories read best first.
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
    setVisibleCount(PAGE_SIZE);
  };

  const ariaSort = (key: SortKey) =>
    key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  const sortButton = (key: SortKey, label: string, content: ReactNode) => (
    <button
      type="button"
      onClick={() => sortBy(key)}
      aria-label={`Sort by ${label}`}
      className="inline-flex min-h-11 items-center gap-1 font-semibold hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
      {key === sortKey ? <span aria-hidden="true">{sortDir === 'asc' ? '▲' : '▼'}</span> : null}
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-[var(--app-shell-max-width)] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Players</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-game averages in the default scoring categories
          {season ? `, ${season} season` : ''}. Select a column to rank players by it.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <label className="relative block">
          <span className="sr-only">Search players</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="Search player or club"
            className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="block">
          <span className="sr-only">Filter by club</span>
          <select
            value={teamFilter}
            onChange={(event) => {
              setTeamFilter(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ALL">All clubs</option>
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shownPlayers.length > 0 ? (
        <>
          <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
            Showing {shownPlayers.length} of {visiblePlayers.length}{' '}
            {visiblePlayers.length === 1 ? 'player' : 'players'}
          </p>
          <div className="relative overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full min-w-[760px] border-collapse text-sm tabular-nums">
              <caption className="sr-only">
                Players with per-game averages in each scoring category
              </caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th
                    scope="col"
                    aria-sort={ariaSort('name')}
                    className="sticky left-0 z-10 bg-muted px-3 text-left"
                  >
                    {sortButton('name', 'name', 'Player')}
                  </th>
                  <th scope="col" aria-sort={ariaSort('games')} className="px-2 text-right">
                    {sortButton('games', 'games played', <abbr title="Games played">GP</abbr>)}
                  </th>
                  {CATEGORY_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={ariaSort(column.key)}
                      className="px-2 text-right"
                    >
                      {sortButton(
                        column.key,
                        column.label,
                        <abbr title={column.label} className="no-underline">
                          {column.shortLabel}
                        </abbr>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownPlayers.map((player) => (
                  <tr key={player.id} className="border-t border-border">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-normal"
                    >
                      <Link
                        href={`/players/${player.id}`}
                        className="font-semibold text-foreground underline decoration-transparent underline-offset-4 hover:decoration-current focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {player.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {[player.team, player.position].filter(Boolean).join(' · ') || 'No club'}
                      </span>
                    </th>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {gamesPlayed(player) || '–'}
                    </td>
                    {CATEGORY_COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className={`px-2 py-2 text-right ${
                          column.key === sortKey
                            ? 'font-semibold text-foreground'
                            : 'text-foreground'
                        }`}
                      >
                        {formatAverage(perGame(player, column.key))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {CATEGORY_COLUMNS.map((column) => (
              <li key={column.key}>
                <span className="font-semibold text-foreground">{column.shortLabel}</span>{' '}
                {column.label}
              </li>
            ))}
          </ul>
          {nextPageCount > 0 ? (
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              className="mx-auto inline-flex h-11 items-center justify-center rounded-md border border-border bg-background px-5 text-sm font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Show {nextPageCount} more {nextPageCount === 1 ? 'player' : 'players'}
            </button>
          ) : null}
        </>
      ) : (
        <section className="rounded-lg border border-border bg-background p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">No players match those filters</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Clear the search field or choose all clubs to see every player.
          </p>
        </section>
      )}
    </div>
  );
}
