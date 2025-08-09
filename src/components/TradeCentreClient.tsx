'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useDebounce } from '@/Hooks/useDebounce';
import type { Player } from '@/types';
import { statLabels, TradeCentreStrings } from '@/lib/constants';

type Filters = Record<string, string>; // min value text per stat key

interface TradeCentreClientProps {
  initialPlayers: Player[];
}

/** Allow accessing unknown top-level props safely */
type AnyRecord = Record<string, unknown>;
/** Players may carry a stats bag shaped as key->value */
type StatBag = Record<string, number | string | null | undefined>;
interface PlayerWithStats extends Player {
  stats?: StatBag;
}

/** Safely fetch a stat value and coerce to number. */
function readStatNumber(p: PlayerWithStats, key: string): number | null {
  const top = (p as AnyRecord)[key];
  const bag = p.stats?.[key];
  const raw = bag ?? top;

  if (raw == null) return null;

  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    // strip non-numeric chars; '-' at end of class so no escape warning
    const cleaned = raw.replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function formatValue(v: unknown): string | number {
  if (v === null || v === undefined || v === '') return '–';
  return typeof v === 'number' ? v : String(v);
}

function StatRow({ label, value }: { label: string; value: unknown }) {
  return (
    <li className="flex justify-between">
      <span>{label}:</span>
      <span className="tabular-nums font-medium">{formatValue(value)}</span>
    </li>
  );
}

export default function TradeCentreClient({ initialPlayers }: TradeCentreClientProps) {
  const players = initialPlayers as PlayerWithStats[];

  // --- toolbar state ---
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filters, setFilters] = useState<Filters>({});

  // sorting
  type SortKey =
    | 'name'
    | 'metresGained'
    | 'clearances'
    | 'goals'
    | 'kicks'
    | 'scoreInvolvements';
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter((v) => v !== '').length,
    [filters]
  );

  const onFilterChange = useCallback((key: string, val: string) => {
    setFilters((prev) => ({ ...prev, [key]: val }));
  }, []);

  const clearAllFilters = useCallback(() => setFilters({}), []);

  // --- filtering & sorting ---
  const filteredPlayers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();

    const filtered = players.filter((p) => {
      // search by name or team
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.team ? String(p.team).toLowerCase().includes(q) : false);

      if (!matchesSearch) return false;

      // numeric min filters – ALL must pass
      for (const [k, minStr] of Object.entries(filters)) {
        if (!minStr) continue;
        const min = parseFloat(minStr);
        if (!Number.isFinite(min)) continue; // ignore junk

        const val = readStatNumber(p, k);
        if (val == null || val < min) return false;
      }

      return true;
    });

    // sort
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = readStatNumber(a, sortKey) ?? -Infinity;
      const bv = readStatNumber(b, sortKey) ?? -Infinity;
      if (av === bv) return a.name.localeCompare(b.name); // tie-breaker
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return copy;
  }, [players, debouncedSearch, filters, sortKey, sortDir]);

  // Placeholder for trade logic
  const handleTradeClick = useCallback((player: Player) => {
    alert(`Initiating trade for ${player.name}...`);
  }, []);

  return (
    <>
      {/* Toolbar */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
        <label className="block">
          <span className="sr-only">Search</span>
          <input
            type="text"
            placeholder={TradeCentreStrings.searchPlaceholder}
            aria-label="Search for a player"
            className="p-3 border rounded w-full bg-gray-800 border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">Sort by</span>
          <div className="flex gap-2">
            <select
              className="p-3 border rounded w-full bg-gray-800 border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort key"
            >
              <option value="name">Name (A–Z)</option>
              <option value="metresGained">Metres Gained</option>
              <option value="clearances">Clearances</option>
              <option value="goals">Goals</option>
              <option value="kicks">Kicks</option>
              <option value="scoreInvolvements">Score Involvements</option>
            </select>
            <select
              className="p-3 border rounded bg-gray-800 border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
              aria-label="Sort direction"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </div>
        </label>

        <button
          type="button"
          className="p-3 rounded bg-gray-800 border border-gray-700 hover:border-blue-500 text-left"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Advanced filters</span>
            <span className="text-xs text-gray-400">
              {activeFilterCount ? `${activeFilterCount} active` : 'none'}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Set minimum values for any stat (e.g., MG ≥ 250, Clearances ≥ 5)
          </div>
        </button>

        <button
          type="button"
          className="p-3 rounded bg-gray-800 border border-gray-700 hover:border-blue-500"
          onClick={clearAllFilters}
        >
          Clear all filters
        </button>
      </div>

      {/* Advanced filter panel */}
      {showAdvanced && (
        <div className="mb-6 rounded-lg border border-gray-700 bg-gray-900 p-4">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Object.entries(statLabels).map(([key, label]) => (
              <label key={key} className="block">
                <span className="block text-xs text-gray-400 mb-1">
                  {label} <span className="text-gray-500">(min)</span>
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  step="any"
                  placeholder="—"
                  className="p-2 border rounded w-full bg-gray-800 border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filters[key] ?? ''}
                  onChange={(e) => onFilterChange(key, e.target.value)}
                  aria-label={`Minimum ${label}`}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {filteredPlayers.length > 0 ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6" aria-label="Filtered players">
          {filteredPlayers.map((player) => (
            <li
              key={player.id}
              className="bg-gray-800 rounded-lg shadow-lg p-4 flex flex-col hover:shadow-blue-500/50 transition-shadow duration-300"
            >
              <Link href={`/players/${player.id}`} className="hover:underline">
                <h2 className="text-xl font-semibold text-blue-400">{player.name}</h2>
              </Link>
              <p className="text-gray-400">
                {player.team} {player.position ? `- ${player.position}` : ''}
              </p>

              <ul className="mt-3 space-y-1 text-sm text-gray-300">
                {Object.entries(statLabels).map(([key, label]) => {
                  const value =
                    (player.stats && player.stats[key] != null
                      ? player.stats[key]
                      : (player as AnyRecord)[key]) ?? '–';
                  return <StatRow key={key} label={label} value={value} />;
                })}
              </ul>

              <button
                onClick={() => handleTradeClick(player)}
                className="mt-auto pt-3 w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors duration-300"
              >
                {TradeCentreStrings.tradeButton}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-center text-gray-400 py-10">
          <h3 className="text-xl font-semibold">No players match your filters</h3>
          <p>Try lowering minimums or clearing filters.</p>
        </div>
      )}
    </>
  );
}