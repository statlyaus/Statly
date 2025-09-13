import { useState, useEffect, useCallback } from 'react';

import { fetchJson } from '@/lib/api';

interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

interface InjuryResponse {
  success: boolean;
  data: InjuryData[];
  count: number;
  lastUpdated: string;
  teamFilter: string | null;
  error?: string;
  note?: string;
}

interface UseInjuryDataOptions {
  teamFilter?: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

export function useInjuryData(options: UseInjuryDataOptions = {}) {
  const { teamFilter, autoRefresh = false, refreshInterval = 300000 } = options; // 5 minutes default

  const [data, setData] = useState<InjuryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchInjuries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (teamFilter) {
        params.append('team', teamFilter);
      }

      const result = await fetchJson<InjuryResponse>(`/api/injuries?${params.toString()}`);

      if (result.success) {
        setData(result.data);
        setLastUpdated(result.lastUpdated);
        console.log(
          `Loaded ${result.count} injury records${result.teamFilter ? ` for ${result.teamFilter}` : ''}`
        );
      } else {
        setError(result.error || 'Failed to fetch injury data');
        // Still set data if we have fallback data
        if (result.data) {
          setData(result.data);
          setLastUpdated(result.lastUpdated);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error fetching injury data:', err);
    } finally {
      setLoading(false);
    }
  }, [teamFilter]);

  // Initial fetch
  useEffect(() => {
    fetchInjuries().catch(console.error);
  }, [fetchInjuries]);

  // Auto-refresh if enabled
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchInjuries().catch(console.error);
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchInjuries]);

  const refresh = useCallback(() => {
    fetchInjuries().catch(console.error);
  }, [fetchInjuries]);

  return {
    injuries: data,
    loading,
    error,
    lastUpdated,
    refresh,
    count: data.length,
  };
}

// Helper function to get team-specific injuries
export function useTeamInjuries(
  teamName: string,
  options: Omit<UseInjuryDataOptions, 'teamFilter'> = {}
) {
  return useInjuryData({ ...options, teamFilter: teamName });
}

// Helper function to convert injury data to the format expected by InjuryAlertsModule
export function convertToInjuryAlerts(
  injuries: InjuryData[],
  userTeamPlayers?: string[]
): Array<{ injured: InjuryData; replacements: InjuryData[] }> {
  return injuries
    .filter((injury) => {
      // If user has team players, only show injuries for their players
      if (userTeamPlayers && userTeamPlayers.length > 0) {
        return userTeamPlayers.some(
          (playerName) =>
            playerName.toLowerCase().includes(injury.name.toLowerCase()) ||
            injury.name.toLowerCase().includes(playerName.toLowerCase())
        );
      }
      return true;
    })
    .map((injury) => {
      const injured: InjuryData = {
        id: injury.id,
        name: injury.name,
        team: injury.team,
        position: injury.position,
        injury: injury.injury,
        status: injury.status,
        ...(injury.expectedReturn !== undefined ? { expectedReturn: injury.expectedReturn } : {}),
        ...(injury.details !== undefined ? { details: injury.details } : {}),
      };

      return {
        injured,
        replacements: [] as InjuryData[], // TODO: Add logic to suggest replacements based on position and availability
      };
    });
}
