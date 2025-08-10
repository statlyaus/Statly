// src/app/players/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';

type Player = {
  id: string;
  name: string;
  team: string;
  position: string;
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/players')
      .then((res) => res.json())
      .then((data) => {
        setPlayers(data);
        setLoading(false);
      })
      .catch((_err) => {
        setError('Failed to load players');
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="p-4">Loading...</p>;
  if (error) return <p className="p-4 text-red-500">{error}</p>;

  const Row = ({ index, style }: ListChildComponentProps) => {
    const player = players[index];
    return (
      <li
        style={style}
        className="border rounded-lg p-4 hover:shadow-lg transition"
        key={player.id}
      >
        <h2 className="text-lg font-semibold">{player.name}</h2>
        <p className="text-sm text-gray-600">
          {player.team} — {player.position}
        </p>
        <p className="mt-1"></p>
        <Link
          href={`/players/${player.id}`}
          className="text-blue-600 hover:underline text-sm mt-2 inline-block"
        >
          View Profile →
        </Link>
      </li>
    );
  };

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">All Players</h1>
      <FixedSizeList
        height={600}
        width="100%"
        itemCount={players.length}
        itemSize={120}
        itemKey={(index) => players[index].id}
        outerElementType="ul"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {Row}
      </FixedSizeList>
    </main>
  );
}
