// src/types/injuries.ts
/**
 * Types for the normalized injury data schema (v2.0)
 */

import type { Player } from './players';

/**
 * Normalized injury data structure with canonical team codes and parsed timeframes
 */
export interface NormalizedInjuryData {
  team_id: string;           // Canonical team code (e.g., "ADL", "BRI", "CAR")
  team_name: string;         // Full team name (e.g., "Adelaide Crows")
  player: string;            // Player name
  injury_raw: string;        // Original injury description
  returning_raw: string;     // Original return timeframe text
  
  // Parsed status information
  status: 'TEST' | 'TBC' | 'SEASON' | 'PROTOCOLS' | 'WEEKS' | 'DAYS' | 'UNKNOWN';
  
  // Parsed ETA timeframes (when applicable)
  eta_weeks_min?: number;
  eta_weeks_max?: number;
  eta_days_min?: number;
  eta_days_max?: number;
  
  notes?: string;            // Additional context
}

/**
 * Enhanced normalized injury data with player linking
 */
export interface EnhancedNormalizedInjuryData extends NormalizedInjuryData {
  linkedPlayer?: Player;
  matchConfidence: 'exact' | 'high' | 'medium' | 'low' | 'none';
}

/**
 * Legacy injury data structure (for backward compatibility)
 */
export interface LegacyInjuryData {
  id: string;
  name: string;
  team: string;
  position: string;
  injury: string;
  status: string;
  expectedReturn?: string;
  details?: string;
}

/**
 * API response structure for injury data
 */
export interface InjuryApiResponse {
  success: boolean;
  data: NormalizedInjuryData[];
  lastUpdated: string;
  source: string;
  schema_version: string;
  error?: string;
}

/**
 * Team canonical codes mapping
 */
export const CANONICAL_TEAM_CODES = {
  'ADL': 'Adelaide Crows',
  'BRI': 'Brisbane Lions', 
  'CAR': 'Carlton Blues',
  'COL': 'Collingwood Magpies',
  'ESS': 'Essendon Bombers',
  'FRE': 'Fremantle Dockers',
  'GEE': 'Geelong Cats',
  'GCS': 'Gold Coast Suns',
  'GWS': 'GWS Giants',
  'HAW': 'Hawthorn Hawks',
  'MEL': 'Melbourne Demons',
  'NTH': 'North Melbourne Kangaroos',
  'PAP': 'Port Adelaide Power',
  'RIC': 'Richmond Tigers',
  'STK': 'St Kilda Saints',
  'SYD': 'Sydney Swans',
  'WCE': 'West Coast Eagles',
  'WBD': 'Western Bulldogs'
} as const;

/**
 * Reverse mapping from team names to canonical codes
 */
export const TEAM_NAME_TO_CODE: Record<string, keyof typeof CANONICAL_TEAM_CODES> = {
  'Adelaide': 'ADL',
  'Adelaide Crows': 'ADL',
  'Brisbane': 'BRI', 
  'Brisbane Lions': 'BRI',
  'Carlton': 'CAR',
  'Carlton Blues': 'CAR',
  'Collingwood': 'COL',
  'Collingwood Magpies': 'COL',
  'Essendon': 'ESS',
  'Essendon Bombers': 'ESS',
  'Fremantle': 'FRE',
  'Fremantle Dockers': 'FRE',
  'Geelong': 'GEE',
  'Geelong Cats': 'GEE',
  'Gold Coast': 'GCS',
  'Gold Coast Suns': 'GCS',
  'GWS': 'GWS',
  'GWS Giants': 'GWS',
  'Greater Western Sydney': 'GWS',
  'Hawthorn': 'HAW',
  'Hawthorn Hawks': 'HAW',
  'Melbourne': 'MEL',
  'Melbourne Demons': 'MEL',
  'North Melbourne': 'NTH',
  'North Melbourne Kangaroos': 'NTH',
  'Port Adelaide': 'PAP',
  'Port Adelaide Power': 'PAP',
  'Richmond': 'RIC',
  'Richmond Tigers': 'RIC',
  'St Kilda': 'STK',
  'St Kilda Saints': 'STK',
  'Sydney': 'SYD',
  'Sydney Swans': 'SYD',
  'West Coast': 'WCE',
  'West Coast Eagles': 'WCE',
  'Western Bulldogs': 'WBD'
};

/**
 * Status display information
 */
export const STATUS_DISPLAY = {
  'TEST': { label: 'Test', color: 'yellow', description: 'Player is being tested' },
  'TBC': { label: 'TBC', color: 'blue', description: 'To be confirmed' },
  'SEASON': { label: 'Season', color: 'red', description: 'Season ending injury' },
  'PROTOCOLS': { label: 'Protocols', color: 'purple', description: 'Health and safety protocols' },
  'WEEKS': { label: 'Weeks', color: 'orange', description: 'Expected return in weeks' },
  'DAYS': { label: 'Days', color: 'green', description: 'Expected return in days' },
  'UNKNOWN': { label: 'Unknown', color: 'gray', description: 'Return timeframe unknown' }
} as const;

/**
 * Convert legacy injury data to normalized format (for backward compatibility)
 */
export function convertLegacyToNormalized(legacy: LegacyInjuryData): NormalizedInjuryData {
  const teamCode = TEAM_NAME_TO_CODE[legacy.team] || 'UNK';
  const teamName = CANONICAL_TEAM_CODES[teamCode as keyof typeof CANONICAL_TEAM_CODES] || legacy.team;
  
  return {
    team_id: teamCode,
    team_name: teamName,
    player: legacy.name,
    injury_raw: legacy.injury,
    returning_raw: legacy.expectedReturn || legacy.status,
    status: 'UNKNOWN'
  };
}

/**
 * Get formatted ETA display text
 */
export function getFormattedETA(injury: NormalizedInjuryData): string {
  switch (injury.status) {
    case 'TEST':
      return 'Being tested';
    case 'TBC':
      return 'To be confirmed';
    case 'SEASON':
      return 'Season ending';
    case 'PROTOCOLS':
      return 'Health protocols';
    case 'WEEKS':
      if (injury.eta_weeks_min !== undefined && injury.eta_weeks_min !== null) {
        if (injury.eta_weeks_max === null) {
          // Handle "X+ weeks" pattern
          return `${injury.eta_weeks_min}+ week${injury.eta_weeks_min !== 1 ? 's' : ''}`;
        }
        if (injury.eta_weeks_max !== undefined && injury.eta_weeks_max !== null) {
          if (injury.eta_weeks_min === injury.eta_weeks_max) {
            return `${injury.eta_weeks_min} week${injury.eta_weeks_min !== 1 ? 's' : ''}`;
          }
          return `${injury.eta_weeks_min}-${injury.eta_weeks_max} weeks`;
        }
      }
      return 'Several weeks';
    case 'DAYS':
      if (injury.eta_days_min !== undefined && injury.eta_days_min !== null) {
        if (injury.eta_days_max === null) {
          // Handle "X+ days" pattern
          return `${injury.eta_days_min}+ day${injury.eta_days_min !== 1 ? 's' : ''}`;
        }
        if (injury.eta_days_max !== undefined && injury.eta_days_max !== null) {
          if (injury.eta_days_min === injury.eta_days_max) {
            return `${injury.eta_days_min} day${injury.eta_days_min !== 1 ? 's' : ''}`;
          }
          return `${injury.eta_days_min}-${injury.eta_days_max} days`;
        }
      }
      return 'Several days';
    case 'UNKNOWN':
    default:
      return injury.returning_raw || 'Unknown';
  }
}
