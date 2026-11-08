import type { Prisma, PrismaClient } from '@prisma/client';

import { isActivePrismaMembership } from '@/server/leagues/activeMembership';
import { inActiveSeason } from '@/server/leagues/activeSeason';
import {
  evaluateRosterExchangeCapacity,
  getLeagueRosterCapacity,
} from '@/server/rosters/rosterCapacity';

export type FreeAgentAddErrorCode =
  | 'NOT_ACTIVE_MEMBER'
  | 'PLAYER_NOT_FOUND'
  | 'PLAYER_OWNED'
  | 'PLAYER_ON_WAIVERS'
  | 'ROSTER_FULL';

export class FreeAgentAddError extends Error {
  constructor(
    public readonly code: FreeAgentAddErrorCode,
    message: string,
    public readonly status: 403 | 404 | 409 | 422
  ) {
    super(message);
    this.name = 'FreeAgentAddError';
  }
}

export interface FreeAgentAddInput {
  leagueId: string;
  userId: string;
  /** Canonical player id; the roster row is stored under it. */
  playerId: string;
  /** Every id the player is known by, since older roster rows can still hold an alias. */
  playerAliasIds: string[];
}

export interface FreeAgentAddResult {
  memberId: string;
  rosterPlayerId: string;
}

type FreeAgentAddDb = Pick<PrismaClient, '$transaction'>;

/**
 * Adds an unowned player to the caller's roster in one transaction. The caller must be an active
 * member, the player must be unowned (under any alias) and off a drop waiver hold, and the roster must
 * have room under the same rosterSize + benchSize capacity the draft, trades and waivers use.
 */
export async function addFreeAgentToRoster(
  db: FreeAgentAddDb,
  input: FreeAgentAddInput
): Promise<FreeAgentAddResult> {
  const { leagueId, userId, playerId } = input;
  const playerAliasIds = [...new Set([playerId, ...input.playerAliasIds])];

  try {
    return await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // No-op write that takes the member row lock, so two adds by one manager settle one at a time
      // and cannot both pass the capacity check.
      await tx.$executeRaw`UPDATE "LeagueMember" SET "isActive" = "isActive" WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}`;

      const member = await tx.leagueMember.findFirst({
        where: { leagueId, userId },
        select: {
          id: true,
          isActive: true,
          status: true,
          league: { select: { settings: { select: { rosterSize: true, benchSize: true } } } },
        },
      });
      if (!member || !isActivePrismaMembership(member)) {
        throw new FreeAgentAddError(
          'NOT_ACTIVE_MEMBER',
          'You are not an active manager in this league',
          403
        );
      }

      const player = await tx.player.findUnique({ where: { id: playerId }, select: { id: true } });
      if (!player) throw new FreeAgentAddError('PLAYER_NOT_FOUND', 'Player not found', 404);

      const owned = await tx.leagueRosterPlayer.findFirst({
        where: { leagueId, playerId: { in: playerAliasIds } },
        select: { memberId: true },
      });
      if (owned) {
        throw new FreeAgentAddError('PLAYER_OWNED', 'Player already owned in this league', 409);
      }

      const activeWaiverHold = await tx.teamAction.findFirst({
        where: {
          leagueId,
          ...inActiveSeason(leagueId),
          actionType: 'DROP_PLAYER',
          status: 'PENDING',
          processingAt: { gt: new Date() },
          details: { path: ['playerId'], equals: playerId },
        },
        select: { id: true },
      });
      if (activeWaiverHold) {
        throw new FreeAgentAddError('PLAYER_ON_WAIVERS', 'Player is on waivers', 409);
      }

      const currentCount = await tx.leagueRosterPlayer.count({
        where: { leagueId, memberId: member.id },
      });
      const capacity = evaluateRosterExchangeCapacity({
        currentCount,
        outgoingCount: 0,
        incomingCount: 1,
        capacity: getLeagueRosterCapacity(member.league.settings),
      });
      if (!capacity.isAllowed) {
        throw new FreeAgentAddError(
          'ROSTER_FULL',
          `Your roster is full (${capacity.currentCount} of ${capacity.capacity}). Drop a player first.`,
          422
        );
      }

      const rosterPlayer = await tx.leagueRosterPlayer.create({
        data: { leagueId, memberId: member.id, playerId, acquiredBy: 'FREE_AGENT' },
        select: { id: true },
      });
      return { memberId: member.id, rosterPlayerId: rosterPlayer.id };
    });
  } catch (error) {
    // A concurrent add of the same player loses on the (leagueId, playerId) unique key.
    if (isUniqueConstraintError(error)) {
      throw new FreeAgentAddError('PLAYER_OWNED', 'Player already owned in this league', 409);
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}
