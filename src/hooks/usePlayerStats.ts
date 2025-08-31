import { useState, useEffect, useCallback } from 'react';
import { fetchJson, fetchAllPages } from '@/lib/api';
import type { Player } from '@/types/players';
import type { PlayerStats } from '@/types/fantasyCategories';

// New types for ETL integration
export interface PlayerStat {
  id: string;
  player_id: string;
  player_name: string;
  match_id: string;
  season: number;
  round_number: number;
  disposals?: number;
  goals: number;
  behinds?: number;
  marks?: number;
  tackles: number;
  fantasy_points: number;
  team: string;
  position: string;

  // 9-category structure from your custom algorithm
  categories: {
    goals: number;
    tackles: number;
    inside50s: number; // Replaces clearances
    intercepts: number;
    contestedMarks: number;
    rebound50s: number;
    contestedPossessions: number;
    effectiveDisposals: number; // Replaces onePercenters
    scoreInvolvements: number; // Replaces goalAssists
  };

  // Custom total value from your weighted algorithm
  totalValue: number;

  // 10th cell - efficiency metric
  tenthCell: {
    type: string;
    value: number;
    label: string;
  };

  // Complete per-game log for detailed profile view
  perGameLog: PlayerStats;

  // Match context
  opposition?: string;

  [key: string]: string | number | boolean | undefined | object;
}

export interface PlayerStatsResponse {
  success: boolean;
  data: PlayerStat[];
  count: number;
  timestamp: string;
  error?: string;
  query?: {
    nextCursor?: string | null;
  };
}



interface UsePlayerStatsReturn {
  players: Player[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// Original function for existing players
export function usePlayerStats(): UsePlayerStatsReturn {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlayers = async () => {
    try {
      setLoading(true);
      setError(null);

      const perPage = 1000;
      const aggregated = await fetchAllPages<Player>(
        (page) => `/api/players?limit=${perPage}&page=${page}`,
        (resp) => (resp && typeof resp === 'object' ? (resp as any).players ?? [] : []),
        perPage
      );

      setPlayers(aggregated);
    } catch (err) {
      console.error('Failed to fetch players:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch player data');
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => {
    void fetchPlayers();
  };

  useEffect(() => {
    void fetchPlayers();
  }, []);

  return {
    players,
    loading,
    error,
    refresh,
  };
}

// New function for ETL player stats
export interface UsePlayerStatsETLReturn {
  data: PlayerStat[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  fetchMore: () => Promise<void> | void;
  refetch: () => void;
  fetchPlayerStats: (
    seasonParam?: string,
    roundParam?: string,
    opts?: { append?: boolean; limit?: number }
  ) => Promise<void>;
}

export function usePlayerStatsETL(season?: string, round?: string): UsePlayerStatsETLReturn {
  const [data, setData] = useState<PlayerStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);

  // Reset pagination state when filters change so pagination restarts correctly
  useEffect(() => {
    setData([]);
    setCursor(null);
    setHasMore(false);
  }, [season, round]);

  const fetchPlayerStats = useCallback(async (seasonParam?: string, roundParam?: string, opts?: { append?: boolean; limit?: number }) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (seasonParam) params.append('season', seasonParam);
      if (roundParam) params.append('round', roundParam);
      if (opts?.limit) params.append('limit', String(opts.limit));
      if (opts?.append && cursor) params.append('cursor', cursor);

      const result = await fetchJson<PlayerStatsResponse>(`/api/player-stats?${params.toString()}`);

      if (result.success) {
        setData((prev) => (opts?.append ? [...prev, ...result.data] : result.data));
        const next = result.query?.nextCursor ?? null;
        setCursor(next);
        setHasMore(Boolean(next));
      } else {
        setError(result.error || 'Failed to fetch player stats');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    if (season !== undefined || round !== undefined) {
      void fetchPlayerStats(season, round);
    }
  }, [season, round, fetchPlayerStats]);

  return {
    data,
    loading,
    error,
    hasMore,
    fetchMore: async () => {
      if (loading || !hasMore || !cursor) return;
      await fetchPlayerStats(season, round, { append: true, limit: 500 });
    },
    refetch: () => {
      void fetchPlayerStats(season, round);
    },
    fetchPlayerStats,
  };
}

// Helper function to calculate averages and per-game stats
export function calculatePlayerAverages(player: Player): Player {
  const games = player.games || 1; // Avoid division by zero

  // Calculate per-game averages for key stats
  const averages: Partial<Record<keyof Player, number | undefined>> = {
    kicks: player.kicks ? Number((player.kicks / games).toFixed(1)) : undefined,
    handballs: player.handballs ? Number((player.handballs / games).toFixed(1)) : undefined,
    marks: player.marks ? Number((player.marks / games).toFixed(1)) : undefined,
    tackles: player.tackles ? Number((player.tackles / games).toFixed(1)) : undefined,
    goals: player.goals ? Number((player.goals / games).toFixed(1)) : undefined,
    hitouts: player.hitouts ? Number((player.hitouts / games).toFixed(1)) : undefined,
    clearances: player.clearances ? Number((player.clearances / games).toFixed(1)) : undefined,
    inside50s: player.inside50s ? Number((player.inside50s / games).toFixed(1)) : undefined,
    rebound50s: player.rebound50s ? Number((player.rebound50s / games).toFixed(1)) : undefined,
    contestedPossessions: player.contestedPossessions
      ? Number((player.contestedPossessions / games).toFixed(1))
      : undefined,
  };

  const safeOverrides: Partial<Record<keyof Player, number | undefined>> = {};
  for (const key of Object.keys(averages) as Array<keyof Player>) {
    const value = averages[key];
    if (value !== undefined) {
      safeOverrides[key] = value;
    }
  }

  return {
    ...player,
    ...safeOverrides,
  } as Player;
}

// Helper function to get position-specific key stats
export function getPositionKeyStats(position: string): string[] {
  switch (position) {
    case 'DEF':
      return ['marks', 'rebound50s', 'tackles', 'kicks'];
    case 'MID':
      return ['kicks', 'handballs', 'tackles', 'clearances', 'contestedPossessions'];
    case 'FWD':
      return ['goals', 'marks', 'inside50s', 'tackles'];
    case 'RUC':
      return ['hitouts', 'marks', 'clearances', 'tackles'];
    default:
      return ['kicks', 'handballs', 'marks', 'tackles'];
  }
}

// Helper function to get stat category color coding
export function getStatColor(statKey: string, value: number, position: string): string {
  // Define thresholds based on position and stat type
  const thresholds: Record<
    string,
    Record<string, { excellent: number; good: number; average: number }>
  > = {
    DEF: {
      marks: { excellent: 8, good: 6, average: 4 },
      rebound50s: { excellent: 6, good: 4, average: 2 },
      tackles: { excellent: 6, good: 4, average: 2 },
    },
    MID: {
      kicks: { excellent: 20, good: 15, average: 10 },
      handballs: { excellent: 15, good: 10, average: 6 },
      tackles: { excellent: 8, good: 6, average: 4 },
      clearances: { excellent: 6, good: 4, average: 2 },
      contestedPossessions: { excellent: 12, good: 8, average: 5 },
    },
    FWD: {
      goals: { excellent: 2.5, good: 1.5, average: 0.8 },
      marks: { excellent: 8, good: 6, average: 4 },
      inside50s: { excellent: 4, good: 3, average: 2 },
    },
    RUC: {
      hitouts: { excellent: 35, good: 25, average: 15 },
      marks: { excellent: 8, good: 6, average: 4 },
      clearances: { excellent: 6, good: 4, average: 2 },
    },
  };

  const positionThresholds = thresholds[position];
  const statThreshold = positionThresholds?.[statKey];

  if (!statThreshold) {
    return 'text-gray-700 dark:text-gray-300'; // Default color
  }

  if (value >= statThreshold.excellent) {
    return 'text-green-700 dark:text-green-400 font-semibold';
  } else if (value >= statThreshold.good) {
    return 'text-blue-700 dark:text-blue-400';
  } else if (value >= statThreshold.average) {
    return 'text-yellow-700 dark:text-yellow-400';
  } else {
    return 'text-red-700 dark:text-red-400';
  }
}
