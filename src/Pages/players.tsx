import { useState, useEffect } from 'react';
import PlayerList from '../components/PlayerList';
import type { Player } from '../types';
import { fetchFromAPI } from '../lib/api';

const PlayersPage = () => {
  const [myTeam, setMyTeam] = useState<Player[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPlayers = async () => {
      try {
        setLoading(true);
        setError(null);

        const allPlayers = await fetchFromAPI<Player[]>('/api/players');
        setMyTeam(allPlayers.slice(0, 10));
        setAvailablePlayers(allPlayers.slice(10));
      } catch (err) {
        console.error('Failed to load players:', err);
        setError('Failed to load players');
      } finally {
        setLoading(false);
      }
    };

    loadPlayers();
  }, []);

  if (loading) return <div className="p-4">Loading players...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="p-4">
      <PlayerList title="My Team" players={myTeam} />
      <div className="mt-6">
        <PlayerList title="Available Players" players={availablePlayers} />
      </div>
    </div>
  );
};

export default PlayersPage;
