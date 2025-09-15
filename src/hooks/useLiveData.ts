'use client';

// src/hooks/useLiveData.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { LegacyPlayerStat } from '@/types/fantasy';

/** ---------- Client-safe types (duplicated on purpose; do not import server code) ---------- */
export type ETLPlayerStats = {
  match_uid: string;
  player_uid: string;
  team: string;
  season: number;
  round_number: number;
  source: string;
  last_seen_at: string;
  stats: Record<string, number | null | undefined>;
};

export type ETLMatch = {
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: 'scheduled' | 'in_progress' | 'final';
};


export type PlayerProfile = {
  full_name: string;
  current_team: string;
  positions: string[];
  provider_ids?: Record<string, unknown>;
  /** Optional normalized field your API may return */
  position?: string;
};

/** ---------- UI state ---------- */
interface LiveDataState {
  playerStats: LegacyPlayerStat[];
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
  pollingInterval?: number; // ms
  transformToLegacy?: boolean;
}

/** ---------- Helpers to call API routes ---------- */
const API_BASE = '/api/etl';

async function apiGET<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

// Bundled fetch for the main dashboard view
async function fetchLiveBundle(signal?: AbortSignal) {
  const [stats, matches, freshness, profiles] = await Promise.all([
    apiGET<{ data: ETLPlayerStats[] }>(`${API_BASE}/live-player-stats`, signal).then((r) => r.data),
    apiGET<{ data: ETLMatch[] }>(`${API_BASE}/live-matches`, signal).then((r) => r.data),
    apiGET<{ isLive: boolean; lastUpdate: string | null; minutesSinceUpdate: number | null }>(
      `${API_BASE}/freshness`,
      signal
    ),
    apiGET<Record<string, { position?: string }>>(`${API_BASE}/player-profiles-map`, signal),
  ]);
  return { stats, matches, freshness, profiles };
}

// Convert ETL shape → legacy UI shape
function toLegacy(
  etl: ETLPlayerStats[],
  profiles: Record<string, { position?: string }>
): LegacyPlayerStat[] {
  const score = (s: ETLPlayerStats['stats']) =>
    (s.kicks ?? 0) * 3 +
    (s.handballs ?? 0) * 2 +
    (s.marks ?? 0) * 3 +
    (s.tackles ?? 0) * 4 +
    (s.goals ?? 0) * 6 +
    (s.behinds ?? 0) * 1 +
    (s.hitouts ?? 0) * 1 +
    (s.frees_against ?? 0) * -3 +
    (s.clangers ?? 0) * -4;

  return etl.map((r) => {
    const s = (r.stats || {}) as Record<string, number | null | undefined>;
    const kicks = (s.kicks ?? 0) as number;
    const handballs = (s.handballs ?? 0) as number;
    const disposals = (s.disposals ?? (kicks + handballs)) as number;

    // Only return fields defined in the shared LegacyPlayerStat type
    return {
      id: r.player_uid,
      name: r.player_uid.replace(/^ply_/, '').replace(/_/g, ' '),
      team: r.team,
      position: profiles[r.player_uid]?.position ?? 'MID',

      // normalized counting stats
      kicks,
      handballs,
      disposals,
      marks: (s.marks ?? 0) as number,
      tackles: (s.tackles ?? 0) as number,
      goals: (s.goals ?? 0) as number,
      behinds: (s.behinds ?? 0) as number,
      hitouts: (s.hitouts ?? 0) as number,
      clearances: (s.clearances ?? 0) as number,
      inside50s: (s.inside50s ?? 0) as number,
      rebound50s: (s.rebound50s ?? 0) as number,
      contested_possessions: (s.contested_possessions ?? 0) as number,
      uncontested_possessions: (s.uncontested_possessions ?? 0) as number,

      // derived/fantasy and meta
      fantasyScore: score(s as any),
      round: r.round_number,
      season: r.season,
      lastUpdated: r.last_seen_at,
      source: r.source,
    } as LegacyPlayerStat;
  });
}

/** ---------- Main hook: live bundle ---------- */
export function useLiveData(options: UseLiveDataOptions = {}) {
  const {
    enablePolling = true,
    pollingInterval = 30_000,
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
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((p) => ({ ...p, isLoading: true, error: null }));

      const { stats, matches, freshness, profiles } = await fetchLiveBundle(controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;

      setState({
        playerStats: transformToLegacy ? toLegacy(stats, profiles) : [],
        rawPlayerStats: stats,
        liveMatches: matches,
        isLive: freshness.isLive,
        lastUpdate: freshness.lastUpdate,
        minutesSinceUpdate: freshness.minutesSinceUpdate,
        isLoading: false,
        error: null,
      });
    } catch (e) {
      if (!mountedRef.current) return;
      setState((p) => ({
        ...p,
        isLoading: false,
        error: e instanceof Error ? e.message : 'Failed to fetch live data',
      }));
    }
  }, [transformToLegacy]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();

    let id: ReturnType<typeof setInterval> | undefined;
    if (enablePolling) id = setInterval(() => void fetchData(), pollingInterval);

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (id) clearInterval(id);
    };
  }, [fetchData, enablePolling, pollingInterval]);

  const refresh = useCallback(() => void fetchData(), [fetchData]);

  return { ...state, refresh };
}

/** ---------- Focused hooks that hit specific API endpoints ---------- */
export function useMatchData(matchUid: string | null) {
  const [state, setState] = useState<{
    playerStats: ETLPlayerStats[];
    isLoading: boolean;
    error: string | null;
  }>({
    playerStats: [],
    isLoading: !!matchUid,
    error: null,
  });

  useEffect(() => {
    if (!matchUid) return setState({ playerStats: [], isLoading: false, error: null });

    let active = true;
    (async () => {
      try {
        setState((p) => ({ ...p, isLoading: true, error: null }));
        const res = await apiGET<{ data: ETLPlayerStats[] }>(
          `${API_BASE}/match-player-stats?uid=${encodeURIComponent(matchUid)}`
        );
        if (!active) return;
        setState({ playerStats: res.data, isLoading: false, error: null });
      } catch (e) {
        if (!active) return;
        setState({
          playerStats: [],
          isLoading: false,
          error: e instanceof Error ? e.message : 'Failed to fetch match data',
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [matchUid]);

  return state;
}

export function usePlayerData(playerUid: string | null, recentGamesCount = 10) {
  const [state, setState] = useState<{
    profile: PlayerProfile | null;
    recentStats: ETLPlayerStats[];
    isLoading: boolean;
    error: string | null;
  }>({
    profile: null,
    recentStats: [],
    isLoading: !!playerUid,
    error: null,
  });

  useEffect(() => {
    if (!playerUid) return setState({ profile: null, recentStats: [], isLoading: false, error: null });

    let active = true;
    (async () => {
      try {
        setState((p) => ({ ...p, isLoading: true, error: null }));
        const [profile, recent] = await Promise.all([
          apiGET<PlayerProfile>(`${API_BASE}/player-profile?uid=${encodeURIComponent(playerUid)}`),
          apiGET<{ data: ETLPlayerStats[] }>(
            `${API_BASE}/player-recent-stats?uid=${encodeURIComponent(playerUid)}&limit=${recentGamesCount}`
          ).then((r) => r.data),
        ]);
        if (!active) return;
        setState({ profile, recentStats: recent, isLoading: false, error: null });
      } catch (e) {
        if (!active) return;
        setState({
          profile: null,
          recentStats: [],
          isLoading: false,
          error: e instanceof Error ? e.message : 'Failed to fetch player data',
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [playerUid, recentGamesCount]);

  return state;
}

export function useTeamData(team: string | null, season?: number) {
  const [state, setState] = useState<{
    currentStats: ETLPlayerStats[];
    isLoading: boolean;
    error: string | null;
  }>({
    currentStats: [],
    isLoading: !!team,
    error: null,
  });

  useEffect(() => {
    if (!team) return setState({ currentStats: [], isLoading: false, error: null });

    let active = true;
    (async () => {
      try {
        setState((p) => ({ ...p, isLoading: true, error: null }));
        const params = new URLSearchParams({ team });
        if (season) params.set('season', String(season));
        const res = await apiGET<{ data: ETLPlayerStats[] }>(
          `${API_BASE}/team-current-stats?${params.toString()}`
        );
        if (!active) return;
        setState({ currentStats: res.data, isLoading: false, error: null });
      } catch (e) {
        if (!active) return;
        setState({
          currentStats: [],
          isLoading: false,
          error: e instanceof Error ? e.message : 'Failed to fetch team data',
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [team, season]);

  return state;
}
