import React, { useEffect, useState } from 'react';
import MyTeamPanel from '@/components/MyTeamPanel';
import type { Player, Team } from '@/types';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';

const MyTeam: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [team, setTeam] = useState<Team>({ id: 'my-team', players: [] });

  useEffect(() => {
    async function fetchPlayers() {
      try {
        const snap = await getDocs(collection(db, 'players'));
        const data: Player[] = snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as any),
        }));
        setPlayers(data);
        setTeam({ id: 'my-team', players: data.map((p) => p.id) });
      } catch (err) {
        console.error('Failed to load players', err);
      }
    }
    fetchPlayers();
  }, []);

  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold mb-4">My Team</h1>
      <MyTeamPanel team={team} players={players} />
    </main>
  );
};

export default MyTeam;
