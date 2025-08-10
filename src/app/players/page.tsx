'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Player } from '@/types/players';

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPlayers = async () => {
      try {
        const res = await fetch('/api/players');
        if (!res.ok) throw new Error('Failed to load players');
        const data: Player[] = await res.json();
        setPlayers(data);
      } catch {
        setError('Failed to load players');
      } finally {
        setLoading(false);
      }
    };
    void loadPlayers();
  }, []);

  if (loading) return <p className="p-4">Loading...</p>;
  if (error) return <p className="p-4 text-red-500">{error}</p>;

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">All Players</h1>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {players.map((player) => (
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
