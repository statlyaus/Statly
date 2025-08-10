import React, { useEffect, useState } from 'react';
import MyTeamPanel from '@/components/MyTeamPanel';
import type { Player, Team } from '@/types';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

const MyTeam: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [team, setTeam] = useState<Team>({ id: 'my-team', players: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlayers() {
      try {
        const snap = await getDocs(collection(db, 'players'));
        const data: Player[] = snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Player, 'id'>),
        }));
        setPlayers(data);
        setTeam({ id: 'my-team', players: data.map((p) => p.id) });
      } catch (err) {
        console.error('Failed to load players', err);
        setError('Unable to load players.');
      }
    }
    fetchPlayers();
  }, []);

  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold mb-4">My Team</h1>
      {error && <p className="text-red-500 mb-4">{error}</p>}
      <MyTeamPanel team={team} players={players} />
    </main>
  );
};

export default MyTeam;
