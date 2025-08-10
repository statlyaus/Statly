'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Player } from '@/types/players';

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState('');
  const [position, setPosition] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    async function fetchPlayers() {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (team) params.set('team', team);
      if (position) params.set('position', position);
      params.set('page', String(page));
      params.set('limit', String(limit));

      try {
        const res = await fetch(`/api/players?${params.toString()}`);
        const data = await res.json();
        setPlayers(data.players);
        setTotal(data.total);
        setError(null);
      } catch {
        setError('Failed to load players');
      } finally {
        setLoading(false);
      }
    }

    fetchPlayers();
  }, [search, team, position, page, limit]);

  if (loading) return <p className="p-4">Loading...</p>;
  if (error) return <p className="p-4 text-red-500">{error}</p>;

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">All Players</h1>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="border rounded p-2"
        />
        <input
          type="text"
          placeholder="Team"
          value={team}
          onChange={(e) => {
            setTeam(e.target.value);
            setPage(1);
          }}
          className="border rounded p-2"
        />
        <input
          type="text"
          placeholder="Position"
          value={position}
          onChange={(e) => {
            setPosition(e.target.value);
            setPage(1);
          }}
          className="border rounded p-2"
        />
      </div>
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
      <div className="flex items-center justify-between mt-4">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {page} of {Math.max(1, Math.ceil(total / limit))}
        </span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={page * limit >= total}
          className="px-3 py-1 border rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </main>
  );
}

