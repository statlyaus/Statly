'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';
import { useTradeStore } from '@/state/tradeStore';

type Dir = 'asc' | 'desc';
type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
type SortKey = 'name' | 'metresGained' | 'clearances' | 'goals' | 'kicks';
type Filters = Record<string, string>;

function readRaw(p: Player, key: string): unknown {
  const top = (p as unknown as Record<string, unknown>)[key];
  const bag = p.stats?.[key as keyof NonNullable<Player['stats']>];
  return bag ?? top;
}
function readNum(p: Player, key: string): number | null {
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
    <div className="grid gap-6 lg:grid-cols-2">
      <TeamList title={leftTitle} side="outgoing" players={leftPlayers} />
      <TeamList title={rightTitle} side="incoming" players={rightPlayers} />
    </div>
  );
}

function TeamList({
  title,
  side,
  players,
}: {
  title: string;
  side: 'incoming' | 'outgoing';
  players: Player[];
}) {
  const add = useTradeStore((s) => s.add);

  const [pos, setPos] = useState<Pos>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('metresGained');
  const [dir, setDir] = useState<Dir>('desc');

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
        : players.filter((p) =>
            p.position ? String(p.position).toUpperCase().includes(pos) : false
          );

    const byMin = byPos.filter((p) => {
      for (const [k, v] of Object.entries(applied)) {
        if (!v) continue;
        const min = Number(v);
        if (!Number.isFinite(min)) continue;
        const val = readNum(p, k);
        if (val == null || val < min) return false;
      }
      return true;
    });

    const list = [...byMin];
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return dir === 'asc' ? cmp : -cmp;
      }
      const av = readNum(a, sortKey) ?? -Infinity;
      const bv = readNum(b, sortKey) ?? -Infinity;
      if (av === bv) return a.name.localeCompare(b.name);
      return dir === 'asc' ? av - bv : bv - av;
    });

    return list;
  }, [players, pos, applied, sortKey, dir]);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-gray-800 bg-[#121821]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-800">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-gray-100">{title}</h3>
          <p className="text-xs text-gray-400">{filtered.length} players</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={pos}
            onChange={(e) => setPos(e.target.value as Pos)}
            aria-label="Position"
            className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-gray-200"
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
            aria-label="Sort by"
            className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-gray-200"
          >
            <option value="name">Name</option>
            <option value="metresGained">Metres Gained</option>
            <option value="clearances">Clearances</option>
            <option value="goals">Goals</option>
            <option value="kicks">Kicks</option>
          </select>

          <select
            value={dir}
            onChange={(e) => setDir(e.target.value as Dir)}
            aria-label="Direction"
            className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-gray-200"
          >
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>

          <button
            onClick={() => setPending(applied)}
            className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:border-blue-500"
            aria-haspopup="dialog"
            aria-expanded="true"
          >
            Filters ({appliedCount})
          </button>
        </div>
      </div>

      {/* Filters row (always visible = no hidden surprises) */}
      <div className="p-3 border-b border-gray-800 bg-gray-900/40">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="MG ≥" value={pending.metresGained ?? ''} onChange={(v) => setPending({ ...pending, metresGained: v })} />
          <Field label="Clr ≥" value={pending.clearances ?? ''} onChange={(v) => setPending({ ...pending, clearances: v })} />
          <Field label="Goals ≥" value={pending.goals ?? ''} onChange={(v) => setPending({ ...pending, goals: v })} />
          <Field label="Kicks ≥" value={pending.kicks ?? ''} onChange={(v) => setPending({ ...pending, kicks: v })} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setApplied(pending)}
            className="rounded bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 text-xs"
          >
            Apply
          </button>
          <button
            onClick={() => setPending(applied)}
            className="rounded bg-gray-900 border border-gray-700 px-3 py-1 text-xs text-gray-200 hover:border-blue-500"
          >
            Revert
          </button>
          <button
            onClick={() => {
              setPending({});
              setApplied({});
            }}
            className="rounded bg-gray-900 border border-gray-700 px-3 py-1 text-xs text-gray-200 hover:border-blue-500"
          >
            Clear
          </button>
        </div>
      </div>

      {/* List */}
      <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-gray-800">
        {filtered.map((p, i) => (
          <li
            key={p.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 bg-gray-900/30 hover:bg-gray-900/50"
          >
            <div className="min-w-0">
              <div className="truncate text-sm sm:text-base font-medium text-gray-100">{p.name}</div>
              <div className="text-xs text-gray-400">{p.team}{p.position ? ` • ${p.position}` : ''}</div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Badge label="MG" value={readNum(p, 'metresGained')} />
              <Badge label="Clr" value={readNum(p, 'clearances')} />
              <Badge label="G" value={readNum(p, 'goals')} />

              <button
                onClick={() => add(side, p)}
                className={`rounded px-2 py-1 text-xs sm:text-sm ${
                  side === 'incoming'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
                aria-label={side === 'incoming' ? `Add ${p.name} to Incoming` : `Add ${p.name} to Outgoing`}
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

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-gray-400 mb-1">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        step="any"
        placeholder="—"
        className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Badge({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums font-semibold text-gray-100">{value ?? '–'}</span>
    </span>
  );
}