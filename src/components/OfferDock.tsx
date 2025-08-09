// src/components/OfferDock.tsx
'use client';

import * as React from 'react';
import { useRankings } from '@/app/tradecentre/RankingsContext';

type PlayerLite = {
  id: string;
  name: string;
  team?: string;
  [key: string]: unknown;
};

type OfferDockProps = {
  players: PlayerLite[];
} & Record<string, unknown>;

/** Small badge showing Rank + Total Value; renders nothing if not found. */
function ValueChip({ playerId, compact = false }: { playerId: string; compact?: boolean }) {
  const rankings = useRankings();
  const data = rankings.get(String(playerId));
  if (!data) return null;

  const { rank, totalValue } = data;
  const label = `Rank ${rank}, total value ${totalValue.toFixed(2)}`;

  return (
    <span
      role="status"
      aria-label={label}
      className={
        compact
          ? 'ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
          : 'ml-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200'
      }
      title={label}
    >
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" className="-mt-px">
        <path d="M12 2l3 7h7l-5.5 4.1L18 21l-6-3.8L6 21l1.5-7.9L2 9h7z" />
      </svg>
      <span className="tabular-nums">#{rank}</span>
      <span className="opacity-60">•</span>
      <span className="tabular-nums">{totalValue.toFixed(2)}</span>
    </span>
  );
}

type SortKey = 'name' | 'team' | 'rank' | 'totalValue';
type SortDir = 'asc' | 'desc';

export default function OfferDock({ players, ...rest }: OfferDockProps) {
  const rankings = useRankings();

  // Sorting state (default: by total value, descending)
  const [sortKey, setSortKey] = React.useState<SortKey>('totalValue');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');

  // Decorate players with ranking info (if available), then sort
  const sorted = React.useMemo(() => {
    const rows = players.map((p) => {
      const r = rankings.get(String(p.id));
      return {
        ...p,
        _rank: r?.rank ?? Number.POSITIVE_INFINITY, // missing ranks go last
        _value: r?.totalValue ?? Number.NEGATIVE_INFINITY, // for desc sort, missing go last
      };
    });

    rows.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'team':
          return (a.team ?? '').localeCompare(b.team ?? '') * dir;
        case 'rank':
          // Smaller rank is better
          return ((a._rank as number) - (b._rank as number)) * dir;
        case 'totalValue':
        default:
          return ((a._value as number) - (b._value as number)) * dir;
      }
    });

    return rows;
  }, [players, rankings, sortKey, sortDir]);

  // Handlers
  function onSortKeyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const key = e.target.value as SortKey;
    setSortKey(key);
    // sensible default dir per key
    if (key === 'rank') setSortDir('asc');
    else if (key === 'totalValue') setSortDir('desc');
  }
  function onSortDirToggle() {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  }

  return (
    <section aria-label="Offer Dock" className="rounded-xl border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-3">
        <h2 className="text-sm font-semibold">Your Offer</h2>

        {/* Sorting controls */}
        <form
          className="flex items-center gap-2 text-xs"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Sort players"
        >
          <label htmlFor="od-sort-key" className="text-gray-600">
            Sort by
          </label>
          <select
            id="od-sort-key"
            value={sortKey}
            onChange={onSortKeyChange}
            className="rounded border border-gray-300 bg-white px-2 py-1"
          >
            <option value="totalValue">Total Value</option>
            <option value="rank">Rank</option>
            <option value="name">Name</option>
            <option value="team">Team</option>
          </select>

          <button
            type="button"
            onClick={onSortDirToggle}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
            aria-label={`Toggle sort direction (currently ${sortDir})`}
            title={`Toggle sort direction (currently ${sortDir})`}
          >
            <span className="capitalize">{sortDir}</span>
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24">
              {sortDir === 'asc' ? (
                <path d="M7 14l5-5 5 5H7z" />
              ) : (
                <path d="M7 10l5 5 5-5H7z" />
              )}
            </svg>
          </button>
        </form>
      </header>

      <ul role="list" className="divide-y divide-gray-100">
        {sorted.map((player) => (
          <li key={String(player.id)} className="flex items-center justify-between px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-baseline">
                <span className="truncate text-sm font-medium">{String(player.name)}</span>
                <ValueChip playerId={String(player.id)} compact />
              </div>
              {player.team ? (
                <div className="text-xs text-gray-500">{String(player.team)}</div>
              ) : null}
            </div>

            <div className="ml-3 flex items-center gap-2">
              {/* right-side actions (left as-is) */}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}