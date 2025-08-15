import type { Player } from '@/types/players';
import { logger } from '@/lib/logger';

/**
 * Validates and sanitizes player data
 */
export function validatePlayer(data: unknown): Player | null {
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  // Required fields
  if (!obj.id || !obj.name) return null;

  try {
    const player: Player = {
      id: String(obj.id),
      name: String(obj.name).trim(),
      team: obj.team ? String(obj.team).trim() : undefined,
      position: obj.position ? String(obj.position).trim() : undefined,
      injury: obj.injury ? String(obj.injury).trim() : undefined,
      games: typeof obj.games === 'number' ? obj.games : undefined,
      avg: typeof obj.avg === 'number' ? obj.avg : undefined,

      // Stats validation
      stats: obj.stats && typeof obj.stats === 'object' ? validateStats(obj.stats) : undefined,

      // Other fields
      summary: obj.summary ? String(obj.summary) : undefined,
    };

    return player;
  } catch (error) {
    logger.warn('Failed to validate player data', { error, data });
    return null;
  }
}

/**
 * Validates and sanitizes stats object
 */
function validateStats(stats: unknown): Record<string, number | string> | undefined {
  if (!stats || typeof stats !== 'object') return undefined;

  const statsObj = stats as Record<string, unknown>;
  const validStats: Record<string, number | string> = {};

  for (const [key, value] of Object.entries(statsObj)) {
    if (typeof value === 'number' && !isNaN(value)) {
      validStats[key] = value;
    } else if (typeof value === 'string' && value.trim()) {
      // Try to parse as number, otherwise keep as string
      const numValue = parseFloat(value);
      validStats[key] = !isNaN(numValue) ? numValue : value.trim();
    }
  }

  return Object.keys(validStats).length > 0 ? validStats : undefined;
}

/**
 * Validates an array of players, filtering out invalid ones
 */
export function validatePlayers(data: unknown[]): Player[] {
  if (!Array.isArray(data)) return [];

  return data.map(validatePlayer).filter((player): player is Player => player !== null);
}

/**
 * Checks if a player has minimum required data for display
 */
export function isPlayerDisplayReady(player: Player): boolean {
  return !!(player.id && player.name && player.team);
}

/**
 * Safely gets a numeric stat value
 */
export function getPlayerStat(player: Player, statKey: string): number | null {
  if (!player.stats) return null;

  const value = player.stats[statKey];

  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numValue = parseFloat(value);
    return !isNaN(numValue) ? numValue : null;
  }

  return null;
}

/**
 * Formats a stat value for display
 */
export function formatPlayerStat(player: Player, statKey: string): string {
  const value = getPlayerStat(player, statKey);

  if (value === null) return '—';

  // Special formatting for percentages
  if (statKey.toLowerCase().includes('percentage') || statKey.toLowerCase().includes('%')) {
    return `${value.toFixed(1)}%`;
  }

  // Integer stats
  if (Number.isInteger(value)) {
    return value.toString();
  }

  // Decimal stats
  return value.toFixed(1);
}
