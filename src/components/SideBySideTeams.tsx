'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';

type Dir = 'asc' | 'desc';
type SortKey = 'name' | 'metresGained' | 'clearances' | 'goals';
type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
type Filters = Record<string, string>;

function readRaw(p: Player, key: string): unknown {
  const top = (p as unknown as Record<string, unknown>)[key];
  const bag = p.stats?.[key as keyof NonNullable<Player['stats']>];
  return bag ?? top;
}
function readNumber(p: Player, key: string): number | null {
  const v = readRaw(p, key);
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function StatBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums font-semibold">{value ?? '–'}</span>
    </span>
  );
}

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
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <TeamColumn title={leftTitle} side="outgoing" players={leftPlayers} onAdd={() => {}} />
      <TeamColumn title={rightTitle} side="incoming" players={rightPlayers} onAdd={() => {}} />
    </div>
  );
}

function TeamColumn({
  title,
  side,
  players,
  onAdd,
}: {
  title: string;
  side: 'incoming' | 'outgoing';
  players: Player[];
  onAdd: (p: Player) => void;
}) {
  const [pos, setPos] = useState<Pos>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('metresGained');
  const [sortDir, setSortDir] = useState<Dir>('desc');

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pending, setPending] = useState<Filters>({});
  const [applied, setApplied] = useState<Filters>({});

  const appliedCount = useMemo(
    () => Object.values(applied).filter((v) => v !== '').length,
    [applied]
  );

  const filtered = useMemo(() => {
    const byPos =
      pos === 'ALL'
        ? players
        : players.filter((p) => (p.position ? String(p.position).toUpperCase().includes(pos) : false));

    const byMin = byPos.filter((p) => {
      for (const [k, v] of Object.entries(applied)) {
        if (!v) continue;
        const min = Number(v);
        if (!Number.isFinite(min)) continue;
        const val = readNumber(p, k);
        if (val == null || val < min) return false;
      }
      return true;
    });

    const list = [...byMin];
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = readNumber(a, sortKey) ?? -Infinity;
      const bv = readNumber(b, sortKey) ?? -Infinity;
      if (av === bv) return a.name.localeCompare(b.name);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [players, pos, applied, sortKey, sortDir]);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-gray-800 bg-[#1C2430] overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-gray-800">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-gray-100 truncate">{title}</h3>
          <p className="text-xs text-gray-400">{filtered.length} players</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={pos}
            onChange={(e) => setPos(e.target.value as Pos)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            aria-label="Filter by position"
          >
            <option value="ALL">All</option>
            <option value="DEF">DEF</option>
            <option value="MID">MID</option>
            <option value="FWD">FWD</option>
            <option value="RUC">RUC</option>
          </select>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            aria-label="Sort key"
          >
            <option value="name">Name</option>
            <option value="metresGained">Metres Gained</option>
            <option value="clearances">Clearances</option>
            <option value="goals">Goals</option>
          </select>

          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as Dir)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            aria-label="Sort direction"
          >
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>

          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:border-blue-500"
            aria-expanded={filtersOpen}
          >
            Filters ({appliedCount})
          </button>
        </div>
      </header>

      {filtersOpen && (
        <div className="p-3 border-b border-gray-800 space-y-2 bg-gray-900/60">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <FilterInput label="MG (min)" k="metresGained" pending={pending} setPending={setPending} />
            <FilterInput label="Clr (min)" k="clearances" pending={pending} setPending={setPending} />
            <FilterInput label="Goals (min)" k="goals" pending={pending} setPending={setPending} />
            <FilterInput label="Kicks (min)" k="kicks" pending={pending} setPending={setPending} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setApplied(pending)}
              className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
            >
              Apply
            </button>
            <button
              onClick={() => setPending(applied)}
              className="rounded border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-200 hover:border-blue-500"
            >
              Revert edits
            </button>
            <button
              onClick={() => {
                setPending({});
                setApplied({});
              }}
              className="rounded border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-200 hover:border-blue-500"
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-800 bg-gray-900/50">
        {filtered.map((p, idx) => (
          <li
            key={p.id}
            className={`flex items-center justify-between gap-3 p-3 ${
              idx % 2 === 0 ? 'bg-gray-900/60' : 'bg-gray-900/40'
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-gray-100 font-medium text-sm sm:text-base">{p.name}</div>
              <div className="text-xs text-gray-400">
                {p.team} {p.position ? `• ${p.position}` : ''}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 text-xs">
              <StatBadge label="MG" value={readNumber(p, 'metresGained')} />
              <StatBadge label="Clr" value={readNumber(p, 'clearances')} />
              <StatBadge label="G" value={readNumber(p, 'goals')} />

              <button
                className={`rounded px-2 py-1 text-xs sm:text-sm ${
                  side === 'incoming'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
                onClick={() => onAdd(p)}
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

function FilterInput({
  label,
  k,
  pending,
  setPending,
}: {
  label: string;
  k: string;
  pending: Filters;
  setPending: (next: Filters) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        step="any"
        placeholder="—"
        className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={pending[k] ?? ''}
        onChange={(e) => setPending({ ...pending, [k]: e.target.value })}
        aria-label={label}
      />
    </label>
  );
}