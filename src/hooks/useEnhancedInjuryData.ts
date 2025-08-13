import { useState, useEffect, useCallback } from 'react';
import type { Player } from '@/types/players';

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
const TEAM_NAME_MAPPINGS: Record<string, string[]> = {
  'Adelaide': ['Adelaide', 'Adelaide Crows', 'ADE', 'ADEL'],
  'Brisbane': ['Brisbane', 'Brisbane Lions', 'BRIS', 'BL'],
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
    const response = await fetch('/api/players?limit=1000'); // Get more players for better matching
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
  injuries: EnhancedInjuryData[];
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
}
