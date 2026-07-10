import { LeagueTradeStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { syncCanonicalRosterProjection } from '@/server/rosters/LeagueOwnershipService';

export type TradeMutationErrorCode =
  | 'TRADE_NOT_FOUND'
  | 'TEAM_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TRADE'
  | 'STALE_TRADE'
  | 'ROSTER_LIMIT_REACHED';

export class TradeMutationError extends Error {
  constructor(
    readonly code: TradeMutationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TradeMutationError';
  }
}

interface TradePlayerMove {
  playerId: string;
  fromMemberId: string;
  toMemberId: string;
}

function uniquePlayerIds(playerIds: string[]): string[] {
  return [...new Set(playerIds.map((playerId) => playerId.trim()).filter(Boolean))];
}

function rejectDuplicateAssets(offeredPlayerIds: string[], requestedPlayerIds: string[]): void {
  const assetIds = [...offeredPlayerIds, ...requestedPlayerIds];
  if (assetIds.length === 0) {
    throw new TradeMutationError('INVALID_TRADE', 'A trade must include at least one player');
  }
  if (new Set(assetIds).size !== assetIds.length) {
    throw new TradeMutationError('INVALID_TRADE', 'A player can only appear once in a trade');
  }
}

export class LeagueTradeService {
  constructor(private readonly db: Pick<typeof prisma, '$transaction'> = prisma) {}

  async createProposal(input: {
    leagueId: string;
    proposerUserId: string;
    recipientMemberId: string;
    playersOffered: string[];
    playersRequested: string[];
    message?: string;
    expiresAt: Date;
  }) {
    const playersOffered = uniquePlayerIds(input.playersOffered);
    const playersRequested = uniquePlayerIds(input.playersRequested);
    rejectDuplicateAssets(playersOffered, playersRequested);

    return this.db.$transaction(async (tx) => {
      const [proposer, recipient, league] = await Promise.all([
        tx.leagueMember.findUnique({
          where: { leagueId_userId: { leagueId: input.leagueId, userId: input.proposerUserId } },
          select: { id: true },
        }),
        tx.leagueMember.findUnique({
          where: { id: input.recipientMemberId },
          select: { id: true, leagueId: true },
        }),
        tx.league.findUnique({ where: { id: input.leagueId }, select: { id: true } }),
      ]);

      if (!league) throw new TradeMutationError('TEAM_NOT_FOUND', 'League not found');
      if (!proposer || !recipient || recipient.leagueId !== input.leagueId) {
        throw new TradeMutationError('TEAM_NOT_FOUND', 'Trade team not found in this league');
      }
      if (proposer.id === recipient.id) {
        throw new TradeMutationError('INVALID_TRADE', 'A team cannot trade with itself');
      }
      if (input.expiresAt <= new Date()) {
        throw new TradeMutationError('INVALID_TRADE', 'Trade expiry must be in the future');
      }

      const moves: TradePlayerMove[] = [
        ...playersOffered.map((playerId) => ({
          playerId,
          fromMemberId: proposer.id,
          toMemberId: recipient.id,
        })),
        ...playersRequested.map((playerId) => ({
          playerId,
          fromMemberId: recipient.id,
          toMemberId: proposer.id,
        })),
      ];
      await this.assertOwnership(tx, input.leagueId, moves);

      return tx.leagueTrade.create({
        data: {
          leagueId: input.leagueId,
          proposerMemberId: proposer.id,
          recipientMemberId: recipient.id,
          message: input.message?.trim() || null,
          expiresAt: input.expiresAt,
          players: {
            create: moves,
          },
        },
        include: {
          players: true,
          proposer: { select: { userId: true } },
          recipient: { select: { userId: true } },
        },
      });
    });
  }

  async acceptProposal(input: { leagueId: string; tradeId: string; recipientUserId: string }) {
    return this.db.$transaction(async (tx) => {
      const trade = await tx.leagueTrade.findUnique({
        where: { id: input.tradeId },
        include: { players: true, recipient: { select: { userId: true } } },
      });

      if (!trade || trade.leagueId !== input.leagueId) {
        throw new TradeMutationError('TRADE_NOT_FOUND', 'Trade not found');
      }
      if (trade.recipient.userId !== input.recipientUserId) {
        throw new TradeMutationError('FORBIDDEN', 'Only the receiving team can accept this trade');
      }
      if (trade.status !== LeagueTradeStatus.PENDING) {
        throw new TradeMutationError('STALE_TRADE', 'Trade is no longer pending');
      }
      if (trade.expiresAt <= new Date()) {
        await tx.leagueTrade.update({
          where: { id: trade.id },
          data: { status: LeagueTradeStatus.EXPIRED },
        });
        throw new TradeMutationError('STALE_TRADE', 'Trade has expired');
      }

      await this.assertOwnership(tx, input.leagueId, trade.players);
      await this.assertTradeCapacity(tx, input.leagueId, trade.players);

      for (const move of trade.players) {
        const update = await tx.leagueRosterPlayer.updateMany({
          where: {
            leagueId: input.leagueId,
            playerId: move.playerId,
            memberId: move.fromMemberId,
          },
          data: {
            memberId: move.toMemberId,
            acquiredBy: 'TRADE',
            acquiredAt: new Date(),
          },
        });
        if (update.count !== 1) {
          throw new TradeMutationError(
            'STALE_TRADE',
            'Player ownership changed before trade acceptance'
          );
        }
      }

      for (const memberId of new Set(
        trade.players.flatMap((move) => [move.fromMemberId, move.toMemberId])
      )) {
        await syncCanonicalRosterProjection(tx, input.leagueId, memberId);
      }

      return tx.leagueTrade.update({
        where: { id: trade.id },
        data: { status: LeagueTradeStatus.PROCESSED, processedAt: new Date() },
        include: { players: true },
      });
    });
  }

  private async assertOwnership(
    tx: Prisma.TransactionClient,
    leagueId: string,
    moves: TradePlayerMove[]
  ): Promise<void> {
    const ownerships = await tx.leagueRosterPlayer.findMany({
      where: { leagueId, playerId: { in: moves.map((move) => move.playerId) } },
      select: { playerId: true, memberId: true },
    });
    const ownerByPlayer = new Map(
      ownerships.map((ownership) => [ownership.playerId, ownership.memberId])
    );

    for (const move of moves) {
      if (ownerByPlayer.get(move.playerId) !== move.fromMemberId) {
        throw new TradeMutationError(
          'STALE_TRADE',
          'Trade contains a player no longer owned by the offering team'
        );
      }
    }
  }

  private async assertTradeCapacity(
    tx: Prisma.TransactionClient,
    leagueId: string,
    moves: TradePlayerMove[]
  ): Promise<void> {
    const league = await tx.league.findUnique({
      where: { id: leagueId },
      select: { settings: { select: { rosterSize: true } } },
    });
    if (!league) throw new TradeMutationError('TEAM_NOT_FOUND', 'League not found');

    const memberIds = [...new Set(moves.flatMap((move) => [move.fromMemberId, move.toMemberId]))];
    const currentCounts = await tx.leagueRosterPlayer.groupBy({
      by: ['memberId'],
      where: { leagueId, memberId: { in: memberIds } },
      _count: { _all: true },
    });
    const countByMember = new Map(
      currentCounts.map((count) => [count.memberId, count._count._all])
    );

    for (const memberId of memberIds) {
      const outgoing = moves.filter((move) => move.fromMemberId === memberId).length;
      const incoming = moves.filter((move) => move.toMemberId === memberId).length;
      const current = countByMember.get(memberId) ?? 0;
      if (current - outgoing + incoming > league.settings.rosterSize) {
        throw new TradeMutationError('ROSTER_LIMIT_REACHED', 'Trade would exceed roster limit');
      }
    }
  }
}
