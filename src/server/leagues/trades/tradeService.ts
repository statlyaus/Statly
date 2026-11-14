import 'server-only';

import { createHash } from 'node:crypto';

import { Prisma, type TradeReviewMode } from '@prisma/client';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  assertRosterPlayersMovable,
  refreshOwnershipProjection,
  RosterSwapError,
  swapRosterPlayers,
} from '@/server/leagues/rosterSwap';
import {
  BITE_PENDING_MESSAGE,
  BITE_PENDING_TRADE_HELD_MESSAGE,
  hasPendingBite,
} from '@/server/leagues/bitePending';
import { resolveBloodsuckerMemberId } from '@/server/leagues/leagueFormat';
import { getTransactionWindow } from '@/server/leagues/transactionWindow';
import { resolveCanonicalPlayerIds } from '@/server/players/playerIdentityService';
import {
  evaluateRosterExchangeCapacity,
  getLeagueRosterCapacity,
} from '@/server/rosters/rosterCapacity';

import {
  createTradeSchema,
  tradeActionSchema,
  TradeServiceError,
  type CreateTradeInput,
  type TradeActionInput,
  type TradeReviewModeDto,
} from './tradeContracts';
import {
  BLOODSUCKER_CANNOT_TRADE_MESSAGE,
  determineAcceptanceTransition,
  effectiveVetoThreshold,
  getAllowedTradeActions,
  isBloodsuckerInTrade,
  resolveTradeReviewMode,
  validateTradePlayerSelection,
  type BittenPlayer,
} from './tradePolicy';

type Transaction = Prisma.TransactionClient;

interface TradeAccess {
  leagueId: string;
  seasonId: string;
  userId: string;
  memberId: string;
  isCommissioner: boolean;
  settings: {
    rosterSize: number;
    benchSize: number;
    tradeLimit: number;
    tradeReviewMode: TradeReviewMode;
    tradeDeadline: Date | null;
    tradeOfferExpiryHours: number;
    tradeReviewHours: number;
    tradeVetoThreshold: number;
  };
}

interface TradePlayerSnapshot {
  id: string;
  name: string;
  club: string;
  position: string;
}

export type TradeCommandResult = {
  threadId: string;
  offerId: string;
  status: string;
  version: number;
};

export async function authorizeLeagueTradeAccess(
  leagueId: string,
  userId: string
): Promise<string> {
  const access = await requireTradeAccess(leagueId, userId);
  return access.leagueId;
}

export async function createLeagueTrade(
  leagueId: string,
  userId: string,
  input: unknown,
  now = new Date()
): Promise<TradeCommandResult> {
  const parsed = createTradeSchema.safeParse(input);
  if (!parsed.success) {
    throw new TradeServiceError('INVALID_INPUT', 'Trade proposal is invalid.');
  }
  const canonicalSelection = await resolveTradePlayerSelection(
    parsed.data.sendingPlayerIds,
    parsed.data.receivingPlayerIds
  );
  const canonicalInput: CreateTradeInput = { ...parsed.data, ...canonicalSelection };
  const selection = validateTradePlayerSelection(
    canonicalInput.sendingPlayerIds,
    canonicalInput.receivingPlayerIds
  );
  if (!selection.ok) throw new TradeServiceError('INVALID_INPUT', selection.error);

  const access = await requireTradeAccess(leagueId, userId);
  await enforceTransactionWindow(leagueId, access.memberId, now);
  enforceTradeDeadline(access, now);
  await enforcePlayersMovable(
    leagueId,
    [...canonicalInput.sendingPlayerIds, ...canonicalInput.receivingPlayerIds],
    now
  );

  return executeIdempotentTradeCommand(
    access,
    canonicalInput.idempotencyKey,
    'CREATE_TRADE',
    canonicalInput,
    async (tx) => createTradeInTransaction(tx, access, canonicalInput, now)
  );
}

export async function executeLeagueTradeAction(
  leagueId: string,
  userId: string,
  threadId: string,
  input: unknown,
  now = new Date()
): Promise<TradeCommandResult> {
  const parsed = tradeActionSchema.safeParse(input);
  if (!parsed.success) {
    throw new TradeServiceError('INVALID_INPUT', 'Trade action is invalid.');
  }
  let canonicalInput: TradeActionInput = parsed.data;
  if (parsed.data.action === 'counter') {
    canonicalInput = {
      ...parsed.data,
      ...(await resolveTradePlayerSelection(
        parsed.data.sendingPlayerIds,
        parsed.data.receivingPlayerIds
      )),
    };
  }
  const access = await requireTradeAccess(leagueId, userId);
  if (canonicalInput.action === 'accept' || canonicalInput.action === 'counter') {
    await enforceTransactionWindow(leagueId, access.memberId, now);
  }
  if (canonicalInput.action === 'counter') {
    await enforcePlayersMovable(
      leagueId,
      [...canonicalInput.sendingPlayerIds, ...canonicalInput.receivingPlayerIds],
      now
    );
  } else if (canonicalInput.action === 'accept' || canonicalInput.action === 'approve') {
    await enforcePlayersMovable(leagueId, await loadOfferedPlayerIds(leagueId, threadId), now);
  }

  const result = await executeIdempotentTradeCommand(
    access,
    canonicalInput.idempotencyKey,
    `TRADE_${canonicalInput.action.toUpperCase()}`,
    { threadId, ...canonicalInput },
    async (tx) => executeActionInTransaction(tx, access, threadId, canonicalInput, now)
  );
  if (result.status === 'COMPLETED') await refreshOwnershipProjection(leagueId);
  return result;
}

async function resolveTradePlayerSelection(
  sendingPlayerIds: readonly string[],
  receivingPlayerIds: readonly string[]
): Promise<{ sendingPlayerIds: string[]; receivingPlayerIds: string[] }> {
  const requestedPlayerIds = [...sendingPlayerIds, ...receivingPlayerIds];
  const resolvedPlayerIds = await resolveCanonicalPlayerIds(requestedPlayerIds);
  if (requestedPlayerIds.some((playerId) => !resolvedPlayerIds.has(playerId))) {
    throw new TradeServiceError('INVALID_INPUT', 'One or more selected players no longer exist.');
  }

  return {
    sendingPlayerIds: sendingPlayerIds.map((playerId) => resolvedPlayerIds.get(playerId)!),
    receivingPlayerIds: receivingPlayerIds.map((playerId) => resolvedPlayerIds.get(playerId)!),
  };
}

/**
 * A player whose AFL game has started this round cannot be traded until the round ends. Match
 * timing is read before the trade transaction, so the transaction never waits on Firestore.
 */
async function enforcePlayersMovable(
  leagueId: string,
  playerIds: readonly string[],
  now: Date
): Promise<void> {
  try {
    await assertRosterPlayersMovable({ leagueId, playerIds, now });
  } catch (error) {
    if (error instanceof RosterSwapError) {
      throw new TradeServiceError(error.code, error.message, error.status);
    }
    throw error;
  }
}

async function loadOfferedPlayerIds(leagueId: string, threadId: string): Promise<string[]> {
  const thread = await prisma.leagueTradeThread.findFirst({
    where: { id: threadId, leagueId },
    select: { currentOffer: { select: { players: { select: { playerId: true } } } } },
  });
  return thread?.currentOffer?.players.map((player) => player.playerId) ?? [];
}

export async function processDueLeagueTrades(now = new Date(), limit = 50): Promise<number> {
  const due = await prisma.leagueTradeThread.findMany({
    where: {
      OR: [
        { status: 'PENDING_VETO_REVIEW', reviewEndsAt: { lte: now } },
        { status: 'OPEN', currentOffer: { expiresAt: { lte: now } } },
      ],
    },
    select: { id: true, leagueId: true, status: true, version: true },
    orderBy: { updatedAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100),
  });

  let processed = 0;
  const failures: unknown[] = [];
  for (const candidate of due) {
    try {
      // A trade whose review ends mid-round waits for a later run once a traded player's game
      // has started (or match timing is unreadable); it completes after the round ends.
      if (candidate.status === 'PENDING_VETO_REVIEW') {
        await enforcePlayersMovable(
          candidate.leagueId,
          await loadOfferedPlayerIds(candidate.leagueId, candidate.id),
          now
        );
      }

      const completed = await prisma.$transaction(async (tx) => {
        const thread = await loadTradeForMutation(tx, candidate.id);
        if (!thread || thread.version !== candidate.version) return;

        const invalidationReason = await getTradeLifecycleInvalidationReason(tx, thread);
        if (invalidationReason) {
          await resolveThread(
            tx,
            thread,
            'INVALIDATED',
            'INVALIDATED',
            null,
            now,
            invalidationReason
          );
          processed += 1;
          return;
        }

        if (thread.status === 'OPEN' && thread.currentOffer.expiresAt <= now) {
          await resolveThread(tx, thread, 'EXPIRED', 'EXPIRED', null, now, 'OFFER_EXPIRED');
          processed += 1;
          return;
        }

        if (
          thread.status === 'PENDING_VETO_REVIEW' &&
          thread.reviewEndsAt &&
          thread.reviewEndsAt <= now
        ) {
          const result = await finalizeTrade(tx, thread, null, now);
          processed += 1;
          return result.status === 'COMPLETED';
        }
      });
      if (completed) await refreshOwnershipProjection(candidate.leagueId);
    } catch (error) {
      if (error instanceof TradeServiceError) continue;
      // A thread that keeps failing stays first in updatedAt order, so skipping it keeps the rest moving.
      logger.error('Failed to process a due league trade', {
        threadId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    // Still report the run as failed, so the cron route surfaces the stuck thread.
    throw new Error(`${failures.length} due league trade(s) failed to process`, {
      cause: failures[0],
    });
  }
  return processed;
}

async function createTradeInTransaction(
  tx: Transaction,
  access: TradeAccess,
  input: CreateTradeInput,
  now: Date
): Promise<TradeCommandResult> {
  const recipient = await tx.leagueMember.findFirst({
    where: {
      id: input.recipientMemberId,
      leagueId: access.leagueId,
      isActive: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (!recipient || recipient.id === access.memberId) {
    throw new TradeServiceError('INVALID_INPUT', 'Select another active team in this league.');
  }

  await enforceBloodsuckerTradeRules(tx, access, {
    firstMemberId: access.memberId,
    secondMemberId: recipient.id,
    firstPlayerIds: input.sendingPlayerIds,
    secondPlayerIds: input.receivingPlayerIds,
  });
  await validateTradeLimits(tx, access, [access.memberId, recipient.id]);
  const playerSnapshots = await validateRosterExchange(tx, access, {
    firstMemberId: access.memberId,
    secondMemberId: recipient.id,
    firstPlayerIds: input.sendingPlayerIds,
    secondPlayerIds: input.receivingPlayerIds,
  });

  const expiresAt = resolveOfferExpiry(access, now);
  const thread = await tx.leagueTradeThread.create({
    data: {
      leagueId: access.leagueId,
      seasonId: access.seasonId,
      memberOneId: access.memberId,
      memberTwoId: recipient.id,
    },
    select: { id: true },
  });
  const offer = await tx.leagueTradeOffer.create({
    data: {
      threadId: thread.id,
      sequence: 1,
      proposerMemberId: access.memberId,
      recipientMemberId: recipient.id,
      message: input.message || null,
      expiresAt,
      reviewMode: access.settings.tradeReviewMode,
      reviewHours: access.settings.tradeReviewHours,
      vetoThreshold: access.settings.tradeVetoThreshold,
      players: {
        create: buildTradePlayerMoves({
          firstMemberId: access.memberId,
          secondMemberId: recipient.id,
          firstPlayerIds: input.sendingPlayerIds,
          secondPlayerIds: input.receivingPlayerIds,
          playerSnapshots,
        }),
      },
    },
    select: { id: true },
  });
  await tx.leagueTradeThread.update({
    where: { id: thread.id },
    data: { currentOfferId: offer.id },
  });
  await recordTradeEvent(tx, access, {
    threadId: thread.id,
    offerId: offer.id,
    type: 'PROPOSED',
    previousStatus: null,
    nextStatus: 'OPEN',
  });

  return { threadId: thread.id, offerId: offer.id, status: 'OPEN', version: 0 };
}

async function executeActionInTransaction(
  tx: Transaction,
  access: TradeAccess,
  threadId: string,
  input: TradeActionInput,
  now: Date
): Promise<TradeCommandResult> {
  const thread = await loadTradeForMutation(tx, threadId, access.leagueId);
  if (!thread) throw new TradeServiceError('NOT_FOUND', 'Trade not found.', 404);
  if (thread.version !== input.expectedVersion) {
    throw new TradeServiceError('STALE_VERSION', 'This trade changed. Refresh and try again.', 409);
  }

  const invalidationReason = await getTradeLifecycleInvalidationReason(tx, thread);
  if (invalidationReason) {
    return resolveThread(
      tx,
      thread,
      'INVALIDATED',
      'INVALIDATED',
      access.memberId,
      now,
      invalidationReason
    );
  }

  if (thread.currentOffer.expiresAt <= now && thread.status === 'OPEN') {
    return resolveThread(tx, thread, 'EXPIRED', 'EXPIRED', access.memberId, now, 'OFFER_EXPIRED');
  }

  const allowed = getAllowedTradeActions({
    status: thread.status,
    proposerMemberId: thread.currentOffer.proposerMemberId,
    recipientMemberId: thread.currentOffer.recipientMemberId,
    participantMemberIds: [thread.memberOneId, thread.memberTwoId],
    actorMemberId: access.memberId,
    isCommissioner: access.isCommissioner,
  });
  if (!allowed.includes(input.action)) {
    throw new TradeServiceError('FORBIDDEN', 'You cannot perform this trade action.', 403);
  }
  if (input.action === 'accept' || input.action === 'approve') {
    await enforceBloodsuckerTradeRules(tx, access, offeredExchange(thread));
  }

  switch (input.action) {
    case 'withdraw':
      return resolveThread(tx, thread, 'WITHDRAWN', 'WITHDRAWN', access.memberId, now);
    case 'decline':
      return resolveThread(tx, thread, 'DECLINED', 'DECLINED', access.memberId, now);
    case 'reject':
      return resolveThread(
        tx,
        thread,
        'REJECTED',
        'REJECTED',
        access.memberId,
        now,
        'COMMISSIONER_REJECTED',
        { reason: input.reason }
      );
    case 'counter':
      return counterTrade(tx, access, thread, input, now);
    case 'accept': {
      enforceTradeDeadline(access, now);
      const offeredMode = toReviewModeDto(thread.currentOffer.reviewMode);
      const reviewMode = resolveTradeReviewMode(
        offeredMode,
        (await loadTradeReviewContext(tx, thread)).commissionerIsParty
      );
      const transition = determineAcceptanceTransition(
        reviewMode,
        now,
        thread.currentOffer.reviewHours
      );
      if (transition.shouldFinalize) return finalizeTrade(tx, thread, access.memberId, now);

      await claimThreadVersion(tx, thread.id, thread.version, 'OPEN', {
        status: transition.threadStatus,
        reviewEndsAt: transition.reviewEndsAt,
      });
      await tx.leagueTradeOffer.update({
        where: { id: thread.currentOffer.id },
        data: {
          status: transition.offerStatus,
          acceptedAt: now,
          version: { increment: 1 },
          // The offer records the route it actually took, so the trade centre shows a vote.
          ...(reviewMode !== offeredMode ? { reviewMode: 'VETO' as const } : {}),
        },
      });
      await recordTradeEvent(tx, access, {
        threadId: thread.id,
        offerId: thread.currentOffer.id,
        type: 'ACCEPTED',
        previousStatus: thread.status,
        nextStatus: transition.threadStatus,
      });
      return {
        threadId: thread.id,
        offerId: thread.currentOffer.id,
        status: transition.threadStatus,
        version: thread.version + 1,
      };
    }
    case 'approve':
      return finalizeTrade(tx, thread, access.memberId, now);
    case 'veto':
      return castVeto(tx, access, thread, now);
  }
}

async function counterTrade(
  tx: Transaction,
  access: TradeAccess,
  thread: LoadedTrade,
  input: Extract<TradeActionInput, { action: 'counter' }>,
  now: Date
): Promise<TradeCommandResult> {
  const selection = validateTradePlayerSelection(input.sendingPlayerIds, input.receivingPlayerIds);
  if (!selection.ok) throw new TradeServiceError('INVALID_INPUT', selection.error);
  enforceTradeDeadline(access, now);

  const otherMemberId =
    access.memberId === thread.memberOneId ? thread.memberTwoId : thread.memberOneId;
  await enforceBloodsuckerTradeRules(tx, access, {
    firstMemberId: access.memberId,
    secondMemberId: otherMemberId,
    firstPlayerIds: input.sendingPlayerIds,
    secondPlayerIds: input.receivingPlayerIds,
  });
  const playerSnapshots = await validateRosterExchange(tx, access, {
    firstMemberId: access.memberId,
    secondMemberId: otherMemberId,
    firstPlayerIds: input.sendingPlayerIds,
    secondPlayerIds: input.receivingPlayerIds,
  });
  await claimThreadVersion(tx, thread.id, thread.version, 'OPEN', {});
  await tx.leagueTradeOffer.update({
    where: { id: thread.currentOffer.id },
    data: { status: 'SUPERSEDED', resolvedAt: now, version: { increment: 1 } },
  });
  const offer = await tx.leagueTradeOffer.create({
    data: {
      threadId: thread.id,
      sequence: thread.currentOffer.sequence + 1,
      proposerMemberId: access.memberId,
      recipientMemberId: otherMemberId,
      message: input.message || null,
      expiresAt: resolveOfferExpiry(access, now),
      reviewMode: access.settings.tradeReviewMode,
      reviewHours: access.settings.tradeReviewHours,
      vetoThreshold: access.settings.tradeVetoThreshold,
      players: {
        create: buildTradePlayerMoves({
          firstMemberId: access.memberId,
          secondMemberId: otherMemberId,
          firstPlayerIds: input.sendingPlayerIds,
          secondPlayerIds: input.receivingPlayerIds,
          playerSnapshots,
        }),
      },
    },
    select: { id: true },
  });
  await tx.leagueTradeThread.update({
    where: { id: thread.id },
    data: { currentOfferId: offer.id },
  });
  await recordTradeEvent(tx, access, {
    threadId: thread.id,
    offerId: offer.id,
    type: 'COUNTERED',
    previousStatus: 'OPEN',
    nextStatus: 'OPEN',
  });
  return { threadId: thread.id, offerId: offer.id, status: 'OPEN', version: thread.version + 1 };
}

async function castVeto(
  tx: Transaction,
  access: TradeAccess,
  thread: LoadedTrade,
  now: Date
): Promise<TradeCommandResult> {
  if (thread.reviewEndsAt && thread.reviewEndsAt <= now) {
    throw new TradeServiceError('INVALID_STATE', 'The veto window has closed.', 409);
  }

  try {
    await tx.leagueTradeVeto.create({
      data: { offerId: thread.currentOffer.id, voterMemberId: access.memberId },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new TradeServiceError('INVALID_STATE', 'You have already vetoed this trade.', 409);
    }
    throw error;
  }

  const vetoCount = thread.currentOffer.vetoes.length + 1;
  const threshold = effectiveVetoThreshold(
    thread.currentOffer.vetoThreshold,
    (await loadTradeReviewContext(tx, thread)).eligibleVoters
  );
  if (vetoCount >= threshold) {
    return resolveThread(
      tx,
      thread,
      'VETOED',
      'VETOED',
      access.memberId,
      now,
      'VETO_THRESHOLD_REACHED',
      { vetoCount }
    );
  }

  await claimThreadVersion(tx, thread.id, thread.version, 'PENDING_VETO_REVIEW', {});
  await recordTradeEvent(tx, access, {
    threadId: thread.id,
    offerId: thread.currentOffer.id,
    type: 'VETO_CAST',
    previousStatus: thread.status,
    nextStatus: thread.status,
    payload: { vetoCount },
  });
  return {
    threadId: thread.id,
    offerId: thread.currentOffer.id,
    status: thread.status,
    version: thread.version + 1,
  };
}

/**
 * Read at acceptance and at each veto: whether a commissioner (the owner or a co-commissioner) is
 * one of the two teams, and how many active teams outside the trade can veto it.
 */
async function loadTradeReviewContext(
  tx: Transaction,
  thread: Pick<LoadedTrade, 'leagueId' | 'memberOneId' | 'memberTwoId'>
): Promise<{ commissionerIsParty: boolean; eligibleVoters: number }> {
  const league = await tx.league.findUnique({
    where: { id: thread.leagueId },
    select: {
      ownerId: true,
      members: {
        where: { isActive: true, status: 'ACTIVE' },
        select: { id: true, userId: true, isCoCommissioner: true },
      },
    },
  });
  const members = league?.members ?? [];
  const parties = members.filter(
    (member) => member.id === thread.memberOneId || member.id === thread.memberTwoId
  );
  return {
    commissionerIsParty: parties.some(
      (member) => member.isCoCommissioner || member.userId === league?.ownerId
    ),
    eligibleVoters: members.length - parties.length,
  };
}

async function finalizeTrade(
  tx: Transaction,
  thread: LoadedTrade,
  actorMemberId: string | null,
  now: Date
): Promise<TradeCommandResult> {
  const invalidationReason = await getTradeLifecycleInvalidationReason(tx, thread);
  if (invalidationReason) {
    return resolveThread(
      tx,
      thread,
      'INVALIDATED',
      'INVALIDATED',
      actorMemberId,
      now,
      invalidationReason
    );
  }

  // BR-30: a trade with a team whose bite is waiting is held, not invalidated. Accept and approve
  // answer 409; the review cron skips it and completes it at the first run after the bite is done.
  if (
    (await hasPendingBite(tx, thread.leagueId, thread.memberOneId)) ||
    (await hasPendingBite(tx, thread.leagueId, thread.memberTwoId))
  ) {
    throw new TradeServiceError('BITE_PENDING', BITE_PENDING_TRADE_HELD_MESSAGE, 409);
  }

  const access = await requireTradeAccessByMember(tx, thread.leagueId, actorMemberId, thread);

  const { firstPlayerIds, secondPlayerIds } = offeredExchange(thread);
  try {
    // A trade the review cron completes (no actor) is invalidated rather than retried forever.
    await enforceBloodsuckerTradeRules(tx, access, offeredExchange(thread));
    await validateTradeLimits(tx, access, [thread.memberOneId, thread.memberTwoId], thread.id);
    await validateRosterExchange(tx, access, {
      firstMemberId: thread.memberOneId,
      secondMemberId: thread.memberTwoId,
      firstPlayerIds,
      secondPlayerIds,
    });
  } catch (error) {
    if (
      error instanceof TradeServiceError &&
      [
        'ROSTER_CHANGED',
        'ROSTER_LIMIT_EXCEEDED',
        'TRADE_LIMIT_REACHED',
        'BLOODSUCKER_CANNOT_TRADE',
        'BITTEN_PLAYER_TRADE_BACK',
      ].includes(error.code)
    ) {
      return resolveThread(
        tx,
        thread,
        'INVALIDATED',
        'INVALIDATED',
        actorMemberId,
        now,
        error.code
      );
    }
    throw error;
  }

  await claimThreadVersion(tx, thread.id, thread.version, thread.status, {
    status: 'COMPLETED',
    completedAt: now,
    resolvedAt: now,
    reviewEndsAt: null,
  });
  try {
    await swapRosterPlayers(tx, {
      leagueId: thread.leagueId,
      seasonId: thread.seasonId,
      fromMemberId: thread.memberOneId,
      toMemberId: thread.memberTwoId,
      fromPlayerIds: firstPlayerIds,
      toPlayerIds: secondPlayerIds,
      acquiredBy: 'TRADE',
      invalidationReason: 'PLAYER_TRADED_ELSEWHERE',
      excludeThreadId: thread.id,
      now,
    });
  } catch (error) {
    if (error instanceof RosterSwapError && error.code === 'ROSTER_CHANGED') {
      throw new TradeServiceError('ROSTER_CHANGED', 'A traded player changed teams.', 409);
    }
    throw error;
  }
  await tx.leagueTradeOffer.update({
    where: { id: thread.currentOffer.id },
    data: {
      status: 'COMPLETED',
      acceptedAt: thread.currentOffer.acceptedAt ?? now,
      resolvedAt: now,
    },
  });
  await recordTradeEvent(
    tx,
    { ...access, memberId: actorMemberId },
    {
      threadId: thread.id,
      offerId: thread.currentOffer.id,
      type: 'COMPLETED',
      previousStatus: thread.status,
      nextStatus: 'COMPLETED',
    }
  );
  return {
    threadId: thread.id,
    offerId: thread.currentOffer.id,
    status: 'COMPLETED',
    version: thread.version + 1,
  };
}

async function resolveThread(
  tx: Transaction,
  thread: LoadedTrade,
  threadStatus: 'DECLINED' | 'WITHDRAWN' | 'REJECTED' | 'VETOED' | 'EXPIRED' | 'INVALIDATED',
  offerStatus: 'DECLINED' | 'WITHDRAWN' | 'REJECTED' | 'VETOED' | 'EXPIRED' | 'INVALIDATED',
  actorMemberId: string | null,
  now: Date,
  reasonCode?: string,
  payload?: Prisma.InputJsonValue
): Promise<TradeCommandResult> {
  await claimThreadVersion(tx, thread.id, thread.version, thread.status, {
    status: threadStatus,
    resolvedAt: now,
    reviewEndsAt: null,
  });
  await tx.leagueTradeOffer.update({
    where: { id: thread.currentOffer.id },
    data: { status: offerStatus, resolvedAt: now, version: { increment: 1 } },
  });
  await recordTradeEvent(
    tx,
    { leagueId: thread.leagueId, seasonId: thread.seasonId, memberId: actorMemberId },
    {
      threadId: thread.id,
      offerId: thread.currentOffer.id,
      type: offerStatus,
      previousStatus: thread.status,
      nextStatus: threadStatus,
      reasonCode,
      payload,
    }
  );
  return {
    threadId: thread.id,
    offerId: thread.currentOffer.id,
    status: threadStatus,
    version: thread.version + 1,
  };
}

interface TradeExchange {
  firstMemberId: string;
  secondMemberId: string;
  firstPlayerIds: string[];
  secondPlayerIds: string[];
}

function offeredExchange(thread: LoadedTrade): TradeExchange {
  const sentBy = (memberId: string) =>
    thread.currentOffer.players
      .filter((player) => player.fromMemberId === memberId)
      .map((player) => player.playerId);
  return {
    firstMemberId: thread.memberOneId,
    secondMemberId: thread.memberTwoId,
    firstPlayerIds: sentBy(thread.memberOneId),
    secondPlayerIds: sentBy(thread.memberTwoId),
  };
}

/**
 * Bloodsucker trade rules (#1285). BR-31: the Bloodsucker cannot propose, counter, accept or be
 * approved into any trade. BR-32: a player taken in an executed bite this season cannot go back to
 * the member he was taken from. Other formats skip both checks.
 */
async function enforceBloodsuckerTradeRules(
  db: Pick<Transaction, 'leagueMember' | 'leagueBite' | 'league'>,
  access: TradeAccess,
  exchange: TradeExchange
): Promise<void> {
  const league = await db.league.findUnique({
    where: { id: access.leagueId },
    select: { settings: { select: { leagueFormat: true, bloodsuckerMemberId: true } } },
  });
  const settings = league?.settings;
  if (!settings || settings.leagueFormat !== 'BLOODSUCKER') return;

  const activeMembers = await db.leagueMember.findMany({
    where: { leagueId: access.leagueId, isActive: true, status: 'ACTIVE' },
    select: { id: true },
  });
  const bloodsuckerMemberId = resolveBloodsuckerMemberId(
    settings,
    activeMembers.map((member) => member.id)
  );
  if (
    isBloodsuckerInTrade([exchange.firstMemberId, exchange.secondMemberId], bloodsuckerMemberId)
  ) {
    throw new TradeServiceError('BLOODSUCKER_CANNOT_TRADE', BLOODSUCKER_CANNOT_TRADE_MESSAGE, 409);
  }

  const bites = await db.leagueBite.findMany({
    where: {
      leagueId: access.leagueId,
      seasonId: access.seasonId,
      status: { in: ['EXECUTED', 'AUTO_EXECUTED'] },
      takenPlayerId: { in: [...exchange.firstPlayerIds, ...exchange.secondPlayerIds] },
    },
    select: { takenPlayerId: true, victimMemberId: true },
  });
  if (bites.length === 0) return;
  const bittenFrom: BittenPlayer[] = bites.flatMap((bite) =>
    bite.takenPlayerId
      ? [{ playerId: bite.takenPlayerId, victimMemberId: bite.victimMemberId }]
      : []
  );
  const selection = validateTradePlayerSelection(
    exchange.firstPlayerIds,
    exchange.secondPlayerIds,
    {
      proposerMemberId: exchange.firstMemberId,
      recipientMemberId: exchange.secondMemberId,
      bittenFrom,
    }
  );
  if (!selection.ok) throw new TradeServiceError(selection.code, selection.error, 409);
}

async function validateRosterExchange(
  tx: Transaction,
  access: TradeAccess,
  input: {
    firstMemberId: string;
    secondMemberId: string;
    firstPlayerIds: string[];
    secondPlayerIds: string[];
  }
): Promise<Map<string, TradePlayerSnapshot>> {
  const requestedIds = [...input.firstPlayerIds, ...input.secondPlayerIds];
  const owned = await tx.leagueRosterPlayer.findMany({
    where: { leagueId: access.leagueId, playerId: { in: requestedIds } },
    select: {
      playerId: true,
      memberId: true,
      player: { select: { id: true, name: true, club: true, position: true } },
    },
  });
  const ownerByPlayer = new Map(owned.map((player) => [player.playerId, player.memberId]));
  const invalid = [
    ...input.firstPlayerIds.filter(
      (playerId) => ownerByPlayer.get(playerId) !== input.firstMemberId
    ),
    ...input.secondPlayerIds.filter(
      (playerId) => ownerByPlayer.get(playerId) !== input.secondMemberId
    ),
  ];
  if (invalid.length) {
    throw new TradeServiceError(
      'ROSTER_CHANGED',
      'One or more players are no longer available.',
      409
    );
  }

  const counts = await tx.leagueRosterPlayer.groupBy({
    by: ['memberId'],
    where: {
      leagueId: access.leagueId,
      memberId: { in: [input.firstMemberId, input.secondMemberId] },
    },
    _count: { _all: true },
  });
  const countByMember = new Map(counts.map((row) => [row.memberId, row._count._all]));
  const firstCurrent = countByMember.get(input.firstMemberId) ?? 0;
  const secondCurrent = countByMember.get(input.secondMemberId) ?? 0;
  const capacity = getLeagueRosterCapacity(access.settings);
  const firstCapacity = evaluateRosterExchangeCapacity({
    currentCount: firstCurrent,
    outgoingCount: input.firstPlayerIds.length,
    incomingCount: input.secondPlayerIds.length,
    capacity,
  });
  const secondCapacity = evaluateRosterExchangeCapacity({
    currentCount: secondCurrent,
    outgoingCount: input.secondPlayerIds.length,
    incomingCount: input.firstPlayerIds.length,
    capacity,
  });
  if (!firstCapacity.isAllowed || !secondCapacity.isAllowed) {
    throw new TradeServiceError(
      'ROSTER_LIMIT_EXCEEDED',
      'This trade would exceed a team roster limit.',
      409
    );
  }

  return new Map(owned.map(({ player }) => [player.id, player]));
}

function buildTradePlayerMoves(input: {
  firstMemberId: string;
  secondMemberId: string;
  firstPlayerIds: string[];
  secondPlayerIds: string[];
  playerSnapshots: Map<string, TradePlayerSnapshot>;
}) {
  const buildMove = (playerId: string, fromMemberId: string, toMemberId: string) => {
    const player = input.playerSnapshots.get(playerId);
    if (!player) {
      throw new TradeServiceError(
        'ROSTER_CHANGED',
        'One or more players are no longer available.',
        409
      );
    }
    return {
      playerId,
      playerNameSnapshot: player.name,
      playerClubSnapshot: player.club,
      playerPositionSnapshot: player.position,
      fromMemberId,
      toMemberId,
    };
  };

  return [
    ...input.firstPlayerIds.map((playerId) =>
      buildMove(playerId, input.firstMemberId, input.secondMemberId)
    ),
    ...input.secondPlayerIds.map((playerId) =>
      buildMove(playerId, input.secondMemberId, input.firstMemberId)
    ),
  ];
}

async function validateTradeLimits(
  tx: Transaction,
  access: TradeAccess,
  memberIds: string[],
  excludeThreadId?: string
): Promise<void> {
  if (access.settings.tradeLimit <= 0) return;
  const counts = await Promise.all(
    memberIds.map((memberId) =>
      tx.leagueTradeThread.count({
        where: {
          leagueId: access.leagueId,
          seasonId: access.seasonId,
          status: 'COMPLETED',
          ...(excludeThreadId ? { id: { not: excludeThreadId } } : {}),
          OR: [{ memberOneId: memberId }, { memberTwoId: memberId }],
        },
      })
    )
  );
  if (counts.some((count) => count >= access.settings.tradeLimit)) {
    throw new TradeServiceError('TRADE_LIMIT_REACHED', 'A team has reached its trade limit.', 409);
  }
}

async function requireTradeAccess(leagueId: string, userId: string): Promise<TradeAccess> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      ownerId: true,
      activeSeasonId: true,
      settings: {
        select: {
          rosterSize: true,
          benchSize: true,
          tradeLimit: true,
          tradeReviewMode: true,
          tradeDeadline: true,
          tradeOfferExpiryHours: true,
          tradeReviewHours: true,
          tradeVetoThreshold: true,
        },
      },
      members: {
        where: { userId, isActive: true, status: 'ACTIVE' },
        select: { id: true, isCoCommissioner: true },
        take: 1,
      },
    },
  });
  if (!league) throw new TradeServiceError('NOT_FOUND', 'League not found.', 404);
  const member = league.members[0];
  if (!member) throw new TradeServiceError('FORBIDDEN', 'League membership is required.', 403);
  if (!league.activeSeasonId) {
    throw new TradeServiceError('INVALID_STATE', 'The league does not have an active season.', 409);
  }
  return {
    leagueId,
    seasonId: league.activeSeasonId,
    userId,
    memberId: member.id,
    isCommissioner: league.ownerId === userId || member.isCoCommissioner,
    settings: league.settings,
  };
}

async function requireTradeAccessByMember(
  tx: Transaction,
  leagueId: string,
  actorMemberId: string | null,
  thread: LoadedTrade
): Promise<TradeAccess> {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    select: {
      ownerId: true,
      activeSeasonId: true,
      settings: {
        select: {
          rosterSize: true,
          benchSize: true,
          tradeLimit: true,
          tradeReviewMode: true,
          tradeDeadline: true,
          tradeOfferExpiryHours: true,
          tradeReviewHours: true,
          tradeVetoThreshold: true,
        },
      },
      members: {
        where: actorMemberId ? { id: actorMemberId, isActive: true, status: 'ACTIVE' } : undefined,
        select: { id: true, userId: true, isCoCommissioner: true },
        take: 1,
      },
    },
  });
  if (!league || league.activeSeasonId !== thread.seasonId) {
    throw new TradeServiceError('INVALID_STATE', 'The trade season is no longer active.', 409);
  }
  const actor = actorMemberId ? league.members[0] : null;
  return {
    leagueId,
    seasonId: thread.seasonId,
    userId: actor?.userId ?? 'system',
    memberId: actor?.id ?? '',
    isCommissioner:
      actor?.userId === league.ownerId ||
      actor?.isCoCommissioner === true ||
      actorMemberId === null,
    settings: league.settings,
  };
}

async function enforceTransactionWindow(
  leagueId: string,
  memberId: string,
  now: Date
): Promise<void> {
  const window = await getTransactionWindow(leagueId, prisma, { memberId, now });
  if (!window.open) throw new TradeServiceError(window.code, window.reason, 409);
  // BR-30: a member with a Bloodsucker bite waiting cannot propose, accept or counter a trade.
  if (await hasPendingBite(prisma, leagueId, memberId)) {
    throw new TradeServiceError('BITE_PENDING', BITE_PENDING_MESSAGE, 409);
  }
}

function enforceTradeDeadline(access: TradeAccess, now: Date): void {
  if (access.settings.tradeDeadline && access.settings.tradeDeadline <= now) {
    throw new TradeServiceError(
      'TRADE_DEADLINE_PASSED',
      'The league trade deadline has passed.',
      409
    );
  }
}

function resolveOfferExpiry(access: TradeAccess, now: Date): Date {
  const defaultExpiry = new Date(
    now.getTime() + Math.max(access.settings.tradeOfferExpiryHours, 1) * 60 * 60 * 1000
  );
  const deadline = access.settings.tradeDeadline;
  return deadline && deadline < defaultExpiry ? deadline : defaultExpiry;
}

async function getTradeLifecycleInvalidationReason(
  tx: Transaction,
  thread: Pick<LoadedTrade, 'leagueId' | 'seasonId' | 'memberOneId' | 'memberTwoId'>
): Promise<'SEASON_CLOSED' | 'PARTICIPANT_INACTIVE' | null> {
  const league = await tx.league.findUnique({
    where: { id: thread.leagueId },
    select: {
      activeSeasonId: true,
      members: {
        where: {
          id: { in: [thread.memberOneId, thread.memberTwoId] },
          isActive: true,
          status: 'ACTIVE',
        },
        select: { id: true },
      },
    },
  });

  if (!league || league.activeSeasonId !== thread.seasonId) return 'SEASON_CLOSED';
  if (league.members.length !== 2) return 'PARTICIPANT_INACTIVE';
  return null;
}

async function claimThreadVersion(
  tx: Transaction,
  threadId: string,
  expectedVersion: number,
  expectedStatus: LoadedTrade['status'],
  data: Prisma.LeagueTradeThreadUpdateManyMutationInput
): Promise<void> {
  const claimed = await tx.leagueTradeThread.updateMany({
    where: { id: threadId, version: expectedVersion, status: expectedStatus },
    data: { ...data, version: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    throw new TradeServiceError('STALE_VERSION', 'This trade changed. Refresh and try again.', 409);
  }
}

async function executeIdempotentTradeCommand<T extends Prisma.InputJsonValue>(
  access: TradeAccess,
  idempotencyKey: string,
  commandType: string,
  request: unknown,
  execute: (tx: Transaction) => Promise<T>
): Promise<T> {
  const requestHash = createHash('sha256').update(stableStringify(request)).digest('hex');
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.leagueTradeCommand.findUnique({
        where: {
          leagueId_actorUserId_idempotencyKey: {
            leagueId: access.leagueId,
            actorUserId: access.userId,
            idempotencyKey,
          },
        },
      });
      if (existing) return readIdempotentResult<T>(existing, commandType, requestHash);

      const command = await tx.leagueTradeCommand.create({
        data: {
          leagueId: access.leagueId,
          seasonId: access.seasonId,
          actorUserId: access.userId,
          actorMemberId: access.memberId,
          idempotencyKey,
          commandType,
          requestHash,
        },
      });
      const result = await execute(tx);
      const tradeResult = result as TradeCommandResult;
      await tx.leagueTradeCommand.update({
        where: { id: command.id },
        data: {
          resultThreadId: tradeResult.threadId,
          resultOfferId: tradeResult.offerId,
          responseJson: result,
        },
      });
      return result;
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await prisma.leagueTradeCommand.findUnique({
      where: {
        leagueId_actorUserId_idempotencyKey: {
          leagueId: access.leagueId,
          actorUserId: access.userId,
          idempotencyKey,
        },
      },
    });
    if (!existing) throw error;
    return readIdempotentResult<T>(existing, commandType, requestHash);
  }
}

function readIdempotentResult<T>(
  command: { commandType: string; requestHash: string; responseJson: Prisma.JsonValue },
  commandType: string,
  requestHash: string
): T {
  if (command.commandType !== commandType || command.requestHash !== requestHash) {
    throw new TradeServiceError(
      'IDEMPOTENCY_CONFLICT',
      'This idempotency key was used for another request.',
      409
    );
  }
  if (!command.responseJson) {
    throw new TradeServiceError('IDEMPOTENCY_CONFLICT', 'The original request is processing.', 409);
  }
  return command.responseJson as T;
}

const tradeMutationInclude = {
  currentOffer: { include: { players: true, vetoes: true } },
} satisfies Prisma.LeagueTradeThreadInclude;
type LoadedTradeRecord = Prisma.LeagueTradeThreadGetPayload<{
  include: typeof tradeMutationInclude;
}>;
type LoadedTrade = Omit<LoadedTradeRecord, 'currentOffer'> & {
  currentOffer: NonNullable<LoadedTradeRecord['currentOffer']>;
};

async function loadTradeForMutation(
  tx: Transaction,
  threadId: string,
  leagueId?: string
): Promise<LoadedTrade | null> {
  const thread = await tx.leagueTradeThread.findFirst({
    where: { id: threadId, ...(leagueId ? { leagueId } : {}) },
    include: tradeMutationInclude,
  });
  return thread?.currentOffer ? (thread as LoadedTrade) : null;
}

async function recordTradeEvent(
  tx: Transaction,
  access: Pick<TradeAccess, 'leagueId' | 'seasonId'> & { memberId: string | null },
  event: {
    threadId: string;
    offerId: string;
    type:
      | 'PROPOSED'
      | 'COUNTERED'
      | 'ACCEPTED'
      | 'DECLINED'
      | 'WITHDRAWN'
      | 'REJECTED'
      | 'VETO_CAST'
      | 'VETOED'
      | 'EXPIRED'
      | 'COMPLETED'
      | 'INVALIDATED';
    previousStatus: string | null;
    nextStatus: string;
    reasonCode?: string;
    payload?: Prisma.InputJsonValue;
  }
): Promise<void> {
  await tx.leagueTradeEvent.create({
    data: {
      threadId: event.threadId,
      offerId: event.offerId,
      actorMemberId: access.memberId || null,
      eventType: event.type,
      previousStatus: event.previousStatus,
      nextStatus: event.nextStatus,
      reasonCode: event.reasonCode,
      payloadJson: event.payload === undefined ? Prisma.DbNull : event.payload,
    },
  });
  await tx.leagueTradeOutboxEvent.create({
    data: {
      leagueId: access.leagueId,
      seasonId: access.seasonId,
      threadId: event.threadId,
      offerId: event.offerId,
      eventType: `trade:${event.type.toLowerCase()}`,
      payloadJson: {
        threadId: event.threadId,
        offerId: event.offerId,
        status: event.nextStatus,
      },
    },
  });
}

function toReviewModeDto(mode: TradeReviewMode): TradeReviewModeDto {
  if (mode === 'ADMIN') return 'admin';
  if (mode === 'VETO') return 'veto';
  return 'none';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
