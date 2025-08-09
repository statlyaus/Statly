// src/components/SideBySideTeams.tsx
'use client';

import React, { useMemo, useState } from 'react';
import type { Player } from '@/types';
import { useTradeStore } from '@/state/tradeStore';
import { statLabels } from '@/lib/constants';

type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
type SortKey = 'name' | 'metresGained' | 'clearances' | 'scoreInvolvements';
type Dir = 'asc' | 'desc';
type Filters = Record<string, string>;

export type SideBySideTeamsProps = {
  leftTitle: string;
  rightTitle: string;
  leftPlayers: Player[];
  rightPlayers: Player[];
};

export default function SideBySideTeams({
  leftTitle,
  rightTitle,
  leftPlayers,
  rightPlayers,
}: SideBySideTeamsProps) {
  const add = useTradeStore((s) => s.add);

  // LEFT state
  const [leftPos, setLeftPos] = useState<Pos>('ALL');
  const [leftSort, setLeftSort] = useState<SortKey>('metresGained');
  const [leftDir, setLeftDir] = useState<Dir>('desc');
  const [leftFiltersOpen, setLeftFiltersOpen] = useState<boolean>(false);
  const [leftPending, setLeftPending] = useState<Filters>({});
  const [leftApplied, setLeftApplied] = useState<Filters>({});

  // RIGHT state
  const [rightPos, setRightPos] = useState<Pos>('ALL');
  const [rightSort, setRightSort] = useState<SortKey>('metresGained');
  const [rightDir, setRightDir] = useState<Dir>('desc');
  const [rightFiltersOpen, setRightFiltersOpen] = useState<boolean>(false);
  const [rightPending, setRightPending] = useState<Filters>({});
  const [rightApplied, setRightApplied] = useState<Filters>({});

  const leftList = useTeamList(leftPlayers, leftPos, leftSort, leftDir, leftApplied);
  const rightList = useTeamList(rightPlayers, rightPos, rightSort, rightDir, rightApplied);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <TeamColumn
        title={leftTitle}
        side="outgoing"
        players={leftList}
        pos={leftPos}
        setPos={setLeftPos}
        sortKey={leftSort}
        setSortKey={setLeftSort}
        sortDir={leftDir}
        setSortDir={setLeftDir}
        filtersOpen={leftFiltersOpen}
        setFiltersOpen={setLeftFiltersOpen}
        pending={leftPending}
        setPending={setLeftPending}
        applied={leftApplied}
        setApplied={setLeftApplied}
        onAdd={add}
      />

      <TeamColumn
        title={rightTitle}
        side="incoming"
        players={rightList}
        pos={rightPos}
        setPos={setRightPos}
        sortKey={rightSort}
        setSortKey={setRightSort}
        sortDir={rightDir}
        setSortDir={setRightDir}
        filtersOpen={rightFiltersOpen}
        setFiltersOpen={setRightFiltersOpen}
        pending={rightPending}
        setPending={setRightPending}
        applied={rightApplied}
        setApplied={setRightApplied}
        onAdd={add}
      />
    </div>
  );
}

/* ---------------- logic ---------------- */

function useTeamList(
  players: Player[],
  pos: Pos,
  sortKey: SortKey,
  sortDir: Dir,
  filters: Filters
) {
  return useMemo(() => {
    // position filter
    const byPos =
      pos === 'ALL'
        ? players
        : players.filter((p) =>
            String(p.position ?? '').toUpperCase().includes(pos)
          );

    // advanced stat filters (min values)
    const byStats = byPos.filter((p) => matchesFilters(p, filters));

    // sort
    const list = [...byStats];
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = getNum(a, sortKey);
      const bv = getNum(b, sortKey);
      if (av === bv) return a.name.localeCompare(b.name);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [players, pos, sortKey, sortDir, filters]);
}

function matchesFilters(p: Player, filters: Filters): boolean {
  for (const [k, minStr] of Object.entries(filters)) {
    if (!minStr) continue;
    const min = parseFloat(minStr);
    if (!Number.isFinite(min)) continue;
    const v = getNum(p, k);
    if (!Number.isFinite(v) || v < min) return false;
  }
  return true;
}

function getNum(p: Player, key: string): number {
  const top = (p as unknown as Record<string, unknown>)[key];
  const bag = p.stats && (p.stats as Record<string, unknown>)[key];
  const v = typeof bag !== 'undefined' ? bag : top;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'number' && !Number.isFinite(v)) return '–';
  return String(v);
}

/* ---------------- UI ---------------- */

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
  setPending: (f: Filters) => void;
  applied: Filters;
  setApplied: (f: Filters) => void;
  onAdd: (side: 'incoming' | 'outgoing', p: Player) => void;
}) {
  const appliedCount = Object.values(applied).filter((v) => v !== '').length;
  const isDirty =
    Object.keys({ ...pending, ...applied }).some(
      (k) => (pending[k] ?? '') !== (applied[k] ?? '')
    );

  return (
    <section className="min-h-0 rounded-xl border border-gray-800 bg-gray-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <h3 className="text-lg font-semibold">{title}</h3>

        <div className="flex items-center gap-2 text-sm">
          <PosChipGroup value={pos} onChange={setPos} />

          <label className="sr-only" htmlFor={`${title}-sort-key`}>
            Sort key
          </label>
          <select
            id={`${title}-sort-key`}
            className="rounded bg-gray-800 px-2 py-1 border border-gray-700"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="metresGained">MG</option>
            <option value="clearances">CLR</option>
            <option value="scoreInvolvements">SI</option>
            <option value="name">Name</option>
          </select>

          <label className="sr-only" htmlFor={`${title}-sort-dir`}>
            Sort direction
          </label>
          <select
            id={`${title}-sort-dir`}
            className="rounded bg-gray-800 px-2 py-1 border border-gray-700"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as Dir)}
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>

          <button
            type="button"
            className="rounded bg-gray-800 px-3 py-1 border border-gray-700 hover:border-blue-500"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
          >
            Filters
            {appliedCount > 0 && (
              <span className="ml-2 rounded-full bg-blue-600/30 px-2 py-0.5 text-xs text-blue-300">
                {appliedCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Applied chips */}
      {appliedCount > 0 && (
        <div className="px-4 pt-2 flex flex-wrap gap-2">
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
                  onClick={() => {
                    const next = { ...applied };
                    delete next[k];
                    setApplied(next);
                    const nextP = { ...pending };
                    delete nextP[k];
                    setPending(nextP);
                  }}
                  aria-label={`Remove filter ${statLabels[k] ?? k}`}
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}

      {/* Filter panel */}
      {filtersOpen && (
        <div className="px-4 pb-3">
          <div className="my-2 flex gap-2">
            <button
              type="button"
              onClick={() => setApplied(pending)}
              className="rounded bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 disabled:opacity-50"
              disabled={!isDirty}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setPending(applied)}
              className="rounded bg-gray-800 border border-gray-700 px-3 py-1 hover:border-blue-500 disabled:opacity-50"
              disabled={!isDirty}
            >
              Revert
            </button>
            <button
              type="button"
              onClick={() => {
                setPending({});
                setApplied({});
              }}
              className="ml-auto rounded bg-gray-800 border border-gray-700 px-3 py-1 hover:border-blue-500"
            >
              Clear filters
            </button>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900 p-3">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
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
                    onChange={(e) =>
                      setPending((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    aria-label={`Minimum ${label}`}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="max-h-[56vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur">
            <tr className="text-gray-400">
              <th className="px-4 py-2 text-left w-full">Player</th>
              <th className="px-2 py-2 text-right">MG</th>
              <th className="px-2 py-2 text-right">CLR</th>
              <th className="px-2 py-2 text-right">SI</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const mg = getNum(p, 'metresGained');
              const clr = getNum(p, 'clearances');
              const si = getNum(p, 'scoreInvolvements');

              return (
                <tr key={p.id} className="border-t border-gray-800">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-400">
                      {p.team} {p.position ? `• ${p.position}` : ''}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(mg)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(clr)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmt(si)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => onAdd(side, p)}
                      className={`rounded px-3 py-1 text-white ${
                        side === 'incoming'
                          ? 'bg-blue-600 hover:bg-blue-700'
                          : 'bg-amber-600 hover:bg-amber-700'
                      }`}
                      aria-label={`Add ${p.name} to ${side}`}
                    >
                      {side === 'incoming' ? 'Add In' : 'Add Out'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {players.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No players match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PosChipGroup({
  value,
  onChange,
}: {
  value: Pos;
  onChange: (p: Pos) => void;
}) {
  const opts: Pos[] = ['ALL', 'DEF', 'MID', 'FWD', 'RUC'];
  return (
    <div role="tablist" aria-label="Filter by position" className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o}
          role="tab"
          aria-selected={value === o}
          onClick={() => onChange(o)}
          className={`rounded px-2 py-1 border ${
            value === o
              ? 'bg-gray-700 border-gray-600 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-800/70'
          }`}
        >
          {o}
      </button>
      ))}
    </div>
  );
}