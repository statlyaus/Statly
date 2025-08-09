'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';
import { useTradeStore } from '@/state/tradeStore';

/** positions, sorting, directions */
type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
type Dir = 'asc' | 'desc';
type SortKey = 'name' | 'metresGained' | 'clearances' | 'goals' | 'kicks' | 'scoreInvolvements';
type Filters = Record<string, string>;

type Props = {
  leftTitle: string;
  rightTitle: string;
  leftPlayers: Player[];
  rightPlayers: Player[];
};

/** Which stats can be filtered (min values) */
const FILTERABLE_STATS: Array<{ key: string; label: string }> = [
  { key: 'metresGained', label: 'Metres Gained' },
  { key: 'clearances', label: 'Clearances' },
  { key: 'goals', label: 'Goals' },
  { key: 'kicks', label: 'Kicks' },
  { key: 'handballs', label: 'Handballs' },
  { key: 'marks', label: 'Marks' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'inside50s', label: 'Inside 50s' },
  { key: 'rebound50s', label: 'Rebound 50s' },
  { key: 'scoreInvolvements', label: 'Score Involvements' },
  { key: 'intercepts', label: 'Intercepts' },
];

export default function SideBySideTeams({
  leftTitle,
  rightTitle,
  leftPlayers,
  rightPlayers,
}: Props) {
  const addToOffer = useTradeStore((s) => s.add);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <TeamColumn
        title={leftTitle}
        side="outgoing"
        players={leftPlayers}
        onAdd={(p) => addToOffer('outgoing', p)}
      />
      <TeamColumn
        title={rightTitle}
        side="incoming"
        players={rightPlayers}
        onAdd={(p) => addToOffer('incoming', p)}
      />
    </div>
  );
}

/* ----------------- TeamColumn ----------------- */

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
  // pos, sorting, and filters state (with Apply)
  const [pos, setPos] = useState<Pos>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('metresGained');
  const [sortDir, setSortDir] = useState<Dir>('desc');

  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [pending, setPending] = useState<Filters>({});
  const [applied, setApplied] = useState<Filters>({});

  const appliedCount = useMemo(
    () => Object.values(applied).filter((v) => v !== '').length,
    [applied]
  );

  const filtered = useMemo(() => {
    let list = players;

    // position gate (if position present on player)
    if (pos !== 'ALL') {
      list = list.filter((p) => (p.position ? String(p.position).toUpperCase().includes(pos) : true));
    }

    // numeric minimum filters
    for (const [k, v] of Object.entries(applied)) {
      if (!v) continue;
      const min = parseFloat(v);
      if (!Number.isFinite(min)) continue;
      list = list.filter((p) => {
        const val = readNumber(p, k);
        return val != null && val >= min;
      });
    }

    // sort
    list = [...list].sort((a, b) => {
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
    <section className="rounded-xl border border-gray-800 bg-[#1C2430]">
      <header className="flex flex-wrap items-center justify-between gap-3 p-3 border-b border-gray-800">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-100">{title}</h3>
          <p className="text-xs text-gray-400">{filtered.length} players</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="min-w-[84px] rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-100"
            value={pos}
            onChange={(e) => setPos(e.target.value as Pos)}
          >
            <option value="ALL">All</option>
            <option value="DEF">DEF</option>
            <option value="MID">MID</option>
            <option value="FWD">FWD</option>
            <option value="RUC">RUC</option>
          </select>

          <select
            className="min-w-[150px] rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-100"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="name">Name</option>
            <option value="metresGained">Metres Gained</option>
            <option value="clearances">Clearances</option>
            <option value="goals">Goals</option>
            <option value="kicks">Kicks</option>
            <option value="scoreInvolvements">Score Involvements</option>
          </select>

          <select
            className="min-w-[90px] rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-100"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as Dir)}
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>

          <button
            type="button"
            className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-sm text-gray-100 hover:border-blue-500"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
          >
            Filters {appliedCount > 0 ? `(${appliedCount})` : ''}
          </button>
        </div>
      </header>

      {filtersOpen && (
        <div className="p-3 border-b border-gray-800 space-y-2 bg-gray-900/60">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERABLE_STATS.map(({ key, label }) => (
              <label key={key} className="text-xs text-gray-300">
                <span className="mr-1 text-gray-400">{label}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  step="any"
                  placeholder="min"
                  className="w-20 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 text-sm disabled:opacity-50"
              onClick={() => setApplied(pending)}
              disabled={
                JSON.stringify(pending ?? {}) === JSON.stringify(applied ?? {})
              }
            >
              Apply
            </button>
            <button
              type="button"
              className="rounded bg-gray-800 border border-gray-700 px-3 py-1 text-sm text-gray-100 hover:border-blue-500"
              onClick={() => {
                setPending({});
                setApplied({});
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-gray-800 max-h-[60vh] overflow-y-auto bg-gray-900/50">
        {filtered.map((p, idx) => (
          <li
            key={p.id}
            className={`flex items-center justify-between gap-3 p-3 ${
              idx % 2 === 0 ? 'bg-gray-900/60' : 'bg-gray-900/40'
            }`}
          >
            <div className="min-w-0">
              <div className="truncate text-gray-100 font-medium text-sm sm:text-base">
                {p.name}
              </div>
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

/* ----------------- helpers ----------------- */

function StatBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-800/80 px-2 py-0.5">
      <span className="text-gray-400">{label}</span>
      <span className="tabular-nums font-semibold text-gray-100">{value ?? '–'}</span>
    </span>
  );
}

function readNumber(p: Player, key: string): number | null {
  // prefer nested stats, fallback to top-level if numeric
  const stats = (p as unknown as { stats?: Record<string, unknown> }).stats;
  const bag = stats?.[key];
  const top = (p as unknown as Record<string, unknown>)[key];

  const raw = bag ?? top;
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