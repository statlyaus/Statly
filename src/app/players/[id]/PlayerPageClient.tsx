'use client';

import { useEffect, useState } from 'react';
import { useParams, notFound } from 'next/navigation';

import { PlayerDetail } from '@/components/PlayerDetail';
import { LoadingSpinner } from '@/components/ui';
import { fetchApi } from '@/lib/api';
import type { Player } from '@/types/players';

export default function PlayerPageClient() {
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
        const data = await fetchApi(`players/${id}`);
        setPlayer(data);
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

