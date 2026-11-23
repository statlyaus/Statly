import type { Prisma } from '@prisma/client';

import { requireActiveSeasonId } from '@/server/leagues/activeSeason';
import { removePlayersFromOpenLineups } from '@/server/leagues/playerMoveLock';

/** A dropped player stays on waivers this long before free agency. */
export const DROP_WAIVER_HOLD_MS = 24 * 60 * 60 * 1000;

export interface RosterDropInput {
  leagueId: string;
  memberId: string;
  /** The canonical player id; the waiver hold is written under it. */
  playerId: string;
  /** The id his roster row is stored under, when it is an older alias of `playerId`. */
  rowPlayerId?: string;
  /** Stored on the DROP_PLAYER action; `playerId` is always set to the canonical id. */
  details?: Record<string, unknown>;
  now?: Date;
}

/**
 * Removes one player from a member's roster inside the caller's transaction: the roster row, his
 * unlocked lineup rows from the round in progress onward, and a DROP_PLAYER action that is his
 * waiver hold. All three commit together, so a reported drop always has its hold. Returns null when
 * the player is not on that member's roster in that league. The caller holds the League row lock
 * and has already run the freeze, window and game-lock checks.
 */
export async function dropRosterPlayerInTransaction(
  tx: Prisma.TransactionClient,
  input: RosterDropInput
): Promise<{ actionId: string; processingAt: Date } | null> {
  const { leagueId, memberId, playerId } = input;
  const rowPlayerId = input.rowPlayerId ?? playerId;
  const now = input.now ?? new Date();

  // Exactly one roster row: two players in one identity group are still two rows.
  const removed = await tx.leagueRosterPlayer.deleteMany({
    where: { leagueId, memberId, playerId: rowPlayerId },
  });
  if (removed.count === 0) return null;

  await removePlayersFromOpenLineups(tx, {
    leagueId,
    memberId,
    playerIds: [...new Set([rowPlayerId, playerId])],
    now,
  });

  const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const processingAt = new Date(now.getTime() + DROP_WAIVER_HOLD_MS);
  await tx.teamAction.create({
    data: {
      id: actionId,
      leagueId,
      seasonId: await requireActiveSeasonId(tx, leagueId),
      memberId,
      actionType: 'DROP_PLAYER',
      // The details are JSON values: parsed from a request body or built from ids.
      details: { ...input.details, playerId } as Prisma.InputJsonObject,
      processingAt,
    },
  });
  return { actionId, processingAt };
}
