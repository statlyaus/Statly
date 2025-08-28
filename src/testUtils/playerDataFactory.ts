/**
 * Player Data Factory for Testing and Examples
 * Provides reusable functions to create PlayerCardData fixtures
 */

import type { PlayerCardData, PlayerStatus, PerformanceTrend } from '@/components/player/PlayerCard';

// Default base player data with realistic values
const DEFAULT_PLAYER_DATA: PlayerCardData = {
  id: '1',
  name: 'Marcus Bontempelli',
  team: 'WBD',
  position: 'MID',
  jerseyNumber: 4,
  status: 'available',
  currentPrice: 750000,
  averageScore: 112.5,
  totalPoints: 2250,
  gamesPlayed: 20,
  trend: 'up',
  lastGameScore: 125,
  seasonHigh: 165,
  projectedScore: 118,
  nextGame: {
    opponent: 'COL',
    date: new Date('2025-08-30'),
    isHome: true,
  },
  ownership: 85.2,
  selectedByOpponents: 3,
  priceChange: 25000,
  isStarred: true,
  metadata: {
    captain: false,
    rookie: false,
  },
};

/**
 * Creates a PlayerCardData object with default values and optional overrides
 * @param overrides - Partial PlayerCardData to override default values
 * @returns Complete PlayerCardData object
 */
export function createExamplePlayer(overrides: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    ...DEFAULT_PLAYER_DATA,
    ...overrides,
    // Handle nested object overrides properly
    nextGame: overrides.nextGame ? {
      ...DEFAULT_PLAYER_DATA.nextGame!,
      ...overrides.nextGame,
    } : DEFAULT_PLAYER_DATA.nextGame,
    metadata: overrides.metadata ? {
      ...DEFAULT_PLAYER_DATA.metadata!,
      ...overrides.metadata,
    } : DEFAULT_PLAYER_DATA.metadata,
  };
}

/**
 * Creates multiple example players with variations
 * @param count - Number of players to create
 * @param baseOverrides - Base overrides to apply to all players
 * @returns Array of PlayerCardData objects
 */
export function createExamplePlayers(
  count: number, 
  baseOverrides: Partial<PlayerCardData> = {}
): PlayerCardData[] {
  const players: PlayerCardData[] = [];
  
  for (let i = 0; i < count; i++) {
    players.push(createExamplePlayer({
      ...baseOverrides,
      id: `player-${i + 1}`,
      name: `Player ${i + 1}`,
      jerseyNumber: (i + 1),
    }));
  }
  
  return players;
}

// Pre-configured player variations for common test scenarios
export const PLAYER_VARIATIONS = {
  injured: (): PlayerCardData => createExamplePlayer({
    status: 'injured' as PlayerStatus,
    trend: 'down' as PerformanceTrend,
    priceChange: -15000,
    isStarred: false,
  }),

  suspended: (): PlayerCardData => createExamplePlayer({
    id: '2',
    name: 'Tom Mitchell',
    team: 'HAW',
    position: 'FWD',
    status: 'suspended' as PlayerStatus,
    currentPrice: 680000,
    averageScore: 95.2,
  }),

  rookie: (): PlayerCardData => createExamplePlayer({
    id: '3',
    name: 'Jake Johnson',
    team: 'ESS',
    position: 'DEF',
    jerseyNumber: 35,
    status: 'available' as PlayerStatus,
    currentPrice: 350000,
    averageScore: 65.8,
    totalPoints: 987,
    ownership: 12.4,
    metadata: { rookie: true, captain: false },
  }),

  premium: (): PlayerCardData => createExamplePlayer({
    id: '4',
    name: 'Clayton Oliver',
    team: 'MEL',
    position: 'MID',
    jerseyNumber: 4,
    currentPrice: 850000,
    averageScore: 125.3,
    totalPoints: 2506,
    seasonHigh: 180,
    ownership: 92.1,
    trend: 'up' as PerformanceTrend,
    priceChange: 45000,
  }),

  bye: (): PlayerCardData => createExamplePlayer({
    id: '5',
    name: 'Patrick Cripps',
    team: 'CAR',
    position: 'MID',
    status: 'bye' as PlayerStatus,
    // omit nextGame entirely to satisfy exact optional types
  }),
} as const;

/**
 * Creates a player with minimal required fields for testing edge cases
 */
export function createMinimalPlayer(overrides: Partial<PlayerCardData> = {}): PlayerCardData {
  return createExamplePlayer({
    // omit optional fields instead of setting explicit undefined
    isStarred: false,
    ...overrides,
  });
}
