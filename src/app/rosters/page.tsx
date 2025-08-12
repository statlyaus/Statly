'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import type { Player } from '@/types/players';

type RosterPlayer = Pick<Player, 'id' | 'name' | 'team' | 'position' | 'injury'>;

function PlayerCard({ player }: { player: RosterPlayer }) {
  return (
    <div className="p-4 border rounded shadow-sm bg-white">
      <h2 className="font-semibold text-lg">
        {player.name}
        {player.injury && (
          <span className="ml-2 text-sm text-red-600">{player.injury}</span>
        )}
      </h2>
      <p className="text-sm text-gray-600">
        {player.team} - {player.position}
      </p>
    </div>
  );
}

export default function RostersPage() {
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState('');

  useEffect(() => {
    const fetchPlayers = async () => {
      if (!db) {
        console.error('Firebase database not initialized. Cannot fetch players.');
        return;
      }
      
      const querySnapshot = await getDocs(collection(db!, 'players'));
      const data: RosterPlayer[] = querySnapshot.docs.map((doc) => {
        const docData = doc.data();
        return {
          id: doc.id,
          name: docData.name,
          team: docData.team,
          position: docData.position,
          injury: docData.injury ?? docData.status,
        };
      });
      setPlayers(data);
    };
    fetchPlayers();
  }, []);

  const filteredPlayers = players.filter((player) => {
    return (
      (!teamFilter || player.team?.toLowerCase().includes(teamFilter.toLowerCase())) &&
      (!positionFilter || player.position?.toLowerCase().includes(positionFilter.toLowerCase()))
    );
  });

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Rosters</h1>
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Filter by Team"
          className="p-2 border rounded"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
        />
        <input
          type="text"
          placeholder="Filter by Position"
          className="p-2 border rounded"
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPlayers.length > 0 ? (
          filteredPlayers.map((player) => (
            <PlayerCard key={player.id} player={player} />
          ))
        ) : (
          <p className="col-span-full text-center text-gray-500">No players found.</p>
        )}
      </div>
    </main>
  );
}