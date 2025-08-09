// src/components/SideBySideTeams.tsx
'use client';

import React, { useMemo, useState, useCallback } from 'react';
import type { Player } from '@/types';
import { statLabels } from '@/lib/constants';
import { useTradeStore } from '@/state/tradeStore';

type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
type SortKey = 'name' | 'metresGained' | 'clearances' | 'goals' | 'kicks' | 'scoreInvolvements';
type Dir = 'asc' | 'desc';
type Filters = Record<string, string>;

export default function SideBySideTeams({
  leftTitle,
  rightTitle,
  leftPlayers,
  rightPlayers,
}: {
  leftTitle: string;
  rightTitle: string;
  leftPlayers: Player[];
  rightPlayers: Player[];
}) {
  const add = useTradeStore((s) => s.add);

  // left column UI state
  const [leftPos, setLeftPos] = useState<Pos>('ALL');
  const [leftSortKey, setLeftSortKey] = useState<SortKey>('clearances');
  const [leftSortDir, setLeftSortDir] = useState<Dir>('desc');
  const [leftFiltersOpen, setLeftFiltersOpen] = useState<boolean>(false);
  const [leftPending, setLeftPending] = useState<Filters>({});
  const [leftApplied, setLeftApplied] = useState<Filters>({});

  // right column UI state
  const [rightPos, setRightPos] = useState<Pos>('ALL');
  const [rightSortKey, setRightSortKey] = useState<SortKey>('clearances');
  const [rightSortDir, setRightSortDir] = useState<Dir>('desc');
  const [rightFiltersOpen, setRightFiltersOpen] = useState<boolean>(false);
  const [rightPending, setRightPending] = useState<Filters>({});
  const [rightApplied, setRightApplied] = useState<Filters>({});

  const handleAdd = useCallback(
    (side: 'incoming' | 'outgoing', p: Player) => add(side, p),
    [add]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TeamColumn
        title={leftTitle}
        side="outgoing"
        players={leftPlayers}
        pos={leftPos}
        setPos={setLeftPos}
        sortKey={leftSortKey}
        setSortKey={setLeftSortKey}
        sortDir={leftSortDir}
        setSortDir={setLeftSortDir}
        filtersOpen={leftFiltersOpen}
        setFiltersOpen={setLeftFiltersOpen}
        pending={leftPending}
        setPending={setLeftPending}
        applied={leftApplied}
        setApplied={setLeftApplied}
        onAdd={handleAdd}
      />
      <TeamColumn
        title={rightTitle}
        side="incoming"
        players={rightPlayers}
        pos={rightPos}
        setPos={setRightPos}
        sortKey={rightSortKey}
        setSortKey={setRightSortKey}
        sortDir={rightSortDir}
        setSortDir={setRightSortDir}
        filtersOpen={rightFiltersOpen}
        setFiltersOpen={setRightFiltersOpen}
        pending={rightPending}
        setPending={setRightPending}
        applied={rightApplied}
        setApplied={setRightApplied}
        onAdd={handleAdd}
      />
    </div>
  );
}

/* ---------------------------------- */

function TeamColumn({
  title,
  side,
  players,
  pos,
  setPos,
  sortKey,
  setSortKey,
  sortDir,
  setSortDir,
  filtersOpen,
  setFiltersOpen,
  pending,
  setPending,
  applied,
  setApplied,
  onAdd,
}: {
  title: string;
  side: 'incoming' | 'outgoing';
  players: Player[];
  pos: Pos;
  setPos: (p: Pos) => void;
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
  sortDir: Dir;
  setSortDir: (d: Dir) => void;
  filtersOpen: boolean;
  setFiltersOpen: (b: boolean) => void;
  pending: Filters;
  setPending: React.Dispatch<React.SetStateAction<Filters>>;
  applied: Filters;
  setApplied: React.Dispatch<React.SetStateAction<Filters>>;
  onAdd: (side: 'incoming' | 'outgoing', p: Player) => void;
}) {
  const isDirty = useMemo(() => {
    const keys = new Set([...Object.keys(pending), ...Object.keys(applied)]);
    for (const k of keys) if ((pending[k] ?? '') !== (applied[k] ?? '')) return true;
    return false;
  }, [pending, applied]);

  const filtered = useMemo(() => filterAndSort(players, pos, applied, sortKey, sortDir), [
    players,
    pos,
    applied,
    sortKey,
    sortDir,
  ]);

  const appliedCount = useMemo(
    () => Object.values(applied).filter((v) => v !== '').length,
    [applied]
  );

  const applyFilters = () => setApplied(pending);
  const clearFilters = () => {
    setPending({});
    setApplied({});
  };

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900">
      <header className="flex items-center justify-between gap-2 p-3 border-b border-gray-800">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-xs text-gray-400">{filtered.length} players</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm"
            value={pos}
            onChange={(e) => setPos(e.target.value as Pos)}
            aria-label="Position filter"
          >
            <option value="ALL">All</option>
            <option value="DEF">DEF</option>
            <option value="MID">MID</option>
            <option value="FWD">FWD</option>
            <option value="RUC">RUC</option>
          </select>

          <select
            className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort key"
          >
            <option value="name">Name</option>
            <option value="metresGained">Metres Gained</option>
            <option value="clearances">Clearances</option>
            <option value="goals">Goals</option>
            <option value="kicks">Kicks</option>
            <option value="scoreInvolvements">Score Involvements</option>
          </select>
          <select
            className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as Dir)}
            aria-label="Sort direction"
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>

          <button
            type="button"
            className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm hover:border-blue-500"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
          >
            Filters {appliedCount > 0 ? `(${appliedCount})` : ''}
          </button>
        </div>
      </header>

      {filtersOpen && (
        <div className="p-3 border-b border-gray-800 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(statLabels).map(([key, label]) => (
              <label key={`${title}-${key}`} className="block text-xs">
                <span className="text-gray-400">{label} (min)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  step="any"
                  className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-2 py-1"
                  value={pending[key] ?? ''}
                  onChange={(e) =>
                    setPending((prev) => ({
                      ...prev,
                      [key]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              className="rounded bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 text-sm disabled:opacity-50"
              disabled={!isDirty}
              onClick={applyFilters}
            >
              Apply
            </button>
            <button
              className="rounded bg-gray-800 border border-gray-700 px-3 py-1 text-sm hover:border-blue-500"
              onClick={clearFilters}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-gray-800 max-h-[60vh] overflow-y-auto">
        {filtered.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 p-3">
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-gray-400">
                {p.team} {p.position ? `• ${p.position}` : ''}
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-300">
              <StatBadge label="MG" value={readNumber(p, 'metresGained')} />
              <StatBadge label="Clr" value={readNumber(p, 'clearances')} />
              <StatBadge label="G" value={readNumber(p, 'goals')} />
              <button
                className={`rounded px-2 py-1 ${
                  side === 'incoming'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
                onClick={() => onAdd(side, p)}
              >
                {side === 'incoming' ? 'Add In' : 'Add Out'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------- helpers ---------------------------------- */

function readNumber(p: Player, key: string): number | null {
  const rawTop = (p as unknown as Record<string, unknown>)[key];
  const rawBag = (p.stats as Record<string, unknown> | undefined)?.[key];
  const raw = rawBag ?? rawTop;
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const n = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function playerMatchesPos(p: Player, pos: Pos): boolean {
  if (pos === 'ALL') return true;
  const tag = String(p.position ?? '').toUpperCase();
  return tag.includes(pos);
}

function passesAppliedFilters(p: Player, applied: Filters): boolean {
  for (const [k, minStr] of Object.entries(applied)) {
    if (!minStr) continue;
    const min = parseFloat(minStr);
    if (!Number.isFinite(min)) continue;
    const val = readNumber(p, k);
    if (val == null || val < min) return false;
  }
  return true;
}

function filterAndSort(
  players: Player[],
  pos: Pos,
  applied: Filters,
  sortKey: SortKey,
  sortDir: Dir
): Player[] {
  const filtered = players.filter((p) => playerMatchesPos(p, pos) && passesAppliedFilters(p, applied));
  const arr = [...filtered];
  arr.sort((a, b) => {
    if (sortKey === 'name') {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === 'asc' ? cmp : -cmp;
    }
    const av = readNumber(a, sortKey) ?? -Infinity;
    const bv = readNumber(b, sortKey) ?? -Infinity;
    if (av === bv) return a.name.localeCompare(b.name);
    return sortDir === 'asc' ? av - bv : bv - av;
  });
  return arr;
}

function StatBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-0.5">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums font-semibold">{value ?? '–'}</span>
    </span>
  );
}