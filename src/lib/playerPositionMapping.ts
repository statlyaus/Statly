/**
 * Player Position Mapping Service
 * Maps player names to their correct AFL positions
 */

// Import the existing AFL players data
import aflPlayers from '../data/aflPlayers';

// Create a map for fast lookups
type PositionCode = 'DEF' | 'MID' | 'RUC' | 'FWD';
const playerPositionMap = new Map<string, PositionCode>();

// Performance optimization: Indexes for efficient lookups
const lastNameIndex = new Map<string, PositionCode>();
const firstNameIndex = new Map<string, Set<PositionCode>>();
const partialMatchCache = new Map<string, PositionCode>();

// Popular AFL players with their correct positions
const additionalPlayers: Array<{ name: string; position: PositionCode }> = [
  // Top AFL players not in the main data file
  { name: 'Max Gawn', position: 'RUC' },
  { name: 'Jordan Dawson', position: 'DEF' },
  { name: 'Brodie Grundy', position: 'RUC' },
  { name: 'Max Holmes', position: 'MID' },
  { name: 'Matt Rowell', position: 'MID' },
  { name: 'Jesse Hogan', position: 'FWD' },
  { name: 'Isaac Heeney', position: 'FWD' },
  { name: 'Errol Gulden', position: 'MID' },
  { name: 'Nick Daicos', position: 'MID' },
  { name: 'Sam Walsh', position: 'MID' },
  { name: 'Patrick Cripps', position: 'MID' },
  { name: 'Christian Petracca', position: 'MID' },
  { name: 'Clayton Oliver', position: 'MID' },
  { name: 'Marcus Bontempelli', position: 'MID' },
  { name: 'Lachie Neale', position: 'MID' },
  { name: 'Touk Miller', position: 'MID' },
  { name: 'Jeremy Cameron', position: 'FWD' },
  { name: 'Charlie Curnow', position: 'FWD' },
  { name: 'Tom Hawkins', position: 'FWD' },
  { name: 'Lance Franklin', position: 'FWD' },
  { name: 'Taylor Walker', position: 'FWD' },
  { name: 'Tom Lynch', position: 'FWD' },
  { name: 'Jack Crisp', position: 'DEF' },
  { name: 'Jake Lloyd', position: 'DEF' },
  { name: 'Daniel Rich', position: 'DEF' },
  { name: 'Shannon Hurn', position: 'DEF' },
  { name: 'Rory Laird', position: 'DEF' },
  { name: 'Todd Goldstein', position: 'RUC' },
  { name: 'Sean Darcy', position: 'RUC' },
  { name: 'Nic Naitanui', position: 'RUC' },
  { name: 'Tim English', position: 'RUC' },

  // Additional star players
  { name: 'Andrew Brayshaw', position: 'MID' },
  { name: 'Zac Butters', position: 'MID' },
  { name: 'Connor Rozee', position: 'FWD' },
  { name: 'Toby Greene', position: 'FWD' },
  { name: 'Tom Stewart', position: 'DEF' },
  { name: 'Jack Sinclair', position: 'DEF' },
  { name: 'Josh Dunkley', position: 'MID' },
  { name: 'Noah Anderson', position: 'MID' },
  { name: 'Tom Green', position: 'MID' },
  { name: 'James Sicily', position: 'DEF' },
  { name: 'Jack Martin', position: 'FWD' },
  { name: 'David Mundy', position: 'MID' },
  { name: 'Ben King', position: 'FWD' },
  { name: 'Mitch Duncan', position: 'MID' },
  { name: 'Ollie Wines', position: 'MID' },
  { name: 'Patrick Dangerfield', position: 'MID' },
  { name: 'Lachlan Sholl', position: 'MID' },
  { name: 'Jaidyn Stephenson', position: 'FWD' },
  { name: 'Zach Merrett', position: 'MID' },
  { name: 'Aaron Naughton', position: 'FWD' },
  { name: 'Jack Macrae', position: 'MID' },
  { name: 'Marlion Pickett', position: 'MID' },
  { name: 'Charlie Cameron', position: 'FWD' },
  { name: 'Luke Parker', position: 'MID' },
  { name: 'Ben Cunnington', position: 'MID' },
  { name: 'Jack Viney', position: 'MID' },
  { name: 'Steele Sidebottom', position: 'MID' },
  { name: 'Nick Haynes', position: 'DEF' },
  { name: 'Sam Docherty', position: 'DEF' },
  { name: 'Jack Riewoldt', position: 'FWD' },
  { name: 'Dayne Zorko', position: 'MID' },
  { name: 'Caleb Daniel', position: 'DEF' }, // Often plays as a defender despite being small
  { name: 'Dustin Martin', position: 'MID' },
  { name: 'Brandon Ellis', position: 'MID' },
  { name: 'Jack Billings', position: 'MID' },
  { name: 'Callum Mills', position: 'DEF' },
  { name: 'Luke Breust', position: 'FWD' },
  { name: 'Darcy Parish', position: 'MID' },
  { name: 'Sam Menegola', position: 'MID' },
  { name: 'Jack Ziebell', position: 'MID' },
  { name: 'David Zaharakis', position: 'MID' },
];

// Initialize the position map and indexes
function initializePositionMap() {
  // Add players from the AFL players data file
  aflPlayers.forEach((player) => {
    if (!player?.name || typeof player.name !== 'string') {
      return; // Skip invalid entries
    }
    const normalizedName = normalizePlayerName(player.name);
    if (player.position) {
      playerPositionMap.set(normalizedName, player.position as PositionCode);
      buildIndexes(normalizedName, player.position as PositionCode);
    }
  });

  // Add additional popular players (fill only gaps)
  additionalPlayers.forEach((player) => {
    const normalizedName = normalizePlayerName(player.name);
    if (!playerPositionMap.has(normalizedName)) {
      playerPositionMap.set(normalizedName, player.position);
      buildIndexes(normalizedName, player.position);
    }
  });
}

// Build indexes for efficient lookups
function buildIndexes(normalizedName: string, position: PositionCode) {
  const nameParts = normalizedName.split(' ').filter(Boolean);

  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];

    // Build last name index (most common lookup)
    if (!lastNameIndex.has(lastName)) {
      lastNameIndex.set(lastName, position);
    }

    // Build first name index (for partial matches)
    if (!firstNameIndex.has(firstName)) {
      firstNameIndex.set(firstName, new Set());
    }
    firstNameIndex.get(firstName)!.add(position);
  }
}

/**
 * Normalize player name for consistent matching
 * Handles variations in naming (spaces, case, punctuation)
 */
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' '); // Normalize whitespace
}

export function getPlayerPosition(playerName: string): PositionCode {
  if (!playerName || typeof playerName !== 'string') {
    return 'MID'; // Default fallback
  }

  // Initialize map if not done
  if (playerPositionMap.size === 0) {
    initializePositionMap();
  }

  const normalizedName = normalizePlayerName(playerName);

  // Check cache first
  const cachedResult = partialMatchCache.get(normalizedName);
  if (cachedResult) {
    return cachedResult;
  }

  // Try exact match first
  const exactMatch = playerPositionMap.get(normalizedName);
  if (exactMatch) {
    partialMatchCache.set(normalizedName, exactMatch);
    return exactMatch;
  }

  // Try efficient indexed lookups instead of O(n) iteration
  const result = findPositionWithIndexes(normalizedName);
  if (result) {
    partialMatchCache.set(normalizedName, result);
    return result;
  }

  // Intelligent position guessing based on name patterns and stats
  const guessedPosition = guessPositionFromName(normalizedName);
  partialMatchCache.set(normalizedName, guessedPosition);
  return guessedPosition;
}

export function getExactMappedPlayerPosition(playerName: string): PositionCode | null {
  if (!playerName || typeof playerName !== 'string') {
    return null;
  }

  if (playerPositionMap.size === 0) {
    initializePositionMap();
  }

  const normalizedName = normalizePlayerName(playerName);
  return playerPositionMap.get(normalizedName) ?? null;
}

// Efficient position lookup using indexes
function findPositionWithIndexes(normalizedName: string): PositionCode | null {
  const nameParts = normalizedName.split(' ').filter(Boolean);

  if (nameParts.length >= 2) {
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];

    // Try last name index first (most common case)
    const lastNameMatch = lastNameIndex.get(lastName);
    if (lastNameMatch) {
      return lastNameMatch;
    }

    // Try first name + last name combination
    const firstNamePositions = firstNameIndex.get(firstName);
    if (firstNamePositions && firstNamePositions.size === 1) {
      // If only one position for this first name, likely a match
      return Array.from(firstNamePositions)[0];
    }

    // Try first initial + last name
    if (firstName.length > 0) {
      const firstInitial = firstName[0];
      const initialPositions = firstNameIndex.get(firstInitial);
      if (initialPositions && initialPositions.size === 1) {
        return Array.from(initialPositions)[0];
      }
    }
  }

  // Fallback to substring matching only for single-word names
  if (nameParts.length === 1) {
    const singleName = nameParts[0];
    for (const [mapName, position] of Array.from(playerPositionMap.entries())) {
      if (mapName.includes(singleName) || singleName.includes(mapName)) {
        return position;
      }
    }
  }

  return null;
}

function guessPositionFromName(normalizedName: string): PositionCode {
  const parts = normalizedName.split(' ').filter(Boolean);
  const last = parts[parts.length - 1] || normalizedName;

  // Known surnames for rucks
  const RUCK = new Set(['gawn', 'grundy', 'goldstein', 'english']);
  if (last === 'ruck' || RUCK.has(last)) return 'RUC';

  // Common forward surnames
  const FWD = new Set([
    'cameron',
    'franklin',
    'curnow',
    'hawkins',
    'walker',
    'lynch',
    'king',
    'hogan',
  ]);
  if (FWD.has(last)) return 'FWD';

  // Common defender surnames
  const DEF = new Set(['lloyd', 'rich', 'stewart', 'laird', 'crisp', 'hurn', 'sinclair']);
  if (DEF.has(last)) return 'DEF';

  // Default to midfielder for unknown or unmatched names
  return 'MID' as PositionCode;
}

/**
 * Get all available positions
 */
export const AVAILABLE_POSITIONS = ['DEF', 'MID', 'RUC', 'FWD'] as const;

/**
 * Check if a position is valid
 */
export function isValidPosition(
  position: string
): position is (typeof AVAILABLE_POSITIONS)[number] {
  return (AVAILABLE_POSITIONS as readonly string[]).includes(position);
}

/**
 * Get position display name
 */
export function getPositionDisplayName(position: string): string {
  switch (position) {
    case 'DEF':
      return 'Defender';
    case 'MID':
      return 'Midfielder';
    case 'RUC':
      return 'Ruck';
    case 'FWD':
      return 'Forward';
    default:
      return 'Unknown';
  }
}

// Export the position map for debugging
export function getPositionMapSize(): number {
  if (playerPositionMap.size === 0) {
    initializePositionMap();
  }
  return playerPositionMap.size;
}

// Performance monitoring utilities
export function getIndexSizes(): {
  playerMap: number;
  lastNameIndex: number;
  firstNameIndex: number;
  cacheSize: number;
} {
  if (playerPositionMap.size === 0) {
    initializePositionMap();
  }
  return {
    playerMap: playerPositionMap.size,
    lastNameIndex: lastNameIndex.size,
    firstNameIndex: firstNameIndex.size,
    cacheSize: partialMatchCache.size,
  };
}

// Clear cache (useful for testing or memory management)
export function clearCache(): void {
  partialMatchCache.clear();
}

// Get cache hit rate (for performance monitoring)
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: partialMatchCache.size,
    entries: Array.from(partialMatchCache.keys()),
  };
}
