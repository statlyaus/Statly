'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { useParams, notFound } from 'next/navigation';
import type { Player } from '@/types/players';
import type { ApiSuccessResponse } from '@/lib/apiResponse';
import { PlayerDetail } from '@/components/PlayerDetail';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

function isPlayerResponse(value: unknown): value is ApiSuccessResponse<Player> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { success?: unknown }).success === true &&
    typeof (value as { data?: unknown }).data === 'object' &&
    (value as { data?: unknown }).data !== null
  );
}

function normalizePlayerResponse(value: unknown): Player {
  return isPlayerResponse(value) ? value.data : (value as Player);
}

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
        const data = await fetchApi(`players/${id}`);
        setPlayer(normalizePlayerResponse(data));
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
    return (
        <p className="text-red-500 text-center">{error}</p>
    );
  }

  if (!player) {
    notFound();
  }

  return (
      <PlayerDetail player={player} />
  );
}
