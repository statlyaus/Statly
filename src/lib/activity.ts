import { adminDb } from '@/lib/firebaseAdmin';

export type LeagueActivityType = string;

export interface LeagueActivityData {
  [key: string]: unknown;
}

/**
 * Writes an activity record to leagues/{leagueId}/activity.
 * - Strips undefined fields
 * - Adds leagueId, type, and timestamp
 */
export async function logLeagueActivity(
  leagueId: string,
  type: LeagueActivityType,
  data: LeagueActivityData
): Promise<void> {
  const baseRecord: Record<string, unknown> = {
    leagueId,
    type,
    timestamp: new Date(),
    ...data,
  };

  const pruned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(baseRecord)) {
    if (value !== undefined) pruned[key] = value;
  }

  try {
    await adminDb.collection(`leagues/${leagueId}/activity`).add(pruned);
  } catch (error) {
    // Use project logger if available; fallback to console
    try {
      const { logger } = await import('@/lib/logger');
      logger.error('Failed to log league activity', { leagueId, type, data: pruned, error });
    } catch {
      // Fallback logging
      console.error('Failed to log league activity', { leagueId, type, data: pruned, error });
    }
    throw error;
  }
}


