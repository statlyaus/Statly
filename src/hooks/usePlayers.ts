import { useState, useEffect, useMemo } from 'react';
import { fetchFromAPI } from '@/lib/api';
import { validatePlayers, isPlayerDisplayReady } from '@/lib/playerValidation';
import type { Player } from '@/types/players';
import { logger } from '@/lib/logger';

interface UsePlayersOptions {
  endpoint?: string;
  filters?: {
    team?: string;
    position?: string;
    minGames?: number;
    excludeInjured?: boolean;
  };
  sortBy?: keyof Player;
  sortDirection?: 'asc' | 'desc';
}

interface UsePlayersReturn {
  players: Player[];
  filteredPlayers: Player[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  isEmpty: boolean;
  totalCount: number;
  filteredCount: number;
}

export function usePlayers(options: UsePlayersOptions = {}): UsePlayersReturn {
  const {
    endpoint = '/api/players',
    filters = {},
    sortBy = 'name',
    sortDirection = 'asc'
  } = options;

  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlayers = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const data = await fetchFromAPI<{ players?: Player[] } | Player[]>(endpoint);
      const rawPlayers = Array.isArray(data) ? data : data.players ?? [];
      
      // Validate and sanitize the data
      const validatedPlayers = validatePlayers(rawPlayers);
      
      // Filter out players that aren't ready for display
      const displayReadyPlayers = validatedPlayers.filter(isPlayerDisplayReady);
      
      setPlayers(displayReadyPlayers);
    } catch (err) {
      logger.error('Failed to fetch players', err, { endpoint });
      setError(err instanceof Error ? err.message : 'Failed to load players');
      setPlayers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  // Apply filters and sorting
  const filteredPlayers = useMemo(() => {
    let filtered = [...players];

    // Apply filters
    if (filters.team && filters.team !== 'All') {
      filtered = filtered.filter(player => player.team === filters.team);
    }

    if (filters.position && filters.position !== 'All') {
      filtered = filtered.filter(player => player.position === filters.position);
    }

    if (filters.minGames && typeof filters.minGames === 'number') {
      filtered = filtered.filter(player => 
        typeof player.games === 'number' && player.games >= filters.minGames!
      );
    }

    if (filters.excludeInjured) {
      filtered = filtered.filter(player => !player.injury);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];

      // Handle undefined/null values
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Handle numeric sorting
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }

      // Handle string sorting
      const aStr = String(aValue).toLowerCase();
      const bStr = String(bValue).toLowerCase();
      
      if (sortDirection === 'asc') {
        return aStr.localeCompare(bStr);
      } else {
        return bStr.localeCompare(aStr);
      }
    });

    return filtered;
  }, [players, filters, sortBy, sortDirection]);

  return {
    players,
    filteredPlayers,
    loading,
    error,
    refresh: fetchPlayers,
    isEmpty: players.length === 0,
    totalCount: players.length,
    filteredCount: filteredPlayers.length,
  };
}
