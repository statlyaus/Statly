import { useEffect, useState } from 'react';

import { fetchJson } from '@/lib/api';
import { logger } from '@/lib/logger';
import type { UserLeagueSummary } from '@/types/leagues';
import { isAbortError } from '@/lib/utils';

type UserLeaguesResponse =
  | UserLeagueSummary[]
  | {
      leagues?: UserLeagueSummary[];
      data?: {
        leagues?: UserLeagueSummary[];
      };
    };

export function useUserLeagues(userId?: string) {
  const [leagues, setLeagues] = useState<UserLeagueSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setLeagues([]);
      return;
    }

    const controller = new AbortController();

    async function fetchLeagues() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchJson<UserLeaguesResponse>(`/api/leagues/user/${userId}`, {
          signal: controller.signal,
        });
        const leaguesFromResponse: UserLeagueSummary[] = Array.isArray(response)
          ? response
          : Array.isArray(response?.leagues)
            ? response.leagues
            : Array.isArray(response?.data?.leagues)
              ? response.data.leagues
              : [];

        setLeagues(leaguesFromResponse);
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
