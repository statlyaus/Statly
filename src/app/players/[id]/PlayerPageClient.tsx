'use client';

import { useEffect, useRef, useState } from 'react';

import { notFound, useParams, useRouter } from 'next/navigation';

import { useAuth } from '@/AuthContext';
import { PlayerDetail } from '@/components/PlayerDetail';
import { LoadingSpinner } from '@/components/ui';
import { useUserLeagues } from '@/hooks/useUserLeagues';
import { fetchApi } from '@/lib/api';
import type { Player } from '@/types/players';

export default function PlayerPageClient({ initialLeagueId }: { initialLeagueId?: string }) {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { user } = useAuth();
  const { leagues } = useUserLeagues(user?.uid);
  const [leagueId, setLeagueId] = useState(initialLeagueId ?? '');
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canonicalizedRouteRef = useRef(false);
  const selectedLeague = leagues.find((league) => league.id === leagueId);
  const effectiveLeagueId = selectedLeague?.id;

  useEffect(() => {
    setLeagueId((currentLeagueId) =>
      currentLeagueId === (initialLeagueId ?? '') ? currentLeagueId : (initialLeagueId ?? '')
    );
  }, [initialLeagueId]);

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
        const query = effectiveLeagueId ? `?leagueId=${encodeURIComponent(effectiveLeagueId)}` : '';
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
  }, [effectiveLeagueId, id, params, router]);

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
      <PlayerDetail player={player} leagueId={effectiveLeagueId} />
    </div>
  );
}
