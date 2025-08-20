/**
 * Player Position Mapping Service
 * Maps player names to their correct AFL positions
 */

// Import the existing AFL players data
import aflPlayers from '@/Data/aflPlayers';

// Create a map for fast lookups
const playerPositionMap = new Map<string, string>();

// Popular AFL players with their correct positions
const additionalPlayers: Array<{ name: string; position: string }> = [
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

// Initialize the position map
function initializePositionMap() {
  // Add players from the AFL players data file
  aflPlayers.forEach(player => {
    const normalizedName = normalizePlayerName(player.name);
    playerPositionMap.set(normalizedName, player.position);
  });

  // Add additional popular players
  additionalPlayers.forEach(player => {
    const normalizedName = normalizePlayerName(player.name);
    playerPositionMap.set(normalizedName, player.position);
  });
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
    .replace(/\s+/g, ' '); // Normalize spaces
}

/**
 * Get player position by name
 * Returns the correct AFL position or defaults to a smart guess
 */
export function getPlayerPosition(playerName: string): string {
  if (!playerName || typeof playerName !== 'string') {
    return 'MID'; // Default fallback
  }

  // Initialize map if not done
  if (playerPositionMap.size === 0) {
    initializePositionMap();
  }

  const normalizedName = normalizePlayerName(playerName);
  
  // Try exact match first
  const exactMatch = playerPositionMap.get(normalizedName);
  if (exactMatch) {
    return exactMatch;
  }

  // Try partial matching for name variations
  for (const [mapName, position] of playerPositionMap.entries()) {
    // Check if either name contains the other (handles middle names, etc.)
    if (mapName.includes(normalizedName) || normalizedName.includes(mapName)) {
      return position;
    }

    // Check individual name parts
    const nameWords = normalizedName.split(' ');
    const mapWords = mapName.split(' ');
    
    // If we have at least first and last name matching
    if (nameWords.length >= 2 && mapWords.length >= 2) {
      const firstMatch = nameWords[0] === mapWords[0];
      const lastMatch = nameWords[nameWords.length - 1] === mapWords[mapWords.length - 1];
      
      if (firstMatch && lastMatch) {
        return position;
      }
    }
  }

  // Intelligent position guessing based on name patterns and stats
  return guessPositionFromName(normalizedName);
}

/**
 * Guess position based on common name patterns and AFL conventions
 */
function guessPositionFromName(normalizedName: string): string {
  // Known ruckman naming patterns or common ruck names
  if (normalizedName.includes('ruck') || 
      normalizedName.includes('gawn') || 
      normalizedName.includes('grundy') ||
      normalizedName.includes('goldstein') ||
      normalizedName.includes('darcy') ||
      normalizedName.includes('english')) {
    return 'RUC';
  }

  // Common forward names or patterns
  if (normalizedName.includes('cameron') ||
      normalizedName.includes('franklin') ||
      normalizedName.includes('curnow') ||
      normalizedName.includes('hawkins') ||
      normalizedName.includes('walker') ||
      normalizedName.includes('lynch') ||
      normalizedName.includes('king') ||
      normalizedName.includes('hogan')) {
    return 'FWD';
  }

  // Common defender names or patterns
  if (normalizedName.includes('lloyd') ||
      normalizedName.includes('rich') ||
      normalizedName.includes('stewart') ||
      normalizedName.includes('laird') ||
      normalizedName.includes('crisp') ||
      normalizedName.includes('hurn') ||
      normalizedName.includes('sinclair')) {
    return 'DEF';
  }

  // Default to midfielder for unknown players
  // This is statistically the most common position
  return 'MID';
}

/**
 * Get all available positions
 */
export const AVAILABLE_POSITIONS = ['DEF', 'MID', 'RUC', 'FWD'] as const;

/**
 * Check if a position is valid
 */
export function isValidPosition(position: string): boolean {
  return AVAILABLE_POSITIONS.includes(position as any);
}

/**
 * Get position display name
 */
export function getPositionDisplayName(position: string): string {
  switch (position) {
    case 'DEF': return 'Defender';
    case 'MID': return 'Midfielder';
    case 'RUC': return 'Ruck';
    case 'FWD': return 'Forward';
    default: return 'Unknown';
  }
}

// Export the position map for debugging
export function getPositionMapSize(): number {
  if (playerPositionMap.size === 0) {
    initializePositionMap();
  }
  return playerPositionMap.size;
}
