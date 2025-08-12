'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useDebounce } from '@/hooks/useDebounce';
import type { Player } from '@/types/players';
import { statLabels, TradeCentreStrings } from '@/lib/constants';
import { useTradeStore } from '@/state/tradeStore';

type AnyRecord = Record<string, unknown>;
type Filters = Record<string, string>;

interface TradeCentreClientProps {
  initialPlayers: Player[];
}

/* -------- stat helpers -------- */
function readStatRaw(p: Player, key: string): string | number | undefined {
  const top = (p as unknown as AnyRecord)[key];
  // stats bag is loose Record<string, string|number>
  const bag = (p.stats as Record<string, string | number> | undefined)?.[key];
  if (bag !== undefined) return bag;
  if (typeof top === 'string' || typeof top === 'number') return top;
  return undefined;
}
function readStatNumber(p: Player, key: string): number | null {
  const raw = readStatRaw(p, key);
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function formatValue(v: string | number | undefined): string | number {
  if (v === null || v === undefined || v === '') return '–';
  return v;
}
function StatRow({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <li className="flex justify-between">
      <span>{label}:</span>
      <span className="tabular-nums font-medium">{formatValue(value)}</span>
    </li>
  );
}

/* ---------- component ---------- */
export default function TradeCentreClient({ initialPlayers }: TradeCentreClientProps) {
  const players = initialPlayers;

  // trade store
  const addToOffer = useTradeStore((s) => s.add);

  /* search */
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);

  /* sorting */
  type SortKey = 'name' | 'metresGained' | 'clearances' | 'goals' | 'kicks' | 'scoreInvolvements';
  const [sortKey, setSortKey] = useState<SortKey>('clearances');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc'); // Add this line
  const [applied, setApplied] = useState<Filters>({});

  /* advanced filters */
  const [panelOpen, setPanelOpen] = useState(true);

  const [pending, setPending] = useState<Filters>({});

  const appliedCount = useMemo(
    () => Object.values(applied).filter((v) => v !== '').length,
    [applied]
  );

  const isDirty = useMemo(() => {
    const keys = new Set([...Object.keys(pending), ...Object.keys(applied)]);
    for (const k of keys) if ((pending[k] ?? '') !== (applied[k] ?? '')) return true;
    return false;
  }, [pending, applied]);

  const onPendingChange = useCallback((key: string, val: string) => {
    setPending((prev) => ({ ...prev, [key]: val }));
  }, []);

  const applyFilters = useCallback(() => setApplied(pending), [pending]);
  const clearAll = useCallback(() => {
    setPending({});
    setApplied({});
  }, []);

  // Enter to apply
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && panelOpen && isDirty) applyFilters();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [panelOpen, isDirty, applyFilters]);

  /* list compute (uses *applied*) */
  const filteredPlayers = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();

    const filtered = players.filter((p) => {
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.team ? String(p.team).toLowerCase().includes(q) : false);
      if (!matchesSearch) return false;

      for (const [k, minStr] of Object.entries(applied)) {
        if (!minStr) continue;
        const min = parseFloat(minStr);
        if (!Number.isFinite(min)) continue;
        const val = readStatNumber(p, k);
        if (val == null || val < min) return false;
      }
      return true;
    });

    const list = [...filtered];
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = readStatNumber(a, sortKey) ?? -Infinity;
      const bv = readStatNumber(b, sortKey) ?? -Infinity;
      if (av === bv) return a.name.localeCompare(b.name);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [players, debouncedSearch, applied, sortKey, sortDir]);

  const removeChip = (k: string) => {
    const next = { ...applied };
    delete next[k];
    setApplied(next);
    const nextP = { ...pending };
    delete nextP[k];
    setPending(nextP);
  };

  return (
    <>
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-10 bg-gray-900/90 backdrop-blur supports-[backdrop-filter]:bg-gray-900/60 border-b border-gray-800">
        <div className="mx-auto max-w-7xl p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto] items-end">
          <label className="block">
            <span className="sr-only">Search</span>
            <input
              type="text"
              placeholder={TradeCentreStrings.searchPlaceholder}
              aria-label="Search by name"
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
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
            </div>
          </label>

          <button
            type="button"
            className="p-3 rounded bg-gray-800 border border-gray-700 hover:border-blue-500 text-left"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">Advanced filters</span>
              <span className="text-xs text-gray-400">{appliedCount} active</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Set minimums (e.g., MG ≥ 250, Clearances ≥ 5)
            </div>
          </button>

          <button
            type="button"
            className="p-3 rounded bg-gray-800 border border-gray-700 hover:border-blue-500"
            onClick={clearAll}
          >
            Clear all filters
          </button>
        </div>

        {/* Applied chips */}
        {appliedCount > 0 && (
          <div className="mx-auto max-w-7xl px-4 pb-3 flex flex-wrap gap-2">
            {Object.entries(applied)
              .filter(([, v]) => v !== '')
              .map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-2 rounded-full bg-blue-600/20 text-blue-300 border border-blue-600/40 px-3 py-1 text-xs"
                >
                  <strong className="font-medium">{statLabels[k] ?? k}</strong> ≥ {v}
                  <button
                    className="rounded-full px-1 hover:bg-blue-600/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onClick={() => removeChip(k)}
                    aria-label={`Remove filter ${statLabels[k] ?? k}`}
                  >
                    ×
                  </button>
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Advanced panel (pending inputs) */}
      {panelOpen && (
        <div className="mx-auto max-w-7xl p-4">
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="rounded bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 disabled:opacity-50"
              disabled={!isDirty}
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={() => setPending(applied)}
              className="rounded bg-gray-800 border border-gray-700 px-4 py-2 hover:border-blue-500"
              disabled={!isDirty}
            >
              Revert changes
            </button>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900 p-4">
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
                    value={pending[key] ?? ''}
                    onChange={(e) => onPendingChange(key, e.target.value)}
                    aria-label={`Minimum ${label}`}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="mx-auto max-w-7xl p-4">
        {filteredPlayers.length > 0 ? (
          <ul
            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6"
            aria-label="Filtered players"
          >
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
                    const value = readStatRaw(player, key);
                    return <StatRow key={key} label={label} value={value} />;
                  })}
                </ul>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => addToOffer('incoming', player)}
                    className="w-full bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 transition-colors duration-200"
                    aria-label={`Add ${player.name} to Incoming`}
                  >
                    Add Incoming
                  </button>
                  <button
                    onClick={() => addToOffer('outgoing', player)}
                    className="w-full bg-amber-600 text-white px-3 py-2 rounded hover:bg-amber-700 transition-colors duration-200"
                    aria-label={`Add ${player.name} to Outgoing`}
                  >
                    Add Outgoing
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center text-gray-400 py-10">
            <h3 className="text-xl font-semibold">No players match your filters</h3>
            <p>Try lowering minimums or click “Clear all filters”.</p>
          </div>
        )}
      </div>
    </>
  );
}
