import { useEffect, useState } from 'react';

import { fetchJson } from '@/lib/api';
import { logger } from '@/lib/logger';
import { getPerformanceMonitor } from '@/lib/performance';
import { isAbortError } from '@/lib/utils';

interface LeagueBrief {
  id: string;
  name: string;
  teamName?: string;
  draftCompleted?: boolean;
}

type UserLeaguesResponse =
  | LeagueBrief[]
  | {
      leagues?: LeagueBrief[];
      data?: {
        leagues?: LeagueBrief[];
      };
    };

export function useUserLeagues(userId?: string) {
  const [leagues, setLeagues] = useState<LeagueBrief[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLeagues([]);
      return;
    }

    const controller = new AbortController();
    const start = Date.now();

    async function fetchLeagues() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchJson<UserLeaguesResponse>(`/api/leagues/user/${userId}`, {
          signal: controller.signal,
        });
        const leaguesFromResponse: LeagueBrief[] = Array.isArray(response)
          ? response
          : Array.isArray(response?.leagues)
            ? response.leagues
            : Array.isArray(response?.data?.leagues)
              ? response.data.leagues
              : [];

        setLeagues(leaguesFromResponse);

        // Record a tiny performance metric
        try {
          const monitor = getPerformanceMonitor();
          monitor?.measureCustomMetric('fetch_user_leagues', start);
        } catch (monitorErr) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('useUserLeagues: failed to record metric', monitorErr);
          }
        }
      } catch (err) {
        if (isAbortError(err)) return;
        logger.error('useUserLeagues: failed to fetch leagues', err as Error, { userId });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    void fetchLeagues();

    return () => controller.abort();
  }, [userId]);

  return { leagues, loading, error };
}
