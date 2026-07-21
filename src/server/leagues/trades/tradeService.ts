import 'server-only';

import { createHash } from 'node:crypto';

import { Prisma, type TradeReviewMode } from '@prisma/client';

import { prisma } from '@/lib/prisma';
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
  determineAcceptanceTransition,
  getAllowedTradeActions,
  validateTradePlayerSelection,
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

export interface TradeCommandResult {
  threadId: string;
  offerId: string;
  status: string;
  version: number;
}

const activeThreadStatuses = ['OPEN', 'PENDING_ADMIN_REVIEW', 'PENDING_VETO_REVIEW'] as const;

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
  const selection = validateTradePlayerSelection(
    parsed.data.sendingPlayerIds,
    parsed.data.receivingPlayerIds
  );
  if (!selection.ok) throw new TradeServiceError('INVALID_INPUT', selection.error);

  const access = await requireTradeAccess(leagueId, userId);
  enforceTradeDeadline(access, now);

  return executeIdempotentTradeCommand(
    access,
    parsed.data.idempotencyKey,
    'CREATE_TRADE',
    parsed.data,
    async (tx) => createTradeInTransaction(tx, access, parsed.data, now)
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
  const access = await requireTradeAccess(leagueId, userId);

  return executeIdempotentTradeCommand(
    access,
    parsed.data.idempotencyKey,
    `TRADE_${parsed.data.action.toUpperCase()}`,
    { threadId, ...parsed.data },
    async (tx) => executeActionInTransaction(tx, access, threadId, parsed.data, now)
  );
}

export async function processDueLeagueTrades(now = new Date(), limit = 50): Promise<number> {
  const due = await prisma.leagueTradeThread.findMany({
    where: {
      OR: [
        { status: 'PENDING_VETO_REVIEW', reviewEndsAt: { lte: now } },
        { status: 'OPEN', currentOffer: { expiresAt: { lte: now } } },
      ],
    },
    select: { id: true, status: true, version: true },
    orderBy: { updatedAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100),
  });

  let processed = 0;
  for (const candidate of due) {
    try {
      await prisma.$transaction(async (tx) => {
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
          await finalizeTrade(tx, thread, null, now);
          processed += 1;
        }
      });
    } catch (error) {
      if (!(error instanceof TradeServiceError)) throw error;
    }
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
      const transition = determineAcceptanceTransition(
        toReviewModeDto(thread.currentOffer.reviewMode),
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
        data: { status: transition.offerStatus, acceptedAt: now, version: { increment: 1 } },
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
  if (vetoCount >= thread.currentOffer.vetoThreshold) {
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

  const access = await requireTradeAccessByMember(tx, thread.leagueId, actorMemberId, thread);

  const firstPlayerIds = thread.currentOffer.players
    .filter((player) => player.fromMemberId === thread.memberOneId)
    .map((player) => player.playerId);
  const secondPlayerIds = thread.currentOffer.players
    .filter((player) => player.fromMemberId === thread.memberTwoId)
    .map((player) => player.playerId);
  try {
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
      ['ROSTER_CHANGED', 'ROSTER_LIMIT_EXCEEDED', 'TRADE_LIMIT_REACHED'].includes(error.code)
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
  await moveRosterPlayers(tx, thread.leagueId, thread.memberOneId, thread.memberTwoId, {
    firstPlayerIds,
    secondPlayerIds,
    now,
  });
  await tx.leagueTradeOffer.update({
    where: { id: thread.currentOffer.id },
    data: {
      status: 'COMPLETED',
      acceptedAt: thread.currentOffer.acceptedAt ?? now,
      resolvedAt: now,
    },
  });
  await invalidateConflictingTrades(tx, thread, [...firstPlayerIds, ...secondPlayerIds], now);
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

async function moveRosterPlayers(
  tx: Transaction,
  leagueId: string,
  firstMemberId: string,
  secondMemberId: string,
  input: { firstPlayerIds: string[]; secondPlayerIds: string[]; now: Date }
): Promise<void> {
  const firstMoved = await tx.leagueRosterPlayer.updateMany({
    where: { leagueId, memberId: firstMemberId, playerId: { in: input.firstPlayerIds } },
    data: { memberId: secondMemberId, acquiredBy: 'TRADE', acquiredAt: input.now },
  });
  const secondMoved = await tx.leagueRosterPlayer.updateMany({
    where: { leagueId, memberId: secondMemberId, playerId: { in: input.secondPlayerIds } },
    data: { memberId: firstMemberId, acquiredBy: 'TRADE', acquiredAt: input.now },
  });
  if (
    firstMoved.count !== input.firstPlayerIds.length ||
    secondMoved.count !== input.secondPlayerIds.length
  ) {
    throw new TradeServiceError('ROSTER_CHANGED', 'A traded player changed teams.', 409);
  }

  await tx.leagueLineupPlayer.deleteMany({
    where: {
      lockedAt: null,
      OR: [
        {
          playerId: { in: input.firstPlayerIds },
          lineup: { leagueId, memberId: firstMemberId, lockedAt: null },
        },
        {
          playerId: { in: input.secondPlayerIds },
          lineup: { leagueId, memberId: secondMemberId, lockedAt: null },
        },
      ],
    },
  });

  await syncLegacyRoster(tx, leagueId, firstMemberId);
  await syncLegacyRoster(tx, leagueId, secondMemberId);
}

async function syncLegacyRoster(
  tx: Transaction,
  leagueId: string,
  memberId: string
): Promise<void> {
  const [players, legacy] = await Promise.all([
    tx.leagueRosterPlayer.findMany({
      where: { leagueId, memberId },
      select: { playerId: true },
      orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId, memberId } },
      select: { captainId: true, viceCaptainId: true },
    }),
  ]);
  const playerIds = players.map((player) => player.playerId);
  const data = {
    playerIds: JSON.stringify(playerIds),
    captainId: legacy?.captainId && playerIds.includes(legacy.captainId) ? legacy.captainId : null,
    viceCaptainId:
      legacy?.viceCaptainId && playerIds.includes(legacy.viceCaptainId)
        ? legacy.viceCaptainId
        : null,
  };
  await tx.leagueRoster.upsert({
    where: { leagueId_memberId: { leagueId, memberId } },
    update: data,
    create: { leagueId, memberId, ...data },
  });
}

async function invalidateConflictingTrades(
  tx: Transaction,
  completedThread: LoadedTrade,
  playerIds: string[],
  now: Date
): Promise<void> {
  const conflicts = await tx.leagueTradeThread.findMany({
    where: {
      id: { not: completedThread.id },
      leagueId: completedThread.leagueId,
      status: { in: [...activeThreadStatuses] },
      currentOffer: { players: { some: { playerId: { in: playerIds } } } },
    },
    select: { id: true, currentOfferId: true, status: true },
  });
  if (!conflicts.length) return;

  await tx.leagueTradeThread.updateMany({
    where: { id: { in: conflicts.map((conflict) => conflict.id) } },
    data: { status: 'INVALIDATED', resolvedAt: now, version: { increment: 1 } },
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
      reasonCode: 'PLAYER_TRADED_ELSEWHERE',
    })),
  });
}

async function resolveThread(
  tx: Transaction,
  thread: LoadedTrade,
  threadStatus: 'DECLINED' | 'WITHDRAWN' | 'REJECTED' | 'VETOED' | 'EXPIRED' | 'INVALIDATED',
  offerStatus: 'DECLINED' | 'WITHDRAWN' | 'REJECTED' | 'VETOED' | 'EXPIRED' | 'INVALIDATED',
  actorMemberId: string | null,
  now: Date,
  reasonCode?: string,
  payload?: unknown
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

async function executeIdempotentTradeCommand<T>(
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
          responseJson: JSON.stringify(result),
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
  command: { commandType: string; requestHash: string; responseJson: string | null },
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
  return JSON.parse(command.responseJson) as T;
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
    payload?: unknown;
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
      payloadJson: event.payload === undefined ? null : JSON.stringify(event.payload),
    },
  });
  await tx.leagueTradeOutboxEvent.create({
    data: {
      leagueId: access.leagueId,
      seasonId: access.seasonId,
      threadId: event.threadId,
      offerId: event.offerId,
      eventType: `trade:${event.type.toLowerCase()}`,
      payloadJson: JSON.stringify({
        threadId: event.threadId,
        offerId: event.offerId,
        status: event.nextStatus,
      }),
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
