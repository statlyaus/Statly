'use client';

import { useState, useEffect } from 'react';
import { db } from '@/firebase';
import { collection, getDocs } from 'firebase/firestore';
import LoadingSpinner from '@/components/LoadingSpinner'; // Assuming LoadingSpinner is in components

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

const TradeCentreStrings = {
  title: 'Trade Centre',
  searchPlaceholder: 'Search by name',
  tradeButton: 'Trade',
  loading: 'Loading players...',
  error: 'Error loading players. Please try again later.',
};

export default function TradeCentrePage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlayers() {
      try {
        const querySnapshot = await getDocs(collection(db, 'players'));
        const playersData = querySnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Player[];
        setPlayers(playersData);
      } catch (_err) {
        setError(TradeCentreStrings.error);
      } finally {
        setLoading(false);
      }
    }

    fetchPlayers();
  }, []);

  const filteredPlayers = players.filter((player) =>
    player.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="container mx-auto p-4 bg-gray-900 text-white min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-center">{TradeCentreStrings.title}</h1>

      <input
        type="text"
        placeholder={TradeCentreStrings.searchPlaceholder}
        className="mb-8 p-3 border rounded w-full bg-gray-800 border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading && <LoadingSpinner />}
      {error && <p className="text-red-500 text-center">{error}</p>}

      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredPlayers.map((player) => (
            <div key={player.id} className="bg-gray-800 rounded-lg shadow-lg p-4 hover:shadow-blue-500/50 transition-shadow duration-300">
              <h2 className="text-xl font-semibold text-blue-400">{player.name}</h2>
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
              <button className="mt-5 w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors duration-300">
                {TradeCentreStrings.tradeButton}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
