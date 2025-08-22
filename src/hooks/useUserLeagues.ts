import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { getPerformanceMonitor } from '@/lib/performance';

interface LeagueBrief {
  id: string;
  name: string;
  teamName?: string;
  draftCompleted?: boolean;
}

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
        const res = await fetch(`/api/leagues/user/${userId}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch leagues: ${res.status}`);

        const data = await res.json();
        const leaguesFromObj =
          Array.isArray(data?.leagues) ? data.leagues :
          Array.isArray(data?.data?.leagues) ? data.data.leagues :
          Array.isArray(data) ? data : [];

        setLeagues(leaguesFromObj as LeagueBrief[]);

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
        const maybeErr = err as { name?: string } | undefined;
        if (maybeErr?.name === 'AbortError') return;
        logger.error('useUserLeagues: failed to fetch leagues', err as Error, { userId });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    fetchLeagues();

    return () => controller.abort();
  }, [userId]);

  return { leagues, loading, error };
}
