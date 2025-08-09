'use client';

import { useMemo } from 'react';
import type { Player } from '@/types';

type Props = {
  my: Player[];
  theirs: Player[];
  sortKey: 'name' | 'metresGained' | 'clearances' | 'goals';
  sortDir: 'asc' | 'desc';
  filterPos: 'ALL' | 'DEF' | 'MID' | 'FWD' | 'RUC';
};

function posMatches(p: Player, filter: Props['filterPos']) {
  if (filter === 'ALL') return true;
  return (p.position ?? '').toUpperCase().includes(filter);
}

function num(p: Player, key: Props['sortKey']) {
  if (key === 'name') return null;
  const v = (p.stats as Record<string, string | number> | undefined)?.[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export default function SideBySideTeams({
  my,
  theirs,
  sortKey,
  sortDir,
  filterPos,
}: Props) {
  const mine = useMemo(() => {
    const list = my.filter((p) => posMatches(p, filterPos));
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = num(a, sortKey) ?? -Infinity;
      const bv = num(b, sortKey) ?? -Infinity;
      if (av === bv) return a.name.localeCompare(b.name);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [my, sortKey, sortDir, filterPos]);

  const theirsSorted = useMemo(() => {
    const list = theirs.filter((p) => posMatches(p, filterPos));
    list.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = num(a, sortKey) ?? -Infinity;
      const bv = num(b, sortKey) ?? -Infinity;
      if (av === bv) return a.name.localeCompare(b.name);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [theirs, sortKey, sortDir, filterPos]);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <RosterCard title="Your Roster" players={mine} />
      <RosterCard title="Target Roster" players={theirsSorted} />
    </div>
  );
}

function RosterCard({ title, players }: { title: string; players: Player[] }) {
  return (
    <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
      <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
      {players.length === 0 ? (
        <div className="text-gray-500 text-sm">No players</div>
      ) : (
        <ul className="divide-y divide-gray-800">
          {players.map((p) => (
            <li key={p.id} className="py-2 flex items-baseline justify-between">
              <div>
                <div className="text-blue-300 font-medium">{p.name}</div>
                <div className="text-xs text-gray-400">
                  {p.team} {p.position ? `• ${p.position}` : ''}
                </div>
              </div>
              <div className="text-sm text-gray-300 tabular-nums">
                {(p.stats as Record<string, string | number> | undefined)?.metresGained ?? '–'} MG
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}