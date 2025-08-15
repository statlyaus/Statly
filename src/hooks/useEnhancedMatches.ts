import { useState, useEffect } from 'react';

export interface Match {
  id: string;
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  match_date: string;
  venue: string;
  player_stats?: PlayerMatchStat[];
  player_count?: number;
  [key: string]: unknown;
}

export interface PlayerMatchStat {
  id: string;
  player_id: string;
  player_name: string;
  team: string;
  position: string;
  disposals: number;
  goals: number;
  behinds: number;
  marks: number;
  tackles: number;
  fantasy_points: number;
}

export interface EnhancedMatchesResponse {
  success: boolean;
  data: Match[];
  count: number;
  timestamp: string;
  error?: string;
}

export function useEnhancedMatches(season?: string, round?: string) {
  const [data, setData] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEnhancedMatches = async (seasonParam?: string, roundParam?: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (seasonParam) params.append('season', seasonParam);
      if (roundParam) params.append('round', roundParam);

      const response = await fetch(`/api/matches/enhanced?${params.toString()}`);
      const result: EnhancedMatchesResponse = await response.json();

      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || 'Failed to fetch enhanced matches');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (season !== undefined || round !== undefined) {
      fetchEnhancedMatches(season, round);
    }
  }, [season, round]);

  return {
    data,
    loading,
    error,
    refetch: () => fetchEnhancedMatches(season, round),
    fetchEnhancedMatches,
  };
}
