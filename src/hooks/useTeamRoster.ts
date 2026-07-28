import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { getPerformanceMonitor } from '@/lib/performance';
import { isAbortError } from '@/lib/utils';

interface PlayerLite {
  id: string;
  name: string;
  position: string;
  team: string;
  averageScore?: number;
  lastGameScore?: number;
  projectedScore?: number;
  form?: number[];
  injuryStatus?: string;
  priceChange?: number;
  ownership?: number;
}

interface TeamRosterResponse {
  success: boolean;
  data?: {
    roster?: {
      players?: PlayerLite[];
    };
  };
  error?: {
    message?: string;
  };
}

export function useTeamRoster(leagueId?: string, userId?: string) {
  const [players, setPlayers] = useState<PlayerLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueId || !userId) {
      setPlayers([]);
      return;
    }

    const controller = new AbortController();
    const start = Date.now();
    setPlayers([]);

    async function fetchRoster() {
      setLoading(true);
      setError(null);

      try {
        const rosterRes = await fetch(`/api/leagues/${leagueId}/roster/${userId}`, {
          signal: controller.signal,
        });
        const rosterData = (await rosterRes.json()) as TeamRosterResponse;
        if (!rosterRes.ok || !rosterData.success) {
          throw new Error(rosterData.error?.message || 'Failed to load team roster');
        }
        if (controller.signal.aborted) return;
        setPlayers(rosterData.data?.roster?.players || []);

        try {
          const monitor = getPerformanceMonitor();
          monitor?.measureCustomMetric('fetch_team_roster', start);
        } catch (mErr) {
          if (process.env.NODE_ENV === 'development')
            console.warn('useTeamRoster: metric failed', mErr);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        logger.error('useTeamRoster: failed', err as Error, { leagueId, userId });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchRoster();
    return () => controller.abort();
  }, [leagueId, userId]);

  return { players, loading, error };
}
