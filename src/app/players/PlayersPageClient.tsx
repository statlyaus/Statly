'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
}

export default function PlayersPageClient({ players }: PlayersPageClientProps) {
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedPlayers = useMemo(() => {
    const getVal = (p: Player) =>
      (p as unknown as Record<string, unknown>)[sortKey] ??
      p.stats?.[sortKey];
    return [...players].sort((a, b) => {
      const aVal = getVal(a);
      const bVal = getVal(b);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDir === 'asc' ? 1 : -1;
      if (bVal == null) return sortDir === 'asc' ? -1 : 1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [players, sortKey, sortDir]);

  if (!sortedPlayers.length) {
    return <p className="p-4">No players found.</p>;
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">All Players</h1>
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="sortKey" className="text-sm font-medium">
          Sort by:
        </label>
        <select
          id="sortKey"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="border rounded p-1 text-sm"
        >
          <option value="name">Name</option>
          <option value="team">Team</option>
          <option value="position">Position</option>
          <option value="goals">Goals</option>
          <option value="kicks">Kicks</option>
          <option value="handballs">Handballs</option>
          <option value="marks">Marks</option>
          <option value="tackles">Tackles</option>
        </select>
        <button
          type="button"
          onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          className="border rounded p-1 text-sm"
        >
          {sortDir === 'asc' ? '⬆️' : '⬇️'}
        </button>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedPlayers.map((player) => (
          <li key={player.id} className="border rounded-lg p-4 hover:shadow-lg transition">
            <h2 className="text-lg font-semibold">{player.name}</h2>
            <p className="text-sm text-gray-600">
              {player.team} — {player.position}
            </p>
            {sortKey !== 'name' && (
              <p className="mt-1 text-sm">
                {(
                  (player as unknown as Record<string, unknown>)[sortKey] ??
                  player.stats?.[sortKey] ??
                  '-'
                ) as string | number}
              </p>
            )}
            <Link
              href={`/players/${player.id}`}
              className="text-blue-600 hover:underline text-sm mt-2 inline-block"
            >
              View Profile →
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
