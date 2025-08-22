import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { getPerformanceMonitor } from '@/lib/performance';

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

    async function fetchRoster() {
      setLoading(true);
      setError(null);

      try {
        // Try Firebase roster first
        const rosterRes = await fetch(`/api/leagues/${leagueId}/roster/${userId}`, { signal: controller.signal }).catch(() => null);
        if (rosterRes?.ok) {
          const rosterData = await rosterRes.json();
          setPlayers(rosterData.players || []);
        } else {
          // Fallback to draft data
          const draftRes = await fetch(`/api/draft/${leagueId}/roster/${userId}`, { signal: controller.signal }).catch(() => null);
          if (draftRes?.ok) {
            const draftData = await draftRes.json();
            type DraftPickShape = {
              playerId?: string;
              playerName?: string;
              position?: string;
              team?: string;
              averageScore?: number;
              lastGameScore?: number;
              projectedScore?: number;
              form?: number[];
              injuryStatus?: string;
              priceChange?: number;
              ownership?: number;
            };

            setPlayers((draftData.picks || []).map((p: DraftPickShape, i: number) => ({
              id: p.playerId || `player-${i}`,
              name: p.playerName || 'Unknown',
              position: p.position || 'Unknown',
              team: p.team || 'AFL',
              averageScore: p.averageScore || 75,
              lastGameScore: p.lastGameScore || 0,
              projectedScore: p.projectedScore || 80,
              form: p.form || [70,75,80,85,90],
              injuryStatus: p.injuryStatus || 'healthy',
              priceChange: p.priceChange || 0,
              ownership: p.ownership || 10,
            })));
          } else {
            setPlayers([]);
          }
        }

        try {
          const monitor = getPerformanceMonitor();
          monitor?.measureCustomMetric('fetch_team_roster', start);
        } catch (mErr) {
          if (process.env.NODE_ENV === 'development') console.warn('useTeamRoster: metric failed', mErr);
        }
      } catch (err) {
        const maybeErr = err as { name?: string } | undefined;
        if (maybeErr?.name === 'AbortError') return;
        logger.error('useTeamRoster: failed', err as Error, { leagueId, userId });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    fetchRoster();
    return () => controller.abort();
  }, [leagueId, userId]);

  return { players, loading, error };
}
