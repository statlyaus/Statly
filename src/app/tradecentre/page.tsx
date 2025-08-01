// src/app/tradecentre/page.tsx

'use client';

import { useState } from 'react';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useEffect } from 'react';

interface Player {
  id: string;
  name: string;
  team: string;
  position: string;
  stats: Record<string, number>;
}

const statLabels: Record<string, string> = {
  kicks: 'Kicks',
  handballs: 'Handballs',
  marks: 'Marks',
  tackles: 'Tackles',
  goals: 'Goals',
  hitouts: 'Hitouts',
  clearances: 'Clearances',
  inside50s: 'Inside 50s',
  rebound50s: 'Rebound 50s',
  clangers: 'Clangers',
  contestedPossessions: 'Contested Possessions',
  uncontestedPossessions: 'Uncontested Possessions',
  freesFor: 'Frees For',
  freesAgainst: 'Frees Against',
  onePercenters: 'One Percenters',
  goalAssists: 'Goal Assists',
  timeOnGroundPercentage: 'Time on Ground %',
  disposalEfficiencyPercentage: 'Disposal Efficiency %',
  turnovers: 'Turnovers',
  intercepts: 'Intercepts',
  metresGained: 'Metres Gained',
  contestedMarks: 'Contested Marks',
  effectiveDisposals: 'Effective Disposals',
  scoreInvolvements: 'Score Involvements',
};

export default function TradeCentrePage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchPlayers() {
      const querySnapshot = await getDocs(collection(db, 'players'));
      const playersData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Player[];
      setPlayers(playersData);
    }

    fetchPlayers();
  }, []);

  const filteredPlayers = players.filter((player) =>
    player.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Trade Centre</h1>

      <input
        type="text"
        placeholder="Search by name"
        className="mb-6 p-2 border rounded w-full"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {filteredPlayers.map((player) => (
          <div key={player.id} className="card">
            <h2 className="text-xl font-semibold">{player.name}</h2>
            <p className="text-gray-600">
              {player.team} - {player.position}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {Object.entries(statLabels).map(([key, label]) => (
                <li key={key}>
                  {label}: {player.stats?.[key] ?? '-'}
                </li>
              ))}
            </ul>
            <button className="mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Trade
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
