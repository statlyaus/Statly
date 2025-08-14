'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface LivePlayerStats {
  player_uid: string;
  stats: Record<string, number | null>;
  last_seen_at: string;
}

export interface LivePlayerStatsResponse {
  matchUid: string;
  players: LivePlayerStats[];
  count: number;
  lastUpdated: string;
  source: string;
}

export interface UseLivePlayerStatsOptions {
  pollInterval?: number; // milliseconds, default 30000 (30s)
  enabled?: boolean; // default true
}

export function useLivePlayerStats(
  matchUid: string | null,
  options: UseLivePlayerStatsOptions = {}
) {
  const { pollInterval = 30000, enabled = true } = options;
  
  const [data, setData] = useState<LivePlayerStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const fetchPlayerStats = useCallback(async () => {
    if (!matchUid || !enabled) return;
    
    try {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      abortControllerRef.current = new AbortController();
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(
        `/api/live-player-stats?matchUid=${encodeURIComponent(matchUid)}`,
        { 
          signal: abortControllerRef.current.signal,
          cache: 'no-store' // Always fetch fresh data
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result: LivePlayerStatsResponse = await response.json();
      setData(result);
      setLastUpdated(new Date());
      
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      console.error('Failed to fetch live player stats:', err);
    } finally {
      setIsLoading(false);
    }
  }, [matchUid, enabled]);
  
  // Initial fetch and setup polling
  useEffect(() => {
    if (!matchUid || !enabled) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    
    // Initial fetch
    fetchPlayerStats();
    
    // Setup polling
    intervalRef.current = setInterval(() => {
      fetchPlayerStats().catch(console.error);
    }, pollInterval);
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchPlayerStats, pollInterval, matchUid, enabled]);
  
  // Manual refresh function
  const refresh = useCallback(() => {
    fetchPlayerStats();
  }, [fetchPlayerStats]);
  
  // Calculate time since last update
  const timeSinceUpdate = lastUpdated 
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
    : null;
  
  return {
    data,
    players: data?.players || [],
    isLoading,
    error,
    lastUpdated,
    timeSinceUpdate,
    refresh,
    // Helper computed values
    hasData: data !== null && data.players.length > 0,
    isEmpty: data !== null && data.players.length === 0,
    playerCount: data?.count || 0
  };
}

// Helper hook for formatting time since update
export function useTimeSinceUpdate(seconds: number | null): string {
  const [, setTick] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(prev => prev + 1);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  if (seconds === null) return '';
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
