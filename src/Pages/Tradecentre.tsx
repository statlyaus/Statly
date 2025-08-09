// src/app/tradecentre/page.tsx
export const runtime = 'nodejs';

import React from 'react';
import Link from 'next/link';
import { getPlayers } from '@/lib/data';

export default async function Tradecentre() {
  const players = await getPlayers();

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-white">Trade Centre</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {players.map((player) => (
          <div
            key={player.id}
            className="bg-gray-800 rounded-lg p-4 shadow hover:shadow-lg transition"
          >
            <Link href={`/players/${player.id}`}>
              <h2 className="text-xl font-semibold text-blue-400 hover:underline">
                {player.name}
              </h2>
            </Link>
            <p className="text-gray-400">{player.team}</p>

            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {Object.entries(player.stats || {}).map(([statName, value]) => (
                <div
                  key={`${player.id}-${statName}`}
                  className="flex justify-between bg-gray-700 rounded px-2 py-1"
                >
                  <span className="capitalize">
                    {statName.replace(/([A-Z])/g, ' $1')}
                  </span>
                  <span>
                    {value === null || value === undefined ? '–' : value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}