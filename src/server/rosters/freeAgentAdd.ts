import type { Prisma, PrismaClient } from '@prisma/client';

import { isActivePrismaMembership } from '@/server/leagues/activeMembership';
import { describeLockedPlayers, findPlayersLockedForMove } from '@/server/leagues/playerMoveLock';
import { getTransactionWindow } from '@/server/leagues/transactionWindow';
import {
  evaluateRosterExchangeCapacity,
  getLeagueRosterCapacity,
} from '@/server/rosters/rosterCapacity';
import { loadWaiverOnlyHolds } from '@/server/waivers/waiverOnlyPlayers';

export type FreeAgentAddErrorCode =
  | 'NOT_ACTIVE_MEMBER'
  | 'DRAFT_NOT_COMPLETE'
  | 'PLAYER_NOT_FOUND'
  | 'PLAYER_OWNED'
  | 'PLAYER_ON_WAIVERS'
  | 'PLAYER_LOCKED'
  | 'TIMING_UNAVAILABLE'
  | 'ROSTER_FULL';

export class FreeAgentAddError extends Error {
  constructor(
    public readonly code: FreeAgentAddErrorCode,
    message: string,
    public readonly status: 403 | 404 | 409 | 422 | 503
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
  now?: Date;
}

export interface FreeAgentAddResult {
  memberId: string;
  rosterPlayerId: string;
}

type FreeAgentAddDb = Pick<PrismaClient, '$transaction'>;

/**
 * Adds an unowned player to the caller's roster in one transaction. The caller must be an active
 * member of a league whose draft is complete, the player must be unowned (under any alias) and not
 * waiver-only (a pending claim, or a drop since the last waiver run or still in its waiver period),
 * his AFL game must not have started in the round in progress (he can be picked up after the round
 * ends), and the roster must have room under the same rosterSize + benchSize capacity the draft, trades and waivers use.
 */
export async function addFreeAgentToRoster(
  db: FreeAgentAddDb,
  input: FreeAgentAddInput
): Promise<FreeAgentAddResult> {
  const { leagueId, userId, playerId } = input;
  const playerAliasIds = [...new Set([playerId, ...input.playerAliasIds])];

  // Checked before the transaction, as drops and trades do, so the member row lock never waits on
  // the fixture read. Unreadable game times fail closed.
  const lock = await findPlayersLockedForMove({ leagueId, playerIds: [playerId], now: input.now });
  if (!lock.ok) throw new FreeAgentAddError('TIMING_UNAVAILABLE', lock.error, 503);
  if (lock.lockedPlayers.length > 0) {
    throw new FreeAgentAddError(
      'PLAYER_LOCKED',
      describeLockedPlayers(lock.lockedPlayers, 'picked up'),
      409
    );
  }

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

      const transactionWindow = await getTransactionWindow(leagueId, tx);
      if (!transactionWindow.open) {
        throw new FreeAgentAddError(transactionWindow.code, transactionWindow.reason, 409);
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

      const [waiverHold] = await loadWaiverOnlyHolds(tx, {
        leagueIds: [leagueId],
        playerIds: playerAliasIds,
        now: input.now,
      });
      if (waiverHold) {
        throw new FreeAgentAddError(
          'PLAYER_ON_WAIVERS',
          'Player is on waivers: he can only be won with a waiver claim at the next waiver run.',
          409
        );
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
