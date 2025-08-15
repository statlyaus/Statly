'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Player } from '@/types/players';
import { useTradeStore, type Side } from '@/state/tradeStore';

type Dir = 'asc' | 'desc';
type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
type SortKey = 'metresGained' | 'clearances' | 'goals';

const STAT_KEYS: Array<{ key: keyof NonNullable<Player['stats']>; label: string }> = [
  { key: 'metresGained', label: 'MG' },
  { key: 'clearances', label: 'Clr' },
  { key: 'goals', label: 'G' },
  { key: 'kicks', label: 'K' },
  { key: 'marks', label: 'M' },
  { key: 'tackles', label: 'Tkl' },
  { key: 'inside50s', label: 'I50' },
  { key: 'rebound50s', label: 'R50' },
  { key: 'scoreInvolvements', label: 'SI' },
  // add more freely…
];

function Badge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex min-w-[56px] items-center justify-center rounded-md bg-white/5 px-2 py-1 text-xs font-medium text-gray-200 ring-1 ring-white/10"
    >
      {children}
    </span>
  );
}

function posOf(p: Player): Pos {
  const raw = String(p.position ?? '').toUpperCase();
  if (raw.includes('DEF')) return 'DEF';
  if (raw.includes('MID')) return 'MID';
  if (raw.includes('FWD')) return 'FWD';
  if (raw.includes('RUC')) return 'RUC';
  return 'ALL';
}

function readNum(p: Player, key: string): number {
  const bag = p.stats as Record<string, unknown> | undefined;
  const v = bag?.[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** naive total value — tune weights to your game */
function totalValue(p: Player): number {
  const mg = readNum(p, 'metresGained');
  const clr = readNum(p, 'clearances');
  const g = readNum(p, 'goals');
  // example: MG 1x, Clr 6x, Goals 10x
  return Math.round(mg * 1 + clr * 6 + g * 10);
}

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

export type ColumnProps = {
  title: string;
  side: Side; // incoming | outgoing
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
    <section className="rounded-xl bg-gray-900 ring-1 ring-white/10">
      {/* Column header with team name big + player count */}
      <header className="rounded-t-xl bg-gradient-to-r from-gray-800 to-gray-700 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-full bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/30"
            >
              <span className="text-base font-bold">{title?.[0] ?? '?'}</span>
            </div>
            <h2
              className="min-w-0 break-words whitespace-normal text-lg font-semibold leading-snug text-white sm:text-xl"
              title={title}
            >
              {title}
            </h2>
          </div>
          <span className="shrink-0 rounded-md bg-gray-900/40 px-2 py-1 text-xs text-gray-300">
            {players.length} players
          </span>
        </div>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
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

      {/* List */}
      <ul className="max-h-[78vh] space-y-2 overflow-auto p-3">
        {filtered.map((p) => {
          const posBadge = String(p.position ?? '');
          const teamBadge = String(p.team ?? '');

          return (
            <li
              key={p.id}
              className="rounded-lg bg-slate-800/60 p-3 ring-1 ring-white/5 hover:bg-slate-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                  <div className="text-xs text-gray-400">
                    {teamBadge} • {posBadge}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge title="Total Value">TV {totalValue(p)}</Badge>
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
              </div>

              {/* Stat chip grid — auto fits 9+ */}
              <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {STAT_KEYS.map(({ key, label }) => (
                  <Badge key={String(key)} title={String(key)}>
                    {label} {readNum(p, String(key))}
                  </Badge>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Convenience wrapper if you ever want to render both in one call */
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
