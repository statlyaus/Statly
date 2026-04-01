import { createHash } from 'crypto';

import {
  Prisma,
  TradeActionType,
  TradeErrorCode,
  TradeEvent,
  TradeReviewMode,
  TradeReviewStatus,
  TradeReviewVoteType,
  TradeStatus,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';

const DEFAULT_VETO_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export interface TradeReviewVoteParams extends TradeActionParams {
  voteType: TradeReviewVoteType;
}

export interface TradeActionResult {
  tradeId: string;
  status: TradeStatus;
  createdAt: string;
  acceptedAt?: string;
  executedAt?: string;
  reviewStatus?: TradeReviewStatus;
  reviewWindowEndsAt?: string;
}

type TradeWithItems = Prisma.TradeGetPayload<{
  include: {
    items: true;
    reviewVotes: true;
  };
}>;

type TradeGovernance = {
  leagueId: string;
  tradeLimit: number;
  tradeDeadline: Date | null;
  reviewMode: TradeReviewMode;
  settingsLocked: boolean;
};

type SwapPlan = {
  memberByUserId: Map<string, string>;
  updatedRosterByMember: Map<string, string[]>;
  outgoingByMember: Map<string, string[]>;
  incomingByMember: Map<string, string[]>;
};

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
      const governance = await loadTradeGovernance(tx, params.leagueId);
      assertTradeWindowOpen(governance);
      validateTradeItems(params);
      await assertTradeLimitAvailable(tx, governance, [
        params.proposerUserId,
        params.recipientUserId,
      ]);
      await assertTradeParticipants(tx, params.leagueId, [
        params.proposerUserId,
        params.recipientUserId,
      ]);
      await buildTradeSwapPlan(
        tx,
        params.leagueId,
        params.items,
        params.proposerUserId,
        params.recipientUserId
      );

      const requestPayloadHash = computeRequestPayloadHash(params);

      const existing = await tx.trade.findFirst({
        where: {
          requestId: params.requestId,
          proposerUserId: params.proposerUserId,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          executedAt: true,
          reviewStatus: true,
          reviewWindowEndsAt: true,
          requestPayloadHash: true,
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
          reviewMode: governance.reviewMode,
          reviewStatus: TradeReviewStatus.NOT_REQUIRED,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          executedAt: true,
          reviewStatus: true,
          reviewWindowEndsAt: true,
        },
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
        await supersedeParentTrade(tx, params, trade.id);
      } else {
        await ensureLocks(
          tx,
          params.leagueId,
          trade.id,
          uniquePlayerIds(params.items.map((item) => item.playerId))
        );
      }

      const payloadItems = params.items.map((item) => ({
        fromUserId: item.fromUserId,
        toUserId: item.toUserId,
        playerId: item.playerId,
      }));

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_PROPOSED,
          actorUserId: params.proposerUserId,
          payloadJson: {
            items: payloadItems as unknown as Prisma.JsonArray,
            note: params.note ?? null,
            ruleVersions: params.ruleVersions ?? [],
            reviewMode: governance.reviewMode,
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
          select: {
            id: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            executedAt: true,
            reviewStatus: true,
            reviewWindowEndsAt: true,
          },
        });

        if (!existingTrade) {
          throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
        }

        return toTradeActionResult(existingTrade);
      }

      const trade = await loadTradeForMutation(tx, params.tradeId);
      if (trade.recipientUserId !== params.actorUserId) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_FORBIDDEN,
          'Only the recipient can accept this trade.'
        );
      }

      if (trade.status !== TradeStatus.PROPOSED) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not pending recipient acceptance.'
        );
      }

      const governance = await loadTradeGovernance(tx, trade.leagueId);
      assertTradeWindowOpen(governance);
      await assertTradeLimitAvailable(tx, governance, [
        trade.proposerUserId,
        trade.recipientUserId,
      ]);

      const recorded = await recordTradeAction(tx, trade.id, TradeActionType.ACCEPT, params);
      if (!recorded) {
        const latest = await tx.trade.findUnique({
          where: { id: trade.id },
          select: {
            id: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            executedAt: true,
            reviewStatus: true,
            reviewWindowEndsAt: true,
          },
        });
        return latest ? toTradeActionResult(latest) : toTradeActionResult(trade);
      }

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_ACCEPTED,
          actorUserId: params.actorUserId,
          payloadJson: { requestId: params.requestId },
        },
      });

      if (trade.reviewMode === TradeReviewMode.NONE) {
        return executeTrade(tx, trade, params.actorUserId);
      }

      const reviewWindowEndsAt =
        trade.reviewMode === TradeReviewMode.VETO
          ? new Date(Date.now() + DEFAULT_VETO_REVIEW_WINDOW_MS)
          : null;

      const updatedTrade = await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.REVIEW_PENDING,
          acceptedAt: new Date(),
          reviewStatus: TradeReviewStatus.PENDING,
          reviewRequestedAt: new Date(),
          reviewWindowEndsAt,
          reviewDecidedAt: null,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          executedAt: true,
          reviewStatus: true,
          reviewWindowEndsAt: true,
        },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_REVIEW_REQUESTED,
          actorUserId: params.actorUserId,
          payloadJson: {
            mode: trade.reviewMode,
            requestId: params.requestId,
            reviewWindowEndsAt: reviewWindowEndsAt?.toISOString() ?? null,
          },
        },
      });

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
          select: {
            id: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            executedAt: true,
            reviewStatus: true,
            reviewWindowEndsAt: true,
          },
        });

        if (!existingTrade) {
          throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
        }

        return toTradeActionResult(existingTrade);
      }

      const trade = await loadTradeForMutation(tx, params.tradeId);
      if (trade.recipientUserId !== params.actorUserId) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_FORBIDDEN,
          'Only the recipient can decline this trade.'
        );
      }

      if (trade.status !== TradeStatus.PROPOSED) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not pending recipient acceptance.'
        );
      }

      const recorded = await recordTradeAction(tx, trade.id, TradeActionType.DECLINE, params);
      if (!recorded) {
        const latest = await tx.trade.findUnique({
          where: { id: trade.id },
          select: {
            id: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            executedAt: true,
            reviewStatus: true,
            reviewWindowEndsAt: true,
          },
        });
        return latest ? toTradeActionResult(latest) : toTradeActionResult(trade);
      }

      const updatedTrade = await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.DECLINED,
          reviewStatus: TradeReviewStatus.NOT_REQUIRED,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          executedAt: true,
          reviewStatus: true,
          reviewWindowEndsAt: true,
        },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_DECLINED,
          actorUserId: params.actorUserId,
          payloadJson: { requestId: params.requestId },
        },
      });

      await releaseLocks(tx, trade.leagueId, trade.id);

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
          select: {
            id: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            executedAt: true,
            reviewStatus: true,
            reviewWindowEndsAt: true,
          },
        });

        if (!existingTrade) {
          throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
        }

        return toTradeActionResult(existingTrade);
      }

      const trade = await loadTradeForMutation(tx, params.tradeId);
      if (trade.proposerUserId !== params.actorUserId) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_FORBIDDEN,
          'Only the proposer can cancel this trade.'
        );
      }

      if (trade.status !== TradeStatus.PROPOSED && trade.status !== TradeStatus.REVIEW_PENDING) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not cancellable.'
        );
      }

      const recorded = await recordTradeAction(tx, trade.id, TradeActionType.CANCEL, params);
      if (!recorded) {
        const latest = await tx.trade.findUnique({
          where: { id: trade.id },
          select: {
            id: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            executedAt: true,
            reviewStatus: true,
            reviewWindowEndsAt: true,
          },
        });
        return latest ? toTradeActionResult(latest) : toTradeActionResult(trade);
      }

      const updatedTrade = await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.CANCELLED,
          reviewStatus:
            trade.status === TradeStatus.REVIEW_PENDING
              ? TradeReviewStatus.REJECTED
              : trade.reviewStatus,
          reviewDecidedAt:
            trade.status === TradeStatus.REVIEW_PENDING ? new Date() : trade.reviewDecidedAt,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          executedAt: true,
          reviewStatus: true,
          reviewWindowEndsAt: true,
        },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_CANCELLED,
          actorUserId: params.actorUserId,
          payloadJson: { requestId: params.requestId },
        },
      });

      await releaseLocks(tx, trade.leagueId, trade.id);

      return toTradeActionResult(updatedTrade);
    });
  },

  async approveTradeReview(params: TradeActionParams) {
    return prisma.$transaction(async (tx) => {
      const trade = await loadTradeForMutation(tx, params.tradeId);
      if (trade.status !== TradeStatus.REVIEW_PENDING) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not waiting for review.'
        );
      }

      if (trade.reviewMode !== TradeReviewMode.ADMIN) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'This trade does not use commissioner review.'
        );
      }

      const governance = await loadTradeGovernance(tx, trade.leagueId);
      assertTradeWindowOpen(governance);
      await assertTradeLimitAvailable(tx, governance, [
        trade.proposerUserId,
        trade.recipientUserId,
      ]);

      return approveAndExecuteTrade(tx, trade, params.actorUserId, {
        requestId: params.requestId,
        decision: 'admin_approved',
      });
    });
  },

  async rejectTradeReview(params: TradeActionParams) {
    return prisma.$transaction(async (tx) => {
      const trade = await loadTradeForMutation(tx, params.tradeId);
      if (trade.status !== TradeStatus.REVIEW_PENDING) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not waiting for review.'
        );
      }

      const updatedTrade = await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: TradeStatus.REVIEW_REJECTED,
          reviewStatus: TradeReviewStatus.REJECTED,
          reviewDecidedAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          executedAt: true,
          reviewStatus: true,
          reviewWindowEndsAt: true,
        },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_REVIEW_REJECTED,
          actorUserId: params.actorUserId,
          payloadJson: {
            requestId: params.requestId,
            mode: trade.reviewMode,
          },
        },
      });

      await releaseLocks(tx, trade.leagueId, trade.id);

      return toTradeActionResult(updatedTrade);
    });
  },

  async castTradeReviewVote(params: TradeReviewVoteParams) {
    return prisma.$transaction(async (tx) => {
      const trade = await loadTradeForMutation(tx, params.tradeId);
      if (trade.status !== TradeStatus.REVIEW_PENDING || trade.reviewMode !== TradeReviewMode.VETO) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Trade is not waiting for league veto review.'
        );
      }

      await assertTradeReviewVoter(tx, trade, params.actorUserId);

      const existingVote = await tx.tradeReviewVote.findUnique({
        where: {
          tradeId_voterUserId: {
            tradeId: trade.id,
            voterUserId: params.actorUserId,
          },
        },
      });

      if (existingVote) {
        if (existingVote.voteType !== params.voteType) {
          throw new TradeServiceError(
            TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT,
            'Reviewer already cast a different vote for this trade.'
          );
        }

        return toTradeActionResult(trade);
      }

      await tx.tradeReviewVote.create({
        data: {
          tradeId: trade.id,
          voterUserId: params.actorUserId,
          voteType: params.voteType,
        },
      });

      await tx.tradeAudit.create({
        data: {
          tradeId: trade.id,
          event: TradeEvent.TRADE_REVIEW_VOTE_CAST,
          actorUserId: params.actorUserId,
          payloadJson: {
            requestId: params.requestId,
            voteType: params.voteType,
          },
        },
      });

      if (params.voteType === TradeReviewVoteType.VETO) {
        const threshold = await computeVetoThreshold(tx, trade);
        const vetoCount = await tx.tradeReviewVote.count({
          where: {
            tradeId: trade.id,
            voteType: TradeReviewVoteType.VETO,
          },
        });

        if (vetoCount >= threshold) {
          const rejected = await tx.trade.update({
            where: { id: trade.id },
            data: {
              status: TradeStatus.REVIEW_REJECTED,
              reviewStatus: TradeReviewStatus.REJECTED,
              reviewDecidedAt: new Date(),
            },
            select: {
              id: true,
              status: true,
              createdAt: true,
              acceptedAt: true,
              executedAt: true,
              reviewStatus: true,
              reviewWindowEndsAt: true,
            },
          });

          await tx.tradeAudit.create({
            data: {
              tradeId: trade.id,
              event: TradeEvent.TRADE_REVIEW_REJECTED,
              actorUserId: params.actorUserId,
              payloadJson: {
                requestId: params.requestId,
                voteType: params.voteType,
                vetoCount,
                threshold,
              },
            },
          });

          await releaseLocks(tx, trade.leagueId, trade.id);

          return toTradeActionResult(rejected);
        }
      }

      const refreshed = await tx.trade.findUnique({
        where: { id: trade.id },
        select: {
          id: true,
          status: true,
          createdAt: true,
          acceptedAt: true,
          executedAt: true,
          reviewStatus: true,
          reviewWindowEndsAt: true,
        },
      });

      return refreshed ? toTradeActionResult(refreshed) : toTradeActionResult(trade);
    });
  },

  async finalizeTradeReview(params: TradeActionParams) {
    return prisma.$transaction(async (tx) => {
      const trade = await loadTradeForMutation(tx, params.tradeId);
      if (trade.status !== TradeStatus.REVIEW_PENDING) {
        return toTradeActionResult(trade);
      }

      if (trade.reviewMode !== TradeReviewMode.VETO) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Only league veto reviews can be finalized automatically.'
        );
      }

      if (!trade.reviewWindowEndsAt || trade.reviewWindowEndsAt.getTime() > Date.now()) {
        throw new TradeServiceError(
          TradeErrorCode.TRADE_INVALID_TRANSITION,
          'Review window is still open.'
        );
      }

      const threshold = await computeVetoThreshold(tx, trade);
      const vetoCount = await tx.tradeReviewVote.count({
        where: {
          tradeId: trade.id,
          voteType: TradeReviewVoteType.VETO,
        },
      });

      if (vetoCount >= threshold) {
        const rejected = await tx.trade.update({
          where: { id: trade.id },
          data: {
            status: TradeStatus.REVIEW_REJECTED,
            reviewStatus: TradeReviewStatus.REJECTED,
            reviewDecidedAt: new Date(),
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
            acceptedAt: true,
            executedAt: true,
            reviewStatus: true,
            reviewWindowEndsAt: true,
          },
        });

        await tx.tradeAudit.create({
          data: {
            tradeId: trade.id,
            event: TradeEvent.TRADE_REVIEW_REJECTED,
            actorUserId: params.actorUserId,
            payloadJson: {
              requestId: params.requestId,
              vetoCount,
              threshold,
              finalized: true,
            },
          },
        });

        await releaseLocks(tx, trade.leagueId, trade.id);

        return toTradeActionResult(rejected);
      }

      const governance = await loadTradeGovernance(tx, trade.leagueId);
      assertTradeWindowOpen(governance);
      await assertTradeLimitAvailable(tx, governance, [
        trade.proposerUserId,
        trade.recipientUserId,
      ]);

      return approveAndExecuteTrade(tx, trade, params.actorUserId, {
        requestId: params.requestId,
        decision: 'veto_window_closed',
      });
    });
  },
};

function validateTradeItems(params: ProposeTradeParams) {
  if (!params.leagueId || !params.requestId) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_INVALID_PAYLOAD,
      'Trade request is missing league context.'
    );
  }

  if (params.proposerUserId === params.recipientUserId) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_INVALID_PAYLOAD,
      'Trades must be between two different managers.'
    );
  }

  if (params.items.length === 0) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_INVALID_PAYLOAD,
      'Trade must include at least one player from each side.'
    );
  }

  const allowedUserIds = new Set([params.proposerUserId, params.recipientUserId]);
  const seenPlayerIds = new Set<string>();
  let proposerOutgoing = 0;
  let recipientOutgoing = 0;

  for (const item of params.items) {
    if (!item.playerId || !item.fromUserId || !item.toUserId) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_INVALID_PAYLOAD,
        'Trade items must specify playerId, fromUserId, and toUserId.'
      );
    }

    if (!allowedUserIds.has(item.fromUserId) || !allowedUserIds.has(item.toUserId)) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_INVALID_PAYLOAD,
        'Trade items must only involve the proposer and recipient.'
      );
    }

    if (item.fromUserId === item.toUserId) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_INVALID_PAYLOAD,
        'Trade items must move between teams.'
      );
    }

    if (seenPlayerIds.has(item.playerId)) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_INVALID_PAYLOAD,
        'Duplicate playerId in trade items.'
      );
    }

    seenPlayerIds.add(item.playerId);

    if (item.fromUserId === params.proposerUserId) proposerOutgoing += 1;
    if (item.fromUserId === params.recipientUserId) recipientOutgoing += 1;
  }

  if (proposerOutgoing === 0 || recipientOutgoing === 0) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_INVALID_PAYLOAD,
      'Trade must include outgoing players from both teams.'
    );
  }
}

async function loadTradeGovernance(
  tx: Prisma.TransactionClient,
  leagueId: string
): Promise<TradeGovernance> {
  const league = await tx.league.findUnique({
    where: { id: leagueId },
    include: { settings: true },
  });

  if (!league) {
    throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'League not found.');
  }

  return {
    leagueId: league.id,
    tradeLimit: league.tradeLimit,
    tradeDeadline: league.tradeDeadline ?? null,
    reviewMode: normalizeReviewMode(league.tradeReview),
    settingsLocked: league.settings?.locked ?? false,
  };
}

function normalizeReviewMode(raw: string | null | undefined): TradeReviewMode {
  switch (raw) {
    case 'admin':
    case 'commissioner':
      return TradeReviewMode.ADMIN;
    case 'veto':
    case 'league':
      return TradeReviewMode.VETO;
    default:
      return TradeReviewMode.NONE;
  }
}

function assertTradeWindowOpen(governance: TradeGovernance) {
  if (governance.settingsLocked) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_WINDOW_CLOSED,
      'Trading is closed for this league.'
    );
  }

  if (governance.tradeDeadline && governance.tradeDeadline.getTime() < Date.now()) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_WINDOW_CLOSED,
      'The league trade deadline has passed.'
    );
  }
}

async function assertTradeLimitAvailable(
  tx: Prisma.TransactionClient,
  governance: TradeGovernance,
  userIds: string[]
) {
  if (governance.tradeLimit <= 0) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_LIMIT_REACHED,
      'No further trades are allowed in this league.'
    );
  }

  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) return;

  const executedTrades = await tx.trade.findMany({
    where: {
      leagueId: governance.leagueId,
      status: TradeStatus.EXECUTED,
      OR: [
        { proposerUserId: { in: uniqueUserIds } },
        { recipientUserId: { in: uniqueUserIds } },
      ],
    },
    select: {
      proposerUserId: true,
      recipientUserId: true,
    },
  });

  const counts = new Map(uniqueUserIds.map((userId) => [userId, 0]));
  for (const trade of executedTrades) {
    if (counts.has(trade.proposerUserId)) {
      counts.set(trade.proposerUserId, (counts.get(trade.proposerUserId) ?? 0) + 1);
    }
    if (counts.has(trade.recipientUserId)) {
      counts.set(trade.recipientUserId, (counts.get(trade.recipientUserId) ?? 0) + 1);
    }
  }

  for (const [userId, count] of counts.entries()) {
    if (count >= governance.tradeLimit) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_LIMIT_REACHED,
        'One or more teams have reached the league trade limit.',
        {
          userId,
          tradeLimit: governance.tradeLimit,
          executedTrades: count,
        }
      );
    }
  }
}

async function assertTradeParticipants(
  tx: Prisma.TransactionClient,
  leagueId: string,
  userIds: string[]
) {
  const members = await tx.leagueMember.findMany({
    where: {
      leagueId,
      userId: { in: userIds },
    },
    select: {
      userId: true,
    },
  });

  if (members.length !== new Set(userIds).size) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_FORBIDDEN,
      'All trade participants must be league members.'
    );
  }
}

async function supersedeParentTrade(
  tx: Prisma.TransactionClient,
  params: ProposeTradeParams,
  tradeId: string
) {
  const parent = await tx.trade.findUnique({
    where: { id: params.parentTradeId as string },
    select: {
      id: true,
      leagueId: true,
      status: true,
      recipientUserId: true,
    },
  });

  if (!parent) {
    throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Parent trade not found.');
  }

  if (parent.leagueId !== params.leagueId) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_INVALID_PAYLOAD,
      'Counter trade must remain in the same league.'
    );
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
      'Only trades awaiting a recipient response can be countered.'
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
      where: {
        leagueId: params.leagueId,
        tradeId: parent.id,
        playerId: { in: sharedPlayerIds },
      },
      data: { tradeId },
    });

    if (updated.count !== sharedPlayerIds.length) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_PLAYER_LOCKED,
        'Trade locks are not held by the parent trade.'
      );
    }
  }

  await ensureLocks(tx, params.leagueId, tradeId, newPlayerIds);

  if (removedPlayerIds.length > 0) {
    await tx.tradePlayerLock.deleteMany({
      where: {
        leagueId: params.leagueId,
        tradeId: parent.id,
        playerId: { in: removedPlayerIds },
      },
    });
  }

  await tx.trade.update({
    where: { id: parent.id },
    data: {
      status: TradeStatus.SUPERSEDED,
      supersededByTradeId: tradeId,
    },
  });

  await tx.tradeAudit.create({
    data: {
      tradeId: parent.id,
      event: TradeEvent.TRADE_COUNTERED,
      actorUserId: params.proposerUserId,
      payloadJson: { supersededBy: tradeId },
    },
  });
}

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
  leagueId: string,
  tradeId: string,
  playerIds: string[]
) {
  if (playerIds.length === 0) return;

  try {
    await tx.tradePlayerLock.createMany({
      data: playerIds.map((playerId) => ({
        leagueId,
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
  leagueId: string,
  tradeId: string,
  playerIds: string[]
) {
  if (playerIds.length === 0) return;

  const locks = await tx.tradePlayerLock.findMany({
    where: {
      leagueId,
      playerId: { in: playerIds },
    },
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

async function releaseLocks(
  tx: Prisma.TransactionClient,
  leagueId: string,
  tradeId: string
) {
  await tx.tradePlayerLock.deleteMany({
    where: {
      leagueId,
      tradeId,
    },
  });
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

async function buildTradeSwapPlan(
  tx: Prisma.TransactionClient,
  leagueId: string,
  items: TradeItemInput[],
  proposerUserId: string,
  recipientUserId: string
): Promise<SwapPlan> {
  const userIds = Array.from(new Set(items.flatMap((item) => [item.fromUserId, item.toUserId])));
  const allowedUserIds = new Set([proposerUserId, recipientUserId]);

  for (const userId of userIds) {
    if (!allowedUserIds.has(userId)) {
      throw new TradeServiceError(
        TradeErrorCode.TRADE_INVALID_PAYLOAD,
        'Trade items must only involve the proposer and recipient.'
      );
    }
  }

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

    outgoingByMember.set(fromMemberId, [
      ...(outgoingByMember.get(fromMemberId) ?? []),
      item.playerId,
    ]);
    incomingByMember.set(toMemberId, [
      ...(incomingByMember.get(toMemberId) ?? []),
      item.playerId,
    ]);
  }

  const affectedMemberIds = new Set([...outgoingByMember.keys(), ...incomingByMember.keys()]);

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

  return {
    memberByUserId,
    updatedRosterByMember,
    outgoingByMember,
    incomingByMember,
  };
}

async function applyTradeRosterSwap(
  tx: Prisma.TransactionClient,
  leagueId: string,
  items: TradeItemInput[],
  proposerUserId: string,
  recipientUserId: string
) {
  const plan = await buildTradeSwapPlan(
    tx,
    leagueId,
    items,
    proposerUserId,
    recipientUserId
  );

  for (const [memberId, outgoing] of plan.outgoingByMember.entries()) {
    if (outgoing.length > 0) {
      await tx.leagueRosterPlayer.deleteMany({
        where: { leagueId, memberId, playerId: { in: outgoing } },
      });
    }
  }

  for (const [memberId, incoming] of plan.incomingByMember.entries()) {
    if (incoming.length === 0) continue;

    const existingMax = await tx.leagueRosterPlayer
      .aggregate({
        where: { leagueId, memberId },
        _max: { sortOrder: true },
      })
      .then((result) => (result._max.sortOrder ?? -1) + 1);

    await tx.leagueRosterPlayer.createMany({
      data: incoming.map((playerId, idx) => ({
        id: `${leagueId}:${memberId}:${playerId}`,
        leagueId,
        memberId,
        playerId,
        sortOrder: existingMax + idx,
      })),
    });
  }

  for (const [memberId, playerIds] of plan.updatedRosterByMember.entries()) {
    const roster = await tx.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId, memberId } },
      select: {
        captainId: true,
        viceCaptainId: true,
        benchOrder: true,
      },
    });

    const playerSet = new Set(playerIds);
    const captainId = roster?.captainId && playerSet.has(roster.captainId) ? roster.captainId : null;
    const viceCaptainId =
      roster?.viceCaptainId && playerSet.has(roster.viceCaptainId) ? roster.viceCaptainId : null;
    const benchOrder = sanitizeBenchOrder(roster?.benchOrder, playerSet);

    await tx.leagueRoster.upsert({
      where: { leagueId_memberId: { leagueId, memberId } },
      create: {
        leagueId,
        memberId,
        playerIds: stringifyIds(playerIds),
        captainId,
        viceCaptainId,
        benchOrder,
      },
      update: {
        playerIds: stringifyIds(playerIds),
        captainId,
        viceCaptainId,
        benchOrder,
      },
    });
  }
}

function sanitizeBenchOrder(
  rawBenchOrder: string | null | undefined,
  playerIds: Set<string>
): string | null {
  if (!rawBenchOrder) return null;

  try {
    const parsed = JSON.parse(rawBenchOrder);
    if (!Array.isArray(parsed)) return null;
    const filtered = parsed.filter(
      (value): value is string => typeof value === 'string' && playerIds.has(value)
    );
    return filtered.length > 0 ? JSON.stringify(filtered) : null;
  } catch {
    return null;
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

async function loadTradeForMutation(
  tx: Prisma.TransactionClient,
  tradeId: string
): Promise<TradeWithItems> {
  const trade = await tx.trade.findUnique({
    where: { id: tradeId },
    include: {
      items: true,
      reviewVotes: true,
    },
  });

  if (!trade) {
    throw new TradeServiceError(TradeErrorCode.TRADE_NOT_FOUND, 'Trade not found.');
  }

  return trade;
}

async function executeTrade(
  tx: Prisma.TransactionClient,
  trade: TradeWithItems,
  actorUserId: string
) {
  await assertLocksMatchTrade(
    tx,
    trade.leagueId,
    trade.id,
    trade.items.map((item) => item.playerId)
  );

  await applyTradeRosterSwap(
    tx,
    trade.leagueId,
    trade.items,
    trade.proposerUserId,
    trade.recipientUserId
  );

  const updatedTrade = await tx.trade.update({
    where: { id: trade.id },
    data: {
      status: TradeStatus.EXECUTED,
      acceptedAt: trade.acceptedAt ?? new Date(),
      executedAt: new Date(),
      reviewStatus:
        trade.reviewMode === TradeReviewMode.NONE
          ? TradeReviewStatus.NOT_REQUIRED
          : TradeReviewStatus.APPROVED,
      reviewDecidedAt:
        trade.reviewMode === TradeReviewMode.NONE ? trade.reviewDecidedAt : new Date(),
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      acceptedAt: true,
      executedAt: true,
      reviewStatus: true,
      reviewWindowEndsAt: true,
    },
  });

  await tx.tradeAudit.create({
    data: {
      tradeId: trade.id,
      event: TradeEvent.TRADE_EXECUTED,
      actorUserId,
      payloadJson: {
        reviewMode: trade.reviewMode,
      },
    },
  });

  await releaseLocks(tx, trade.leagueId, trade.id);

  return toTradeActionResult(updatedTrade);
}

async function approveAndExecuteTrade(
  tx: Prisma.TransactionClient,
  trade: TradeWithItems,
  actorUserId: string,
  payload: Record<string, unknown>
) {
  const approvedTrade = await tx.trade.update({
    where: { id: trade.id },
    data: {
      reviewStatus: TradeReviewStatus.APPROVED,
      reviewDecidedAt: new Date(),
    },
  });

  await tx.tradeAudit.create({
    data: {
      tradeId: trade.id,
      event: TradeEvent.TRADE_REVIEW_APPROVED,
      actorUserId,
      payloadJson: payload as Prisma.InputJsonValue,
    },
  });

  return executeTrade(
    tx,
    {
      ...trade,
      reviewStatus: approvedTrade.reviewStatus,
      reviewDecidedAt: approvedTrade.reviewDecidedAt,
    },
    actorUserId
  );
}

async function assertTradeReviewVoter(
  tx: Prisma.TransactionClient,
  trade: TradeWithItems,
  actorUserId: string
) {
  if (actorUserId === trade.proposerUserId || actorUserId === trade.recipientUserId) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_FORBIDDEN,
      'Trade participants cannot vote on league veto reviews.'
    );
  }

  const membership = await tx.leagueMember.findFirst({
    where: {
      leagueId: trade.leagueId,
      userId: actorUserId,
    },
    select: {
      userId: true,
    },
  });

  if (!membership) {
    throw new TradeServiceError(
      TradeErrorCode.TRADE_FORBIDDEN,
      'Only league members can review this trade.'
    );
  }
}

async function computeVetoThreshold(
  tx: Prisma.TransactionClient,
  trade: TradeWithItems
) {
  const memberCount = await tx.leagueMember.count({
    where: { leagueId: trade.leagueId },
  });

  const eligibleVoters = Math.max(memberCount - 2, 1);
  return Math.floor(eligibleVoters / 2) + 1;
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
  acceptedAt?: Date | null;
  executedAt?: Date | null;
  reviewStatus?: TradeReviewStatus | null;
  reviewWindowEndsAt?: Date | null;
}): TradeActionResult {
  return {
    tradeId: trade.id,
    status: trade.status,
    createdAt: trade.createdAt.toISOString(),
    acceptedAt: trade.acceptedAt ? trade.acceptedAt.toISOString() : undefined,
    executedAt: trade.executedAt ? trade.executedAt.toISOString() : undefined,
    reviewStatus: trade.reviewStatus ?? undefined,
    reviewWindowEndsAt: trade.reviewWindowEndsAt
      ? trade.reviewWindowEndsAt.toISOString()
      : undefined,
  };
}
