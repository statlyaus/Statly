// Custom React hook for consuming live ETL data
// Place this in src/hooks/useLiveData.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { type ETLPlayerStats, type ETLMatch, type LegacyPlayerStat } from '@/lib/etlIntegration';
import type { LiveMatchData } from '@/app/api/matches/live/route';
import { isAbortError } from '@/lib/utils';

interface LiveDataState {
  playerStats: LegacyPlayerStat[]; // Legacy format for compatibility
  rawPlayerStats: ETLPlayerStats[];
  liveMatches: ETLMatch[];
  isLive: boolean;
  lastUpdate: string | null;
  minutesSinceUpdate: number | null;
  isLoading: boolean;
  error: string | null;
}

interface UseLiveDataOptions {
  enablePolling?: boolean;
  pollingInterval?: number; // in milliseconds
  transformToLegacy?: boolean;
}

export function useLiveData(options: UseLiveDataOptions = {}) {
  const {
    enablePolling = true,
    pollingInterval = 30000, // 30 seconds default
    transformToLegacy = true,
  } = options;

  const [state, setState] = useState<LiveDataState>({
    playerStats: [],
    rawPlayerStats: [],
    liveMatches: [],
    isLive: false,
    lastUpdate: null,
    minutesSinceUpdate: null,
    isLoading: true,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      // Abort any in-flight request before starting a new one
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      // One authenticated server read. The browser Firestore SDK may not read
      // `player_match_stats`, so reading it here failed for every user.
      const [{ fetchApi }, { transformToLegacyPlayerStats }] = await Promise.all([
        import('@/lib/api'),
        import('@/lib/etlIntegration'),
      ]);
      const response: unknown = await fetchApi('matches/live', { signal: controller.signal });
      const data = (response as { data?: Partial<LiveMatchData> } | null)?.data;
      if (!data || !Array.isArray(data.matches) || !Array.isArray(data.stats)) {
        throw new Error('Live match data response was not understood');
      }
      const rawStats = data.stats;
      const matches = data.matches;
      const lastUpdate = data.lastUpdate ?? null;
      const freshness = {
        isLive: matches.length > 0,
        lastUpdate,
        minutesSinceUpdate: lastUpdate
          ? Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 60000)
          : null,
      };

      const playerStats = transformToLegacy ? transformToLegacyPlayerStats(rawStats) : [];

      if (!mountedRef.current || controller.signal.aborted) return;

      setState({
        playerStats,
        rawPlayerStats: rawStats,
        liveMatches: matches,
        isLive: freshness.isLive,
        lastUpdate: freshness.lastUpdate,
        minutesSinceUpdate: freshness.minutesSinceUpdate,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      if (!mountedRef.current || isAbortError(error)) return;
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch live data',
      }));
    }
  }, [transformToLegacy]);

  useEffect(() => {
    mountedRef.current = true;
    // Initial fetch
    void fetchData();

    // Set up polling if enabled
    let interval: NodeJS.Timeout | undefined;
    if (enablePolling) {
      interval = setInterval(() => {
        void fetchData();
      }, pollingInterval);
    }

    return () => {
      mountedRef.current = false;
      if (abortRef.current) abortRef.current.abort();
      if (interval) clearInterval(interval);
    };
  }, [fetchData, enablePolling, pollingInterval]);

  const refresh = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return {
    ...state,
    refresh,
  };
}

// Hook for specific match data
export function useMatchData(matchUid: string | null) {
  const [state, setState] = useState<{
    playerStats: ETLPlayerStats[];
    isLoading: boolean;
    error: string | null;
  }>({
    playerStats: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!matchUid) {
      setState({ playerStats: [], isLoading: false, error: null });
      return;
    }

    const fetchMatchData = async () => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const { getMatchPlayerStats } = await import('@/lib/etlIntegration');
        const stats = await getMatchPlayerStats(matchUid);

        setState({
          playerStats: stats,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        console.error(`Error fetching match data for ${matchUid}:`, error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch match data',
        }));
      }
    };

    void fetchMatchData();
  }, [matchUid]);

  return state;
}

interface PlayerProfile {
  full_name: string;
  current_team: string;
  positions: string[];
  provider_ids?: Record<string, unknown>;
}

// Hook for player-specific data
export function usePlayerData(playerUid: string | null, recentGamesCount: number = 10) {
  const [state, setState] = useState<{
    profile: PlayerProfile | null;
    recentStats: ETLPlayerStats[];
    isLoading: boolean;
    error: string | null;
  }>({
    profile: null,
    recentStats: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!playerUid) {
      setState({ profile: null, recentStats: [], isLoading: false, error: null });
      return;
    }

    const fetchPlayerData = async () => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const { getPlayerProfile, getPlayerRecentStats } = await import('@/lib/etlIntegration');
        const [profile, stats] = await Promise.all([
          getPlayerProfile(playerUid),
          getPlayerRecentStats(playerUid, recentGamesCount),
        ]);

        setState({
          profile,
          recentStats: stats,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        console.error(`Error fetching player data for ${playerUid}:`, error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch player data',
        }));
      }
    };

    void fetchPlayerData();
  }, [playerUid, recentGamesCount]);

  return state;
}

// Hook for team-specific data
export function useTeamData(team: string | null, season?: number) {
  const [state, setState] = useState<{
    currentStats: ETLPlayerStats[];
    isLoading: boolean;
    error: string | null;
  }>({
    currentStats: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    if (!team) {
      setState({ currentStats: [], isLoading: false, error: null });
      return;
    }

    const fetchTeamData = async () => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const { getTeamCurrentStats } = await import('@/lib/etlIntegration');
        const stats = await getTeamCurrentStats(team, season);

        setState({
          currentStats: stats,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        console.error(`Error fetching team data for ${team}:`, error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch team data',
        }));
      }
    };

    void fetchTeamData();
  }, [team, season]);

  return state;
}
