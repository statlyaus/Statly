import 'server-only';

import type { Prisma } from '@prisma/client';

import { logger } from '@/lib/logger';
import {
  describeLockedPlayers,
  findPlayersLockedForMove,
  removePlayersFromOpenLineups,
} from '@/server/leagues/playerMoveLock';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

/**
 * One atomic exchange of players between two members of a league: a completed trade, or a
 * Bloodsucker bite. The caller owns the transaction and decides what the swap means; this module
 * owns the roster rows, the lineup cleanup, the pending trades the swap breaks, and the ownership
 * projection.
 */

type Transaction = Prisma.TransactionClient;

export type RosterSwapErrorCode = 'ROSTER_CHANGED' | 'PLAYER_LOCKED' | 'TIMING_UNAVAILABLE';

export class RosterSwapError extends Error {
  constructor(
    public readonly code: RosterSwapErrorCode,
    message: string,
    public readonly status: 409 | 503
  ) {
    super(message);
    this.name = 'RosterSwapError';
  }
}

const activeTradeStatuses = ['OPEN', 'PENDING_ADMIN_REVIEW', 'PENDING_VETO_REVIEW'] as const;

/**
 * Refuses a swap that includes a player whose AFL game has started this round. Run it before the
 * swap transaction: match timing is read outside the database, so the transaction never waits on it.
 */
export async function assertRosterPlayersMovable(input: {
  leagueId: string;
  playerIds: readonly string[];
  now: Date;
}): Promise<void> {
  const lock = await findPlayersLockedForMove(input);
  if (!lock.ok) throw new RosterSwapError('TIMING_UNAVAILABLE', lock.error, 503);
  if (lock.lockedPlayers.length > 0) {
    throw new RosterSwapError('PLAYER_LOCKED', describeLockedPlayers(lock.lockedPlayers), 409);
  }
}

export interface RosterSwapInput {
  leagueId: string;
  seasonId: string;
  fromMemberId: string;
  toMemberId: string;
  /** Players leaving `fromMemberId` for `toMemberId`. */
  fromPlayerIds: readonly string[];
  /** Players leaving `toMemberId` for `fromMemberId`. */
  toPlayerIds: readonly string[];
  /** Stored on each moved roster row, e.g. `TRADE`. */
  acquiredBy: string;
  /** Reason code recorded on every pending trade the swap invalidates. */
  invalidationReason: string;
  /** A trade thread that is itself completing, so it is not invalidated. */
  excludeThreadId?: string;
  now: Date;
}

/**
 * Moves the players inside the caller's transaction. Each move is filtered by the current owner, so
 * a player who changed teams since the caller read the rosters fails the whole swap with
 * `ROSTER_CHANGED` and the caller's transaction rolls back.
 */
export async function swapRosterPlayers(tx: Transaction, input: RosterSwapInput): Promise<void> {
  const { leagueId, fromMemberId, toMemberId, now } = input;
  const fromMoved = await tx.leagueRosterPlayer.updateMany({
    where: { leagueId, memberId: fromMemberId, playerId: { in: [...input.fromPlayerIds] } },
    data: { memberId: toMemberId, acquiredBy: input.acquiredBy, acquiredAt: now },
  });
  const toMoved = await tx.leagueRosterPlayer.updateMany({
    where: { leagueId, memberId: toMemberId, playerId: { in: [...input.toPlayerIds] } },
    data: { memberId: fromMemberId, acquiredBy: input.acquiredBy, acquiredAt: now },
  });
  if (
    fromMoved.count !== input.fromPlayerIds.length ||
    toMoved.count !== input.toPlayerIds.length
  ) {
    throw new RosterSwapError('ROSTER_CHANGED', 'A swapped player changed teams.', 409);
  }

  await removePlayersFromOpenLineups(tx, {
    leagueId,
    memberId: fromMemberId,
    playerIds: input.fromPlayerIds,
    now,
  });
  await removePlayersFromOpenLineups(tx, {
    leagueId,
    memberId: toMemberId,
    playerIds: input.toPlayerIds,
    now,
  });
  await invalidatePendingTradesForPlayers(tx, {
    leagueId,
    seasonId: input.seasonId,
    playerIds: [...input.fromPlayerIds, ...input.toPlayerIds],
    reasonCode: input.invalidationReason,
    excludeThreadId: input.excludeThreadId,
    now,
  });
}

/** Invalidates every pending trade in the league whose current offer includes one of the players. */
export async function invalidatePendingTradesForPlayers(
  tx: Transaction,
  input: {
    leagueId: string;
    seasonId: string;
    playerIds: readonly string[];
    reasonCode: string;
    excludeThreadId?: string;
    now: Date;
  }
): Promise<void> {
  const { leagueId, now } = input;
  const conflicts = await tx.leagueTradeThread.findMany({
    where: {
      ...(input.excludeThreadId ? { id: { not: input.excludeThreadId } } : {}),
      leagueId,
      status: { in: [...activeTradeStatuses] },
      currentOffer: { players: { some: { playerId: { in: [...input.playerIds] } } } },
    },
    select: { id: true, currentOfferId: true, status: true },
  });
  if (!conflicts.length) return;

  await tx.leagueTradeThread.updateMany({
    where: { id: { in: conflicts.map((conflict) => conflict.id) } },
    data: {
      status: 'INVALIDATED',
      resolvedAt: now,
      reviewEndsAt: null,
      version: { increment: 1 },
    },
  });
  await tx.leagueTradeOffer.updateMany({
    where: { id: { in: conflicts.flatMap((conflict) => conflict.currentOfferId ?? []) } },
    data: { status: 'INVALIDATED', resolvedAt: now, version: { increment: 1 } },
  });
  await tx.leagueTradeEvent.createMany({
    data: conflicts.map((conflict) => ({
      threadId: conflict.id,
      offerId: conflict.currentOfferId,
      eventType: 'INVALIDATED',
      previousStatus: conflict.status,
      nextStatus: 'INVALIDATED',
      reasonCode: input.reasonCode,
    })),
  });
  // Same outbox row a trade event writes, so clients and notifications hear about the invalidation.
  await tx.leagueTradeOutboxEvent.createMany({
    data: conflicts.map((conflict) => ({
      leagueId,
      seasonId: input.seasonId,
      threadId: conflict.id,
      offerId: conflict.currentOfferId,
      eventType: 'trade:invalidated',
      payloadJson: {
        threadId: conflict.id,
        offerId: conflict.currentOfferId,
        status: 'INVALIDATED',
      },
    })),
  });
}

type OwnershipProjection = Pick<WaiverAvailabilityProjectionService, 'projectLeague'>;

/**
 * Rewrites the Firestore `playerOwnerships` projection after a swap commits. Best effort: the swap
 * already stands in Postgres, so a projection failure is logged, never thrown.
 */
export async function refreshOwnershipProjection(
  leagueId: string,
  projection?: OwnershipProjection
): Promise<void> {
  try {
    await (projection ?? new WaiverAvailabilityProjectionService()).projectLeague({ leagueId });
  } catch (error) {
    logger.warn('Ownership projection refresh failed after a roster swap', {
      leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
