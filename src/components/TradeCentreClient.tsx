'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useDebounce } from '@/hooks/useDebounce';
import type { Player } from '@/types';
import { statLabels, TradeCentreStrings } from '@/lib/constants';

interface TradeCentreClientProps {
  initialPlayers: Player[];
}

export default function TradeCentreClient({ initialPlayers }: TradeCentreClientProps) {
  const [players] = useState<Player[]>(initialPlayers);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const filteredPlayers = useMemo(() => players.filter((player) =>
    player.name.toLowerCase().includes(debouncedSearch.toLowerCase())
  ), [players, debouncedSearch]);

  return (
    <>
      <input
        type="text"
        placeholder={TradeCentreStrings.searchPlaceholder}
        className="mb-8 p-3 border rounded w-full bg-gray-800 border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {filteredPlayers.map((player) => (
          <div key={player.id} className="bg-gray-800 rounded-lg shadow-lg p-4 flex flex-col hover:shadow-blue-500/50 transition-shadow duration-300">
            <Link href={`/players/${player.id}`} className="hover:underline">
              <h2 className="text-xl font-semibold text-blue-400">{player.name}</h2>
            </Link>
            <p className="text-gray-400">
              {player.team} - {player.position}
            </p>
            <ul className="mt-3 space-y-1 text-sm text-gray-300">
              {Object.entries(statLabels).map(([key, label]) => (
                <li key={key} className="flex justify-between">
                  <span>{label}:</span>
                  <span>{player.stats?.[key] ?? '-'}</span>
                </li>
              ))}
            </ul>
            <button className="mt-auto pt-3 w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors duration-300">
              {TradeCentreStrings.tradeButton}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}