import { useState, useEffect, useCallback } from 'react';
import type { Player } from '@/types/players';
import type { 
  NormalizedInjuryData, 
  EnhancedNormalizedInjuryData
} from '@/types/injuries';

// Re-export for backward compatibility
export type { NormalizedInjuryData, EnhancedNormalizedInjuryData } from '@/types/injuries';

// Legacy interface for backward compatibility
export interface InjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

export interface EnhancedInjuryData extends InjuryData {
  linkedPlayer?: Player;
  matchConfidence: 'exact' | 'high' | 'medium' | 'low' | 'none';
}

// Team name mappings to standardize team names between injury data and player database
// Updated to work with canonical team codes
const TEAM_NAME_MAPPINGS: Record<string, string[]> = {
  'Adelaide': ['Adelaide', 'Adelaide Crows', 'ADE', 'ADEL', 'ADL'],
  'Brisbane': ['Brisbane', 'Brisbane Lions', 'BRIS', 'BL', 'BRI'],
  'Carlton': ['Carlton', 'Carlton Blues', 'CARL', 'CAR'],
  'Collingwood': ['Collingwood', 'Collingwood Magpies', 'COLL', 'COL'],
  'Essendon': ['Essendon', 'Essendon Bombers', 'ESS', 'ESD'],
  'Fremantle': ['Fremantle', 'Fremantle Dockers', 'FREM', 'FRE'],
  'Geelong': ['Geelong', 'Geelong Cats', 'GEEL', 'GEE'],
  'Gold Coast': ['Gold Coast', 'Gold Coast Suns', 'GC', 'GCS'],
  'GWS': ['GWS', 'GWS Giants', 'Greater Western Sydney', 'GWSG'],
  'Hawthorn': ['Hawthorn', 'Hawthorn Hawks', 'HAW', 'HW'],
  'Melbourne': ['Melbourne', 'Melbourne Demons', 'MELB', 'MEL'],
  'North Melbourne': ['North Melbourne', 'North Melbourne Kangaroos', 'NTH', 'NM', 'KANGAROOS'],
  'Port Adelaide': ['Port Adelaide', 'Port Adelaide Power', 'PORT', 'PA', 'PAP'],
  'Richmond': ['Richmond', 'Richmond Tigers', 'RIC', 'RICH'],
  'St Kilda': ['St Kilda', 'St Kilda Saints', 'STK', 'SK'],
  'Sydney': ['Sydney', 'Sydney Swans', 'SYD', 'SWS'],
  'West Coast': ['West Coast', 'West Coast Eagles', 'WC', 'WCE'],
  'Western Bulldogs': ['Western Bulldogs', 'WB', 'WBD', 'DOGS']
};

// Get all possible team name variations
function getTeamVariations(teamName: string): string[] {
  const normalized = teamName.trim();
  
  // Find the primary team name
  for (const [_primary, variations] of Object.entries(TEAM_NAME_MAPPINGS)) {
    if (variations.some(v => v.toLowerCase() === normalized.toLowerCase())) {
      return variations;
    }
  }
  
  // If not found, return the original name
  return [normalized];
}

// Normalize player names for comparison
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

// Calculate name similarity score (0-1)
function calculateNameSimilarity(name1: string, name2: string): number {
  const n1 = normalizePlayerName(name1);
  const n2 = normalizePlayerName(name2);
  
  // Exact match
  if (n1 === n2) return 1.0;
  
  // Check if one name contains the other
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;
  
  // Split into words and check for partial matches
  const words1 = n1.split(' ');
  const words2 = n2.split(' ');
  
  let matchedWords = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (word1 === word2 && word1.length > 2) { // Only count meaningful words
        matchedWords++;
        break;
      }
    }
  }
  
  const maxWords = Math.max(words1.length, words2.length);
  return matchedWords / maxWords;
}

// Check if teams match
function teamsMatch(injuryTeam: string, playerTeam: string): boolean {
  const injuryVariations = getTeamVariations(injuryTeam);
  const playerVariations = getTeamVariations(playerTeam);
  
  return injuryVariations.some(iv => 
    playerVariations.some(pv => 
      iv.toLowerCase() === pv.toLowerCase()
    )
  );
}

// Match confidence levels
function getMatchConfidence(
  nameSimilarity: number, 
  teamMatch: boolean, 
  positionMatch: boolean
): EnhancedInjuryData['matchConfidence'] {
  if (nameSimilarity >= 0.95 && teamMatch && positionMatch) return 'exact';
  if (nameSimilarity >= 0.9 && teamMatch) return 'high';
  if (nameSimilarity >= 0.8 && teamMatch) return 'medium';
  if (nameSimilarity >= 0.7) return 'low';
  return 'none';
}

/**
 * Convert normalized injury data to legacy format for backward compatibility
 */
function convertNormalizedToLegacy(normalized: NormalizedInjuryData): InjuryData {
  return {
    id: `${normalized.team_id}-${normalized.player}`,
    name: normalized.player,
    team: normalized.team_name,
    position: '', // Not provided in normalized format
    injury: normalized.injury_raw,
    status: normalized.returning_raw,
    expectedReturn: normalized.returning_raw,
    details: normalized.notes
  };
}

/**
 * Links normalized injury data with players from the database
 */
export async function linkNormalizedInjuriesWithPlayers(
  injuries: NormalizedInjuryData[], 
  players: Player[]
): Promise<EnhancedNormalizedInjuryData[]> {
  const enhancedInjuries: EnhancedNormalizedInjuryData[] = [];
  
  for (const injury of injuries) {
    let bestMatch: Player | undefined;
    let bestConfidence: EnhancedNormalizedInjuryData['matchConfidence'] = 'none';
    let bestScore = 0;
    
    // Try to find the best matching player
    for (const player of players) {
      const nameSimilarity = calculateNameSimilarity(injury.player, player.name);
      // Use team_name or team_id for matching
      const teamMatch = teamsMatch(injury.team_name, player.team || '') || 
                       teamsMatch(injury.team_id, player.team || '');
      const positionMatch = false; // Position not available in normalized format
      
      const confidence = getMatchConfidence(nameSimilarity, teamMatch, positionMatch);
      
      // Calculate overall score for ranking
      let score = nameSimilarity;
      if (teamMatch) score += 0.3;
      if (positionMatch) score += 0.1;
      
      // Only consider matches with reasonable confidence
      if (confidence !== 'none' && score > bestScore) {
        bestMatch = player;
        bestConfidence = confidence;
        bestScore = score;
      }
    }
    
    enhancedInjuries.push({
      ...injury,
      linkedPlayer: bestMatch,
      matchConfidence: bestConfidence
    });
  }
  
  return enhancedInjuries;
}

/**
 * Links injury data with players from the database
 */
export async function linkInjuriesWithPlayers(
  injuries: InjuryData[], 
  players: Player[]
): Promise<EnhancedInjuryData[]> {
  const enhancedInjuries: EnhancedInjuryData[] = [];
  
  for (const injury of injuries) {
    let bestMatch: Player | undefined;
    let bestConfidence: EnhancedInjuryData['matchConfidence'] = 'none';
    let bestScore = 0;
    
    // Try to find the best matching player
    for (const player of players) {
      const nameSimilarity = calculateNameSimilarity(injury.name, player.name);
      const teamMatch = teamsMatch(injury.team, player.team || '');
      const positionMatch = injury.position === player.position;
      
      const confidence = getMatchConfidence(nameSimilarity, teamMatch, positionMatch);
      
      // Calculate overall score for ranking
      let score = nameSimilarity;
      if (teamMatch) score += 0.3;
      if (positionMatch) score += 0.1;
      
      // Only consider matches with reasonable confidence
      if (confidence !== 'none' && score > bestScore) {
        bestMatch = player;
        bestConfidence = confidence;
        bestScore = score;
      }
    }
    
    enhancedInjuries.push({
      ...injury,
      linkedPlayer: bestMatch,
      matchConfidence: bestConfidence
    });
  }
  
  return enhancedInjuries;
}

/**
 * Get players from API for linking
 */
export async function fetchPlayersForLinking(): Promise<Player[]> {
  try {
    const response = await fetch('/api/players?limit=5000'); // High limit for comprehensive matching
    const data = await response.json();
    return Array.isArray(data) ? data : data.players || [];
  } catch (error) {
    console.error('Failed to fetch players for linking:', error);
    return [];
  }
}

/**
 * Enhanced hook that returns injuries with linked player data
 */
export interface UseEnhancedInjuryDataOptions {
  teamFilter?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  enablePlayerLinking?: boolean;
}

export interface UseEnhancedInjuryDataReturn {
  injuries: EnhancedNormalizedInjuryData[];
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  count: number;
  linkingStats: {
    exactMatches: number;
    highConfidenceMatches: number;
    totalLinked: number;
    totalInjuries: number;
  };
  // Legacy support
  legacyInjuries: EnhancedInjuryData[];
}

export function useEnhancedInjuryData(
  options: UseEnhancedInjuryDataOptions = {}
): UseEnhancedInjuryDataReturn {
  const { 
    teamFilter, 
    autoRefresh = false, 
    refreshInterval = 300000,
    enablePlayerLinking = true 
  } = options;

  const [injuries, setInjuries] = useState<EnhancedNormalizedInjuryData[]>([]);
  const [legacyInjuries, setLegacyInjuries] = useState<EnhancedInjuryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch injury data
      const injuryUrl = teamFilter ? `/api/injuries?team=${teamFilter}` : '/api/injuries';
      const injuryResponse = await fetch(injuryUrl);
      const injuryData = await injuryResponse.json();

      if (!injuryData.success) {
        throw new Error(injuryData.error || 'Failed to fetch injury data');
      }

      const normalizedInjuries: NormalizedInjuryData[] = injuryData.data || [];

      let enhancedInjuries: EnhancedNormalizedInjuryData[];
      let enhancedLegacyInjuries: EnhancedInjuryData[];

      if (enablePlayerLinking) {
        // Fetch players for linking
        const players = await fetchPlayersForLinking();
        enhancedInjuries = await linkNormalizedInjuriesWithPlayers(normalizedInjuries, players);
        
        // Also create legacy format for backward compatibility
        const legacyFormat = normalizedInjuries.map(convertNormalizedToLegacy);
        enhancedLegacyInjuries = await linkInjuriesWithPlayers(legacyFormat, players);
      } else {
        // Just convert to enhanced format without linking
        enhancedInjuries = normalizedInjuries.map(injury => ({
          ...injury,
          matchConfidence: 'none' as const
        }));
        
        const legacyFormat = normalizedInjuries.map(convertNormalizedToLegacy);
        enhancedLegacyInjuries = legacyFormat.map(injury => ({
          ...injury,
          matchConfidence: 'none' as const
        }));
      }

      setInjuries(enhancedInjuries);
      setLegacyInjuries(enhancedLegacyInjuries);
      setLastUpdated(injuryData.lastUpdated || new Date().toISOString());
    } catch (err) {
      console.error('Failed to fetch enhanced injury data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch injury data');
    } finally {
      setLoading(false);
    }
  }, [teamFilter, enablePlayerLinking]);

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh || refreshInterval <= 0) return;

    const interval = setInterval(() => {
      fetchData();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchData]);

  // Calculate linking stats
  const linkingStats = {
    exactMatches: injuries.filter(i => i.matchConfidence === 'exact').length,
    highConfidenceMatches: injuries.filter(i => ['exact', 'high'].includes(i.matchConfidence)).length,
    totalLinked: injuries.filter(i => i.linkedPlayer).length,
    totalInjuries: injuries.length
  };

  return {
    injuries,
    legacyInjuries,
    loading,
    error,
    lastUpdated,
    refresh,
    count: injuries.length,
    linkingStats
  };
}
