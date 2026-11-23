import type { Prisma, PrismaClient } from '@prisma/client';

import { isActivePrismaMembership } from '@/server/leagues/activeMembership';
import { findBiteFreeze } from '@/server/leagues/bitePending';
import { INTERACTIVE_LEAGUE_LOCK, lockLeagueRowOrBusy } from '@/server/leagues/leagueRowLock';
import { describeLockedPlayers, findPlayersLockedForMove } from '@/server/leagues/playerMoveLock';
import { getTransactionWindow } from '@/server/leagues/transactionWindow';
import {
  evaluateRosterExchangeCapacity,
  getLeagueRosterCapacity,
} from '@/server/rosters/rosterCapacity';
import { dropRosterPlayerInTransaction } from '@/server/rosters/rosterDrop';
import { loadWaiverOnlyHolds } from '@/server/waivers/waiverOnlyPlayers';

export type FreeAgentAddErrorCode =
  | 'NOT_ACTIVE_MEMBER'
  | 'DRAFT_NOT_COMPLETE'
  | 'BLOODSUCKER_WINDOW_OPEN'
  | 'BLOODSUCKER_AUTO_FILL_PENDING'
  | 'BITE_PENDING'
  | 'BLOODSUCKER_RESULT_PENDING'
  | 'PLAYER_NOT_FOUND'
  | 'PLAYER_OWNED'
  | 'PLAYER_ON_WAIVERS'
  | 'PLAYER_LOCKED'
  | 'DROP_PLAYER_LOCKED'
  | 'DROP_PLAYER_NOT_ON_ROSTER'
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
  /**
   * Add and drop: the canonical id of a player on the caller's roster to drop in the same
   * transaction, and every id his roster row may be stored under, the id the manager picked first.
   */
  drop?: { playerId: string; playerAliasIds: string[] };
  now?: Date;
}

export interface FreeAgentAddResult {
  memberId: string;
  rosterPlayerId: string;
  /** Set only when a drop committed with the add. */
  dropped?: { playerId: string; actionId: string; processingAt: Date };
}

type FreeAgentAddDb = Pick<PrismaClient, '$transaction'>;

/**
 * Adds an unowned player to the caller's roster in one transaction. The caller must be an active
 * member of a league whose draft is complete, the player must be unowned (under any alias) and not
 * waiver-only (a pending claim, or a drop since the last waiver run or still in its waiver period;
 * the Bloodsucker ignores those holds inside its exclusive window, which is closed to everyone else),
 * his AFL game must not have started in the round in progress (he can be picked up after the round
 * ends), and the roster must have room under the same rosterSize + benchSize capacity the draft, trades and waivers use.
 *
 * With `drop`, the named player leaves the caller's roster in the same transaction, with the same
 * waiver hold and lineup cleanup as a plain drop: he must be on that roster in this league and his
 * game must not have started this round. A refused add drops nothing.
 */
export async function addFreeAgentToRoster(
  db: FreeAgentAddDb,
  input: FreeAgentAddInput
): Promise<FreeAgentAddResult> {
  const { leagueId, userId, playerId } = input;
  const playerAliasIds = [...new Set([playerId, ...input.playerAliasIds])];

  // Checked before the transaction, as drops and trades do, so no row lock waits on the fixture
  // read. Unreadable game times fail closed.
  const drop = input.drop
    ? {
        playerId: input.drop.playerId,
        // In order of preference: the id the manager picked comes first.
        rowPlayerIds: [...new Set([...input.drop.playerAliasIds, input.drop.playerId])],
      }
    : null;
  const lock = await findPlayersLockedForMove({
    leagueId,
    playerIds: drop ? [playerId, drop.playerId] : [playerId],
    now: input.now,
  });
  if (!lock.ok) throw new FreeAgentAddError('TIMING_UNAVAILABLE', lock.error, 503);
  const lockedAdd = lock.lockedPlayers.filter((locked) => locked.playerId === playerId);
  if (lockedAdd.length > 0) {
    throw new FreeAgentAddError(
      'PLAYER_LOCKED',
      describeLockedPlayers(lockedAdd, 'picked up'),
      409
    );
  }
  if (lock.lockedPlayers.length > 0) {
    throw new FreeAgentAddError(
      'DROP_PLAYER_LOCKED',
      describeLockedPlayers(lock.lockedPlayers, 'dropped'),
      409
    );
  }

  const work = async (tx: Prisma.TransactionClient): Promise<FreeAgentAddResult> => {
    if (drop) {
      // A drop takes the League row lock, as a plain drop and a bite do, so it never races a bite
      // on this roster. That lock also serialises this manager's adds; no member row lock here,
      // since a plain add takes the member row and then the League row (its insert's foreign key)
      // and the opposite order could deadlock. A swap leaves the count as it was, so a racing
      // plain add still meets the capacity check.
      await lockLeagueRowOrBusy(tx, leagueId, INTERACTIVE_LEAGUE_LOCK.waitMs);
    } else {
      // No-op write that takes the member row lock, so two adds by one manager settle one at a
      // time and cannot both pass the capacity check.
      await tx.$executeRaw`UPDATE "LeagueMember" SET "isActive" = "isActive" WHERE "leagueId" = ${leagueId} AND "userId" = ${userId}`;
    }

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

    const transactionWindow = await getTransactionWindow(leagueId, tx, {
      memberId: member.id,
      now: input.now,
    });
    if (!transactionWindow.open) {
      throw new FreeAgentAddError(transactionWindow.code, transactionWindow.reason, 409);
    }

    // BR-30, E12: a member with a Bloodsucker bite waiting, or whose matchup against the
    // Bloodsucker has ended and is not final, cannot add. A plain add takes no League row lock: one
    // that commits a moment before the freeze starts takes nothing away from the bite.
    const freeze = await findBiteFreeze(tx, leagueId, member.id, input.now);
    if (freeze) throw new FreeAgentAddError(freeze.code, freeze.message, 409);

    const player = await tx.player.findUnique({ where: { id: playerId }, select: { id: true } });
    if (!player) throw new FreeAgentAddError('PLAYER_NOT_FOUND', 'Player not found', 404);

    const owned = await tx.leagueRosterPlayer.findFirst({
      where: { leagueId, playerId: { in: playerAliasIds } },
      select: { memberId: true },
    });
    if (owned) {
      throw new FreeAgentAddError('PLAYER_OWNED', 'Player already owned in this league', 409);
    }

    // BR-12: inside its exclusive window the Bloodsucker can take anyone unowned, held or not.
    const [waiverHold] = transactionWindow.bloodsuckerExclusive
      ? []
      : await loadWaiverOnlyHolds(tx, {
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

    let dropRowPlayerId: string | undefined;
    if (drop) {
      const dropRows = await tx.leagueRosterPlayer.findMany({
        where: { leagueId, memberId: member.id, playerId: { in: drop.rowPlayerIds } },
        select: { playerId: true },
      });
      // One row only: two players in one identity group are still two players.
      dropRowPlayerId = drop.rowPlayerIds.find((id) => dropRows.some((row) => row.playerId === id));
      if (!dropRowPlayerId) {
        throw new FreeAgentAddError(
          'DROP_PLAYER_NOT_ON_ROSTER',
          'The player you chose to drop is no longer on your roster.',
          409
        );
      }
    }

    const currentCount = await tx.leagueRosterPlayer.count({
      where: { leagueId, memberId: member.id },
    });
    const capacity = evaluateRosterExchangeCapacity({
      currentCount,
      outgoingCount: drop ? 1 : 0,
      incomingCount: 1,
      capacity: getLeagueRosterCapacity(member.league.settings),
    });
    if (!capacity.isAllowed) {
      throw new FreeAgentAddError(
        'ROSTER_FULL',
        `Your roster is full (${capacity.currentCount} of ${capacity.capacity}). Choose a player to drop.`,
        422
      );
    }

    const dropped = drop
      ? await dropRosterPlayerInTransaction(tx, {
          leagueId,
          memberId: member.id,
          playerId: drop.playerId,
          rowPlayerId: dropRowPlayerId,
          now: input.now,
        })
      : null;
    if (drop && !dropped) {
      throw new FreeAgentAddError(
        'DROP_PLAYER_NOT_ON_ROSTER',
        'The player you chose to drop is no longer on your roster.',
        409
      );
    }

    const rosterPlayer = await tx.leagueRosterPlayer.create({
      data: { leagueId, memberId: member.id, playerId, acquiredBy: 'FREE_AGENT' },
      select: { id: true },
    });
    return {
      memberId: member.id,
      rosterPlayerId: rosterPlayer.id,
      ...(drop && dropped ? { dropped: { playerId: drop.playerId, ...dropped } } : {}),
    };
  };

  try {
    return await (drop
      ? db.$transaction(work, INTERACTIVE_LEAGUE_LOCK.transaction)
      : db.$transaction(work));
  } catch (error) {
    // A concurrent add of the same player loses on the (leagueId, playerId) unique key.
    if (isRosterUniqueConstraintError(error)) {
      throw new FreeAgentAddError('PLAYER_OWNED', 'Player already owned in this league', 409);
    }
    throw error;
  }
}

/** P2002 on the roster's (leagueId, playerId) key, not on the drop's action id. */
function isRosterUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
    return false;
  }
  const meta = 'meta' in error ? (error.meta as { modelName?: unknown } | undefined) : undefined;
  return meta?.modelName === undefined || meta.modelName === 'LeagueRosterPlayer';
}

export interface DropCandidate {
  /** The id the roster row holds; send it back as the add's `dropPlayerId`. */
  playerId: string;
  name: string;
  position: string | null;
  club: string | null;
}

type DropCandidateDb = Pick<PrismaClient, 'leagueMember' | 'leagueRosterPlayer'>;

/**
 * The players an active manager could drop to make room for an add: his roster in this league,
 * minus players whose game has started this round. When game times cannot be read every player is
 * listed; the add and drop re-checks them and refuses a locked one.
 */
export async function listDropCandidates(
  db: DropCandidateDb,
  input: { leagueId: string; userId: string; now?: Date }
): Promise<DropCandidate[]> {
  const { leagueId, userId } = input;
  const member = await db.leagueMember.findFirst({
    where: { leagueId, userId },
    select: { id: true, isActive: true, status: true },
  });
  if (!member || !isActivePrismaMembership(member)) return [];

  const rows = await db.leagueRosterPlayer.findMany({
    where: { leagueId, memberId: member.id },
    select: { playerId: true, player: { select: { name: true, position: true, club: true } } },
    orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
  });
  const lock = await findPlayersLockedForMove({
    leagueId,
    playerIds: rows.map((row) => row.playerId),
    now: input.now,
  });
  const locked = new Set(lock.ok ? lock.lockedPlayers.map((player) => player.playerId) : []);
  return rows
    .filter((row) => !locked.has(row.playerId))
    .map((row) => ({
      playerId: row.playerId,
      name: row.player.name,
      position: row.player.position ?? null,
      club: row.player.club ?? null,
    }));
}
