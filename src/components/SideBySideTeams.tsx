'use client';

import React, { useMemo, useState } from 'react';
import type { Player } from '@/types';
import { useTradeStore } from '@/state/tradeStore';

type Dir = 'asc' | 'desc';
type SortKey = 'metresGained' | 'clearances' | 'goals';
type Pos = 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';

interface Props {
  leftTitle: string;
  rightTitle: string;
  leftPlayers: Player[];
  rightPlayers: Player[];
}

function badge(label: string) {
  return (
    <span className="rounded bg-gray-700/60 px-2 py-0.5 text-xs font-semibold text-gray-200">
      {label}
    </span>
  );
}

function valueOrDash(v: number | string | undefined | null) {
  if (v === null || v === undefined || v === '') return '–';
  return v;
}

function getStat(p: Player, key: SortKey): number {
  const raw = p.stats?.[key as keyof NonNullable<Player['stats']>];
  return typeof raw === 'number' ? raw : Number(raw ?? 0);
}

function SortIcon({ dir, active }: { dir: Dir; active: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`ml-1 h-3 w-3 transition-transform ${active && dir === 'desc' ? 'rotate-180' : ''} ${
        active ? 'text-sky-400' : 'text-gray-400'
      }`}
      fill="currentColor"
      aria-hidden
    >
      <path d="M10 3l5 7H5l5-7z" />
    </svg>
  );
}

function SortHeader({
  label,
  sortFor,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortFor: SortKey;
  activeKey: SortKey;
  dir: Dir;
  onSort: (k: SortKey) => void;
}) {
  const active = activeKey === sortFor;
  return (
    <button
      type="button"
      onClick={() => onSort(sortFor)}
      className={`inline-flex items-center text-sm font-semibold transition ${
        active ? 'text-sky-400' : 'text-white/80 hover:text-white'
      }`}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <SortIcon dir={dir} active={active} />
    </button>
  );
}

function Column({
  title,
  players,
  side,
}: {
  title: string;
  players: Player[];
  side: 'incoming' | 'outgoing';
}) {
  const add = useTradeStore((s) => s.add);

  // local UI state per column
  const [pos, setPos] = useState<Pos>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('metresGained');
  const [dir, setDir] = useState<Dir>('desc');

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setDir('desc');
    }
  };

  const filteredSorted = useMemo(() => {
    let list = players;

    if (pos !== 'ALL') {
      list = list.filter((p) => String(p.position ?? '').toUpperCase().includes(pos));
    }

    const sorted = [...list].sort((a, b) => {
      const av = getStat(a, sortKey);
      const bv = getStat(b, sortKey);
      if (av === bv) return a.name.localeCompare(b.name);
      return dir === 'asc' ? av - bv : bv - av;
    });

    return sorted;
  }, [players, pos, sortKey, dir]);

  return (
    <section className="rounded-xl bg-gray-900 ring-1 ring-white/10">
      {/* header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">{title || 'Team'}</h3>
          {badge(`${filteredSorted.length} players`)}
        </div>

        {/* position pills */}
        <div className="hidden sm:flex items-center gap-1">
          {(['ALL', 'DEF', 'MID', 'FWD', 'RUC'] as Pos[]).map((p) => (
            <button
              key={p}
              onClick={() => setPos(p)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                pos === p ? 'bg-white/10 text-white' : 'text-gray-300 hover:text-white hover:bg-white/5'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* sortable header bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-4">
          <SortHeader label="MG" sortFor="metresGained" activeKey={sortKey} dir={dir} onSort={onSort} />
          <SortHeader label="Clr" sortFor="clearances" activeKey={sortKey} dir={dir} onSort={onSort} />
          <SortHeader label="G" sortFor="goals" activeKey={sortKey} dir={dir} onSort={onSort} />
        </div>
        {/* current sort pill */}
        <div className="text-xs text-gray-400">
          Sort: <span className="text-gray-200 font-medium">{sortKey === 'metresGained' ? 'MG' : sortKey === 'clearances' ? 'Clr' : 'G'}</span>{' '}
          <span className="text-gray-200 font-medium">{dir === 'asc' ? '↑' : '↓'}</span>
        </div>
      </div>

      {/* list */}
      <ul className="divide-y divide-white/5">
        {filteredSorted.map((p) => {
          const mg = valueOrDash(p.stats?.metresGained as number | undefined);
          const clr = valueOrDash(p.stats?.clearances as number | undefined);
          const g = valueOrDash(p.stats?.goals as number | undefined);

          return (
            <li key={p.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-white font-medium">{p.name}</div>
                <div className="text-xs text-gray-400">
                  {p.team} {p.position ? '• ' + p.position : ''}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-gray-800 px-2 py-0.5">MG {mg}</span>
                <span className="rounded bg-gray-800 px-2 py-0.5">Clr {clr}</span>
                <span className="rounded bg-gray-800 px-2 py-0.5">G {g}</span>
              </div>

              <div>
                {side === 'incoming' ? (
                  <button
                    onClick={() => add('incoming', p)}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                    aria-label={`Add ${p.name} to Incoming`}
                  >
                    Add In
                  </button>
                ) : (
                  <button
                    onClick={() => add('outgoing', p)}
                    className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
                    aria-label={`Add ${p.name} to Outgoing`}
                  >
                    Add Out
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function SideBySideTeams({
  leftTitle,
  rightTitle,
  leftPlayers,
  rightPlayers,
}: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Column title={leftTitle} players={leftPlayers} side="outgoing" />
      <Column title={rightTitle} players={rightPlayers} side="incoming" />
    </div>
  );
}