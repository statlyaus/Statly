'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useDebounce } from '@/hooks/useDebounce';
import type { Player } from '@/types';
import { statLabels, TradeCentreStrings } from '@/lib/constants';

interface TradeCentreClientProps {
  initialPlayers: Player[];
}

export default function TradeCentreClient({ initialPlayers }: TradeCentreClientProps) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const filteredPlayers = useMemo(
    () =>
      initialPlayers.filter((player) =>
        player.name.toLowerCase().includes(debouncedSearch.toLowerCase())
      ),
    [initialPlayers, debouncedSearch]
  );

  // Placeholder for trade logic
  const handleTradeClick = useCallback((player: Player) => {
    // In a real app, this would likely open a modal or navigate to a trade confirmation screen.
    alert(`Initiating trade for ${player.name}...`);
  }, []);

  return (
    <>
      <input
        type="text"
        placeholder={TradeCentreStrings.searchPlaceholder}
        aria-label="Search for a player"
        className="mb-8 p-3 border rounded w-full bg-gray-800 border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filteredPlayers.length > 0 ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredPlayers.map((player) => (
            <li
              key={player.id}
              className="bg-gray-800 rounded-lg shadow-lg p-4 flex flex-col hover:shadow-blue-500/50 transition-shadow duration-300"
            >
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
              <button
                onClick={() => handleTradeClick(player)}
                className="mt-auto pt-3 w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors duration-300"
              >
                {TradeCentreStrings.tradeButton}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-center text-gray-400 py-10">
          <h3 className="text-xl font-semibold">No players found</h3>
          <p>Try adjusting your search term.</p>
        </div>
      )}
    </>
  );
}