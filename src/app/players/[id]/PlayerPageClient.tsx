'use client';

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';
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
  const [reloadNonce, setReloadNonce] = useState(0);
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
        setError(err instanceof Error ? err.message : 'Failed to fetch player data.');
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
  }, [effectiveLeagueId, id, params, reloadNonce, router]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-destructive"
        >
          <h1 className="text-lg font-semibold text-foreground">Player unavailable</h1>
          <p className="mt-2 text-sm">{error}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setReloadNonce((current) => current + 1)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              aria-label="Retry player load"
            >
              Retry
            </button>
            <Link
              href="/players"
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Back to players
            </Link>
          </div>
        </div>
      </div>
    );
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
