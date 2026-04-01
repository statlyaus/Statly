'use client';

import { useEffect, useRef, useState } from 'react';

import { notFound, useParams, useRouter } from 'next/navigation';

import { PlayerDetail } from '@/components/PlayerDetail';
import { LoadingSpinner } from '@/components/ui';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { fetchApi } from '@/lib/api';
import type { Player } from '@/types/players';

export default function PlayerPageClient() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const [leagueId] = useLocalStorage<string>('ui.lastLeagueId', '');
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canonicalizedRouteRef = useRef(false);

  useEffect(() => {
    canonicalizedRouteRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!id || !params) return;

    const controller = new AbortController();

    const getPlayerData = async () => {
      try {
        setLoading(true);
        setError(null);
        const query = leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : '';
        const data = await fetchApi(`players/${id}${query}`, { signal: controller.signal });
        const playerData = data?.data ?? data;

        if (controller.signal.aborted) {
          return;
        }

        setPlayer(playerData as Player);

        if (
          typeof playerData?.id === 'string' &&
          playerData.id !== id &&
          !canonicalizedRouteRef.current
        ) {
          canonicalizedRouteRef.current = true;
          router.replace(`/players/${encodeURIComponent(playerData.id)}`);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setError('Failed to fetch player data.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void getPlayerData();

    return () => {
      controller.abort();
    };
  }, [id, params, leagueId, router]);

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
      <PlayerDetail player={player} leagueId={leagueId} />
    </div>
  );
}
