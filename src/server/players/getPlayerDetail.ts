import 'server-only';

import { resolveCanonicalPlayerId } from '@/server/players/playerIdentityService';
import { getPoolPlayer } from '@/server/players/playerPoolReadModel';
import type { Player } from '@/types/players';

/**
 * Resolves a player by canonical or legacy id and returns the Prisma pool player with their stored
 * season totals, for the server-rendered player page. Returns null when no Prisma player matches:
 * a name in the link is never guessed, and stats are never read from Firestore here.
 */
export async function getPlayerDetail(id: string): Promise<Player | null> {
  const canonicalPlayerId = await resolveCanonicalPlayerId(decodeURIComponent(id));
  return canonicalPlayerId ? getPoolPlayer(canonicalPlayerId) : null;
}
