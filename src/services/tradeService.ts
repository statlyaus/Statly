import { createHash } from 'crypto';

import {
  Prisma,
  TradeActionType,
  TradeErrorCode,
  TradeEvent,
  TradeStatus,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';

export interface TradeItemInput {
  fromUserId: string;
  toUserId: string;
  playerId: string;
}

export interface ProposeTradeParams {
  requestId: string;
  leagueId: string;
  roundId?: string | null;
  proposerUserId: string;
  recipientUserId: string;
  parentTradeId?: string | null;
  note?: string | null;
  items: TradeItemInput[];
  ruleVersions?: string[];
}

export interface TradeActionParams {
  requestId: string;
  tradeId: string;
  actorUserId: string;
}

export interface TradeActionResult {
  tradeId: string;
  status: TradeStatus;
  createdAt: string;
  executedAt?: string;
}

export class TradeServiceError extends Error {
  constructor(
    public readonly code: TradeErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
  }
}

export const tradeService = {
  async proposeTrade(params: ProposeTradeParams) {
    return prisma.$transaction(async (tx) => {
      const requestPayloadHash = computeRequestPayloadHash(params);

      const existing = await tx.trade.findFirst({
        where: {
          requestId: params.requestId,
          proposerUserId: params.proposerUserId,
        },
        select: {
          id: true,
          status: true,
          requestPayloadHash: true,
          createdAt: true,
          executedAt: true,
        },
      });

      if (existing) {
        if (existing.requestPayloadHash !== requestPayloadHash) {
          throw new TradeServiceError(
            TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT,
            'Duplicate request with different payload.'
          );
        }

        return toTradeActionResult(existing);
      }

      const trade = await tx.trade.create({
        data: {
          leagueId: params.leagueId,
          roundId: params.roundId ?? null,
          proposerUserId: params.proposerUserId,
          recipientUserId: params.recipientUserId,
          status: TradeStatus.PROPOSED,
          requestId: params.requestId,
          requestPayloadHash,
          parentTradeId: params.parentTradeId ?? null,
          note: params.note ?? null,
        },
        select: { id: true, status: true, createdAt: true, executedAt: true },
      });

      await tx.tradeItem.createMany({
        data: params.items.map((item) => ({
          tradeId: trade.id,
          fromUserId: item.fromUserId,
          toUserId: item.toUserId,
          playerId: item.playerId,
        })),
      });

      if (params.parentTradeId) {
        const parent = await tx.trade.findUnique({
          where: { id: params.parentTradeId },
          select: {
            id: true,
            status: true,
            recipientUserId: true,
          },
        });

        if (!parent) {
          throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Parent trade not found.');
        }

        if (parent.recipientUserId !== params.proposerUserId) {
          throw new TradeServiceError(
            TradeErrorCode.TRADE_FORBIDDEN,
            'Only the recipient can counter a trade.'
          );
        }

        if (parent.status !== TradeStatus.PROPOSED) {
          throw new TradeServiceError(
            TradeErrorCode.TRADE_INVALID_TRANSITION,
            'Only pending trades can be countered.'
          );
        }

        const parentItems = await tx.tradeItem.findMany({
          where: { tradeId: parent.id },
          select: { playerId: true },
        });

        const { sharedPlayerIds, newPlayerIds, removedPlayerIds } = splitPlayerSets(
          parentItems.map((row) => row.playerId),
          params.items.map((item) => item.playerId)
        );

        if (sharedPlayerIds.length > 0) {
          const updated = await tx.tradePlayerLock.updateMany({
            where: { tradeId: parent.id, playerId: { in: sharedPlayerIds } },
            data: { tradeId: trade.id },
          });

          if (updated.count !== sharedPlayerIds.length) {
            throw new TradeServiceError(
              TradeErrorCode.TRADE_PLAYER_LOCKED,
              'Trade locks are not held by the parent trade.'
            );
          }
        }

        await ensureLocks(tx, trade.id, newPlayerIds);

        if (removedPlayerIds.length > 0) {
          await tx.tradePlayerLock.deleteMany({
            where: { tradeId: parent.id, playerId: { in: removedPlayerIds } },
          });
        }

        await tx.trade.update({
          where: { id: parent.id },
          data: {
            status: TradeStatus.SUPERSEDED,
            supersededByTradeId: trade.id,
          },
        });

        await tx.tradeAudit.create({
          data: {
            tradeId: parent.id,
            event: TradeEvent.TRADE_COUNTERED,
            actorUserId: params.proposerUserId,
            payloadJson: { supersededBy: trade.id },
          },
        });
      } else {
        const playerIds = uniquePlayerIds(params.items.map((item) => item.playerId));
        await ensureLocks(tx, trade.id, playerIds);
      }

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_PROPOSED,
          actorUserId: params.proposerUserId,
          payloadJson: {
            items: params.items,
            note: params.note ?? null,
            ruleVersions: params.ruleVersions ?? [],
          },
        },
      });

      return toTradeActionResult(trade);
    });
  },

  async acceptTrade(params: TradeActionParams) {
    return prisma.$transaction(async (tx) => {
      const existingAction = await tx.tradeAction.findUnique({
        where: { requestId: params.requestId },
      });

      if (existingAction) {
        if (
          existingAction.tradeId !== params.tradeId ||
          existingAction.action !== TradeActionType.ACCEPT
        ) {
          throw new TradeServiceError(
            TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT,
            'Duplicate requestId used for a different action.'
          );
        }

        const existingTrade = await tx.trade.findUnique({
          where: { id: params.tradeId },
          select: { id: true, status: true, createdAt: true, executedAt: true },
        });

        if (!existingTrade) {
          throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
        }

        return toTradeActionResult(existingTrade);
      }

      const trade = await tx.trade.findUnique({
        where: { id: params.tradeId },
        include: { items: true },
      });

      if (!trade) {
        throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
      }

      if (trade.recipientUserId !== params.actorUserId) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_FORBIDDEN,
          'Only the recipient can accept this trade.'
        );
      }

      if (trade.status !== TradeStatus.PROPOSED) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not pending.'
        );
      }

      const recorded = await recordTradeAction(tx, trade.id, TradeActionType.ACCEPT, params);
      if (!recorded) {
        const latest = await tx.trade.findUnique({
          where: { id: trade.id },
          select: { id: true, status: true, createdAt: true, executedAt: true },
        });
        return latest ? toTradeActionResult(latest) : toTradeActionResult(trade);
      }

      await assertLocksMatchTrade(tx, trade.id, trade.items.map((item) => item.playerId));

      await applyTradeRosterSwap(tx, trade.leagueId, trade.items);

      const updatedTrade = await tx.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.EXECUTED, executedAt: new Date() },
        select: { id: true, status: true, createdAt: true, executedAt: true },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_ACCEPTED,
          actorUserId: params.actorUserId,
          payloadJson: { requestId: params.requestId },
        },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_EXECUTED,
          actorUserId: params.actorUserId,
          payloadJson: { requestId: params.requestId },
        },
      });

      await tx.tradePlayerLock.deleteMany({ where: { tradeId: trade.id } });

      return toTradeActionResult(updatedTrade);
    });
  },

  async declineTrade(params: TradeActionParams) {
    return prisma.$transaction(async (tx) => {
      const existingAction = await tx.tradeAction.findUnique({
        where: { requestId: params.requestId },
      });

      if (existingAction) {
        if (
          existingAction.tradeId !== params.tradeId ||
          existingAction.action !== TradeActionType.DECLINE
        ) {
          throw new TradeServiceError(
            TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT,
            'Duplicate requestId used for a different action.'
          );
        }

        const existingTrade = await tx.trade.findUnique({
          where: { id: params.tradeId },
          select: { id: true, status: true, createdAt: true, executedAt: true },
        });

        if (!existingTrade) {
          throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
        }

        return toTradeActionResult(existingTrade);
      }

      const trade = await tx.trade.findUnique({
        where: { id: params.tradeId },
        include: { items: true },
      });

      if (!trade) {
        throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
      }

      if (trade.recipientUserId !== params.actorUserId) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_FORBIDDEN,
          'Only the recipient can decline this trade.'
        );
      }

      if (trade.status !== TradeStatus.PROPOSED) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not pending.'
        );
      }

      const recorded = await recordTradeAction(tx, trade.id, TradeActionType.DECLINE, params);
      if (!recorded) {
        const latest = await tx.trade.findUnique({
          where: { id: trade.id },
          select: { id: true, status: true, createdAt: true, executedAt: true },
        });
        return latest ? toTradeActionResult(latest) : toTradeActionResult(trade);
      }

      const updatedTrade = await tx.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.DECLINED },
        select: { id: true, status: true, createdAt: true, executedAt: true },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_DECLINED,
          actorUserId: params.actorUserId,
          payloadJson: { requestId: params.requestId },
        },
      });

      await tx.tradePlayerLock.deleteMany({ where: { tradeId: trade.id } });

      return toTradeActionResult(updatedTrade);
    });
  },

  async cancelTrade(params: TradeActionParams) {
    return prisma.$transaction(async (tx) => {
      const existingAction = await tx.tradeAction.findUnique({
        where: { requestId: params.requestId },
      });

      if (existingAction) {
        if (
          existingAction.tradeId !== params.tradeId ||
          existingAction.action !== TradeActionType.CANCEL
        ) {
          throw new TradeServiceError(
            TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT,
            'Duplicate requestId used for a different action.'
          );
        }

        const existingTrade = await tx.trade.findUnique({
          where: { id: params.tradeId },
          select: { id: true, status: true, createdAt: true, executedAt: true },
        });

        if (!existingTrade) {
          throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
        }

        return toTradeActionResult(existingTrade);
      }

      const trade = await tx.trade.findUnique({
        where: { id: params.tradeId },
        include: { items: true },
      });

      if (!trade) {
        throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
      }

      if (trade.proposerUserId !== params.actorUserId) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_FORBIDDEN,
          'Only the proposer can cancel this trade.'
        );
      }

      if (trade.status !== TradeStatus.PROPOSED) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not pending.'
        );
      }

      const recorded = await recordTradeAction(tx, trade.id, TradeActionType.CANCEL, params);
      if (!recorded) {
        const latest = await tx.trade.findUnique({
          where: { id: trade.id },
          select: { id: true, status: true, createdAt: true, executedAt: true },
        });
        return latest ? toTradeActionResult(latest) : toTradeActionResult(trade);
      }

      const updatedTrade = await tx.trade.update({
        where: { id: trade.id },
        data: { status: TradeStatus.CANCELLED },
        select: { id: true, status: true, createdAt: true, executedAt: true },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_CANCELLED,
          actorUserId: params.actorUserId,
          payloadJson: { requestId: params.requestId },
        },
      });

      await tx.tradePlayerLock.deleteMany({ where: { tradeId: trade.id } });

      return toTradeActionResult(updatedTrade);
    });
  },
};

function computeRequestPayloadHash(params: ProposeTradeParams): string {
  const items = params.items.map((item) => ({
    from: item.fromUserId,
    to: item.toUserId,
    player: item.playerId,
  }));

  items.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.player.localeCompare(b.player);
  });

  const ruleVersions = [...(params.ruleVersions ?? [])].sort();

  const payload = {
    leagueId: params.leagueId,
    roundId: params.roundId ?? null,
    proposerUserId: params.proposerUserId,
    recipientUserId: params.recipientUserId,
    parentTradeId: params.parentTradeId ?? null,
    note: params.note ?? null,
    items,
    ruleVersions,
  };

  return hashPayload(payload);
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function uniquePlayerIds(playerIds: string[]): string[] {
  return Array.from(new Set(playerIds));
}

function splitPlayerSets(parentIds: string[], childIds: string[]) {
  const parentSet = new Set(parentIds);
  const childSet = new Set(childIds);

  const sharedPlayerIds = Array.from(childSet).filter((id) => parentSet.has(id));
  const newPlayerIds = Array.from(childSet).filter((id) => !parentSet.has(id));
  const removedPlayerIds = Array.from(parentSet).filter((id) => !childSet.has(id));

  return { sharedPlayerIds, newPlayerIds, removedPlayerIds };
}

async function ensureLocks(
  tx: Prisma.TransactionClient,
  tradeId: string,
  playerIds: string[]
) {
  if (playerIds.length === 0) return;

  try {
    await tx.tradePlayerLock.createMany({
      data: playerIds.map((playerId) => ({
        playerId,
        tradeId,
      })),
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_PLAYER_LOCKED,
        'One or more players are already locked in another trade.'
      );
    }
    throw error;
  }
}

async function assertLocksMatchTrade(
  tx: Prisma.TransactionClient,
  tradeId: string,
  playerIds: string[]
) {
  if (playerIds.length === 0) return;

  const locks = await tx.tradePlayerLock.findMany({
    where: { playerId: { in: playerIds } },
  });

  const lockMap = new Map(locks.map((lock) => [lock.playerId, lock.tradeId]));
  for (const playerId of playerIds) {
    if (lockMap.get(playerId) !== tradeId) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_PLAYER_LOCKED,
        'Trade locks are missing or owned by another trade.'
      );
    }
  }
}

async function recordTradeAction(
  tx: Prisma.TransactionClient,
  tradeId: string,
  action: TradeActionType,
  params: TradeActionParams
) {
  try {
    await tx.tradeAction.create({
      data: {
        tradeId,
        action,
        requestId: params.requestId,
        actorUserId: params.actorUserId,
      },
    });
    return true;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return false;
    }
    throw error;
  }
}

async function applyTradeRosterSwap(
  tx: Prisma.TransactionClient,
  leagueId: string,
  items: TradeItemInput[]
) {
  const userIds = Array.from(
    new Set(items.flatMap((item) => [item.fromUserId, item.toUserId]))
  );

  const members = await tx.leagueMember.findMany({
    where: { leagueId, userId: { in: userIds } },
    select: { id: true, userId: true },
  });

  if (members.length !== userIds.length) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_FORBIDDEN,
      'All trade participants must be league members.'
    );
  }

  const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));

  const rosterSize = await getRosterLimit(tx, leagueId);

  const outgoingByMember = new Map<string, string[]>();
  const incomingByMember = new Map<string, string[]>();
  const updatedRosterByMember = new Map<string, string[]>();

  for (const item of items) {
    const fromMemberId = memberByUserId.get(item.fromUserId) as string;
    const toMemberId = memberByUserId.get(item.toUserId) as string;

    outgoingByMember.set(fromMemberId, [...(outgoingByMember.get(fromMemberId) ?? []), item.playerId]);
    incomingByMember.set(toMemberId, [...(incomingByMember.get(toMemberId) ?? []), item.playerId]);
  }

  const affectedMemberIds = new Set([
    ...outgoingByMember.keys(),
    ...incomingByMember.keys(),
  ]);

  for (const memberId of affectedMemberIds) {
    const outgoing = outgoingByMember.get(memberId) ?? [];
    const incoming = incomingByMember.get(memberId) ?? [];
    const rosterPlayers = await tx.leagueRosterPlayer.findMany({
      where: { leagueId, memberId },
      select: { playerId: true },
    });

    const playerSet = new Set(rosterPlayers.map((row) => row.playerId));
    const missing = outgoing.filter((playerId) => !playerSet.has(playerId));
    if (missing.length > 0) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_PLAYER_NOT_OWNED,
        'One or more players are not owned by the sender.',
        { memberId, playerIds: missing }
      );
    }

    outgoing.forEach((playerId) => playerSet.delete(playerId));
    incoming.forEach((playerId) => playerSet.add(playerId));

    if (playerSet.size > rosterSize) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_ROSTER_INVALID,
        'Trade results in an invalid roster size.',
        { memberId, rosterSize, rosterCount: playerSet.size }
      );
    }

    updatedRosterByMember.set(memberId, Array.from(playerSet));
  }

  for (const [memberId, outgoing] of outgoingByMember.entries()) {
    if (outgoing.length > 0) {
      await tx.leagueRosterPlayer.deleteMany({
        where: { leagueId, memberId, playerId: { in: outgoing } },
      });
    }
  }

  for (const [memberId, incoming] of incomingByMember.entries()) {
    if (incoming.length === 0) continue;

    await tx.leagueRosterPlayer.createMany({
      data: incoming.map((playerId) => ({
        id: `${leagueId}:${memberId}:${playerId}`,
        leagueId,
        memberId,
        playerId,
      })),
    });
  }

  for (const [memberId, playerIds] of updatedRosterByMember.entries()) {
    const rosterId = `${leagueId}:${memberId}`;
    await tx.leagueRoster.upsert({
      where: { id: rosterId },
      create: {
        id: rosterId,
        leagueId,
        memberId,
        playerIds: stringifyIds(playerIds),
      },
      update: { playerIds: stringifyIds(playerIds) },
    });
  }
}

async function getRosterLimit(tx: Prisma.TransactionClient, leagueId: string) {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });

  if (!league?.settings) {
    return Number.MAX_SAFE_INTEGER;
  }

  return league.settings.rosterSize + league.settings.benchSize;
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

function stringifyIds(ids: string[]): string {
  return JSON.stringify(Array.from(new Set(ids)));
}

function toTradeActionResult(trade: {
  id: string;
  status: TradeStatus;
  createdAt: Date;
  executedAt?: Date | null;
}): TradeActionResult {
  return {
    tradeId: trade.id,
    status: trade.status,
    createdAt: trade.createdAt.toISOString(),
    executedAt: trade.executedAt ? trade.executedAt.toISOString() : undefined,
  };
}
