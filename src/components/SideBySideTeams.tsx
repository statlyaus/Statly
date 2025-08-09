// src/components/SideBySideTeams.tsx
'use client';

import { useMemo, useState } from 'react';
import type { Player } from '@/types';
import { useTradeStore, type Side } from '@/state/tradeStore';

type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
type Dir = 'asc' | 'desc';
type SortKey = 'metresGained' | 'clearances' | 'goals';

function Badge({
  children,
  title,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-md bg-white/5 px-2 py-1 text-xs font-medium text-gray-200 ring-1 ring-inset ring-white/10"
    >
      {children}
    </span>
  );
}

/* ---------- helpers ---------- */

function posOf(p: Player): Pos {
  const raw = String(p.position ?? '').toUpperCase();
  if (raw.includes('DEF')) return 'DEF';
  if (raw.includes('MID')) return 'MID';
  if (raw.includes('FWD')) return 'FWD';
  if (raw.includes('RUC')) return 'RUC';
  return 'ALL';
}

function readNum(p: Player, key: SortKey): number {
  const v =
    (p.stats?.[key as keyof NonNullable<Player['stats']>] as number | string | undefined) ?? 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Small sort control with three states: none -> desc -> asc -> none */
function SortChip({
  label,
  active,
  dir,
  onChange,
}: {
  label: string;
  active: boolean;
  dir: Dir;
  onChange: (nextActive: boolean, nextDir: Dir) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!active) onChange(true, 'desc');
        else if (dir === 'desc') onChange(true, 'asc');
        else onChange(false, dir);
      }}
      className={`rounded px-2 py-1 text-xs ring-1 transition ${
        active
          ? 'bg-blue-600/20 text-blue-300 ring-blue-600/40'
          : 'bg-white/5 text-gray-300 ring-white/10 hover:bg-white/10'
      }`}
      aria-pressed={active}
    >
      {label} {active ? (dir === 'asc' ? '↑' : '↓') : ''}
    </button>
  );
}

/* ---------- column ---------- */

export type ColumnProps = {
  title: string;
  side: Side;
  players: Player[];
};

export function Column({ title, side, players }: ColumnProps) {
  const add = useTradeStore((s) => s.add);

  const [pos, setPos] = useState<Pos>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('metresGained');
  const [sortActive, setSortActive] = useState<boolean>(true);
  const [dir, setDir] = useState<Dir>('desc');

  const filtered = useMemo(() => {
    let list = pos === 'ALL' ? players : players.filter((p) => posOf(p) === pos);
    if (sortActive) {
      list = [...list].sort((a, b) => {
        const av = readNum(a, sortKey);
        const bv = readNum(b, sortKey);
        if (av === bv) return a.name.localeCompare(b.name);
        return dir === 'desc' ? bv - av : av - bv;
      });
    }
    return list;
  }, [players, pos, sortActive, sortKey, dir]);

  return (
    <section className="flex flex-col rounded-xl bg-gray-900 ring-1 ring-white/10 min-w-[22rem]">
      {/* === Your gradient header, verbatim === */}
      <header className="rounded-t-xl bg-gradient-to-r from-gray-800 to-gray-700 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* Simple avatar/crest with the first letter */}
            <div
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-full bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/30"
            >
              <span className="text-base font-bold">{title?.[0] ?? '?'}</span>
            </div>

            {/* TEAM NAME — no truncate, allow wrap */}
            <h2
              className="min-w-0 text-lg sm:text-xl font-semibold leading-snug text-white break-words whitespace-normal"
              title={title}
            >
              {title}
            </h2>
          </div>

          {/* count */}
          <span className="shrink-0 rounded-md bg-gray-900/40 px-2 py-1 text-xs text-gray-300">
            {filtered.length} players
          </span>
        </div>
      </header>

      {/* controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        {/* position filter */}
        <div className="flex gap-1">
          {(['ALL', 'DEF', 'MID', 'FWD', 'RUC'] as Pos[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setPos(k)}
              className={`rounded px-2 py-1 text-xs ring-1 transition ${
                pos === k
                  ? 'bg-white/20 text-white ring-white/30'
                  : 'bg-white/5 text-gray-300 ring-white/10 hover:bg-white/10'
              }`}
              aria-pressed={pos === k}
            >
              {k}
            </button>
          ))}
        </div>

        {/* sort chips */}
        <div className="flex gap-1">
          <SortChip
            label="MG"
            active={sortActive && sortKey === 'metresGained'}
            dir={dir}
            onChange={(a, d) => {
              setSortActive(a);
              setDir(d);
              setSortKey('metresGained');
            }}
          />
          <SortChip
            label="Clr"
            active={sortActive && sortKey === 'clearances'}
            dir={dir}
            onChange={(a, d) => {
              setSortActive(a);
              setDir(d);
              setSortKey('clearances');
            }}
          />
          <SortChip
            label="G"
            active={sortActive && sortKey === 'goals'}
            dir={dir}
            onChange={(a, d) => {
              setSortActive(a);
              setDir(d);
              setSortKey('goals');
            }}
          />
        </div>
      </div>

      {/* list */}
      <ul className="divide-y divide-white/5 max-h-[70vh] overflow-auto px-2">
        {filtered.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-2 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-white">{p.name}</div>
              <div className="text-xs text-gray-400">
                {String(p.team ?? '')} • {String(p.position ?? '')}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge title="Metres gained">MG {readNum(p, 'metresGained')}</Badge>
              <Badge title="Clearances">Clr {readNum(p, 'clearances')}</Badge>
              <Badge title="Goals">G {readNum(p, 'goals')}</Badge>
              <button
                type="button"
                className={`ml-1 rounded px-3 py-1.5 text-sm font-medium ${
                  side === 'incoming'
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
                onClick={() => add(side, p)}
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

/* ---------- wrapper for two columns ---------- */

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
      <Column title={leftTitle} side="outgoing" players={leftPlayers} />
      <Column title={rightTitle} side="incoming" players={rightPlayers} />
    </div>
  );
}