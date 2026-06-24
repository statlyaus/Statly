import { useState, useEffect } from 'react';
import type { Player } from '@/types/players';
import { fetchApi } from '@/lib/api';

interface PlayerRanking extends Player {
  rank: number;
  totalValue?: number;
  valueOverReplacement: number;
}

const RANKINGS_REQUEST_TIMEOUT_MS = 10_000;

function normalizeRankingsResponse(response: unknown): PlayerRanking[] {
  const normalizeRows = (rows: unknown[]): PlayerRanking[] =>
    rows.map((row) => {
      const ranking = row as PlayerRanking;
      const statlyZ = ranking.totalValue ?? ranking.valueOverReplacement ?? 0;

      return {
        ...ranking,
        totalValue: ranking.totalValue ?? statlyZ,
        valueOverReplacement: statlyZ,
      };
    });

  if (Array.isArray(response)) return normalizeRows(response);

  if (response && typeof response === 'object') {
    const body = response as Record<string, unknown>;
    const data = body.data;

    if (Array.isArray(data)) return normalizeRows(data);
    if (data && typeof data === 'object') {
      const dataBody = data as Record<string, unknown>;
      if (Array.isArray(dataBody.players)) return normalizeRows(dataBody.players);
    }

    if (Array.isArray(body.players)) return normalizeRows(body.players);
  }

  return [];
}

export const useRankings = () => {
  const [rankings, setRankings] = useState<PlayerRanking[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, RANKINGS_REQUEST_TIMEOUT_MS);

    const getRankings = async () => {
      try {
        if (isActive) setLoading(true);
        const data = await fetchApi('rankings', { signal: controller.signal });
        if (!isActive) return;
        setRankings(normalizeRankingsResponse(data));
        setError(null);
      } catch (err) {
        if (!isActive) return;
        if (controller.signal.aborted) {
          setError('Rankings request timed out.');
        } else {
          setError('Failed to fetch player rankings.');
          console.error(err);
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (isActive) setLoading(false);
      }
    };

    getRankings();

    return () => {
      isActive = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  return { rankings, loading, error };
};
