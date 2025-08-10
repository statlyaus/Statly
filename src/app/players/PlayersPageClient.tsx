'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Player } from '@/types/players';

interface PlayersPageClientProps {
  players: Player[];
}

export default function PlayersPageClient({ players }: PlayersPageClientProps) {
  // Local state retained for future interactive features (filters, search, etc.)
  const [filteredPlayers] = useState<Player[]>(players);

  if (!filteredPlayers.length) {
    return <p className="p-4">No players found.</p>;
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">All Players</h1>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPlayers.map((player) => (
          <li key={player.id} className="border rounded-lg p-4 hover:shadow-lg transition">
            <h2 className="text-lg font-semibold">{player.name}</h2>
            <p className="text-sm text-gray-600">
              {player.team} — {player.position}
            </p>
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
