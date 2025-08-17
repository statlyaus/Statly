'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { useParams, notFound } from 'next/navigation';
import type { Player } from '@/types/players';
import { PlayerDetail } from '@/components/PlayerDetail';
import { LoadingSpinner } from '@/components/ui';

export default function PlayerPage() {
  const params = useParams();
  const id = params?.id as string;
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !params) return;

    const getPlayerData = async () => {
      try {
        setLoading(true);
        
        // Try to get player by ID first
        let playerData;
        try {
          playerData = await fetchApi(`players/${id}`);
        } catch (err) {
          // If that fails, create a mock player object for the PlayerDetail component
          // The PlayerDetail component will handle fetching the actual data
          playerData = {
            id: id,
            name: decodeURIComponent(id),
          };
        }
        
        setPlayer(playerData);
      } catch (err) {
        setError('Failed to fetch player data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getPlayerData();
  }, [id, params]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-500 text-center">{error}</p>;
  }

  if (!player) {
    notFound();
  }

  return (
    <div>
      <PlayerDetail player={player} />
    </div>
  );
}