import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import {
  LeagueRole,
  TradeReviewVoteType,
  TradeStatus,
} from '@prisma/client';
import { z } from 'zod';

import { adminAuth } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { tradeService, TradeServiceError } from '@/services/tradeService';

class BadRequestError extends Error {
  constructor(message: string) {
    super(`bad_request:${message}`);
    this.name = 'BadRequestError';
  }
}

const actionSchema = z
  .object({
    action: z
      .enum(['accept', 'veto', 'process', 'adminOverride', 'archive', 'reset'])
      .optional(),
    requestId: z.string().min(1).optional(),
    overrideStatus: z.string().optional(),
  })
  .passthrough();

function getTradeIdOrThrow(url: string, body?: unknown): string {
  const { searchParams } = new URL(url);
  const fromQuery = searchParams.get('tradeId');
  const fromBody =
    typeof body === 'object' && body !== null && 'tradeId' in body
      ? (body as Record<string, unknown>).tradeId
      : undefined;
  const raw = fromQuery ?? (typeof fromBody === 'string' ? fromBody : undefined) ?? '';
  const tradeId = String(raw).trim();
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const safeId = /^[A-Za-z0-9_-]{4,128}$/;
  if (!tradeId || !(uuidV4.test(tradeId) || safeId.test(tradeId))) {
    throw new BadRequestError('Missing or invalid tradeId');
  }
  return tradeId;
}

async function getAdminRole(userId: string) {
  try {
    const user = await adminAuth.getUser(userId);
    const roles = (user.customClaims?.roles as string[]) || [];
    return user.customClaims?.admin === true || roles.includes('admin');
  } catch (error) {
    logger.warn('Failed to check user roles', { userId, error });
    return false;
  }
}

async function loadTradeReviewContext(tradeId: string) {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      reviewVotes: {
        orderBy: { createdAt: 'asc' },
      },
      audit: {
        orderBy: { createdAt: 'asc' },
      },
      league: {
        include: {
          members: {
            select: {
              userId: true,
              role: true,
            },
          },
        },
      },
    },
  });

  if (!trade) {
    throw new BadRequestError('Trade not found');
  }

  return trade;
}

function isLeagueMember(
  trade: Awaited<ReturnType<typeof loadTradeReviewContext>>,
  userId: string
) {
  return trade.league.members.some((member) => member.userId === userId);
}

function isCommissioner(
  trade: Awaited<ReturnType<typeof loadTradeReviewContext>>,
  userId: string
) {
  return trade.league.members.some(
    (member) =>
      member.userId === userId &&
      (member.role === LeagueRole.OWNER || member.role === LeagueRole.COMMISSIONER)
  );
}

function assertTradeViewerAccess(
  trade: Awaited<ReturnType<typeof loadTradeReviewContext>>,
  userId: string,
  isAdmin: boolean
) {
  if (isAdmin) return;
  if (
    trade.proposerUserId !== userId &&
    trade.recipientUserId !== userId &&
    !isLeagueMember(trade, userId)
  ) {
    throw new Error('forbidden');
  }
}

function assertCommissionerAccess(
  trade: Awaited<ReturnType<typeof loadTradeReviewContext>>,
  userId: string,
  isAdmin: boolean
) {
  if (isAdmin) return;
  if (!isCommissioner(trade, userId)) {
    throw new Error('forbidden');
  }
}

function buildNotifications(trade: Awaited<ReturnType<typeof loadTradeReviewContext>>) {
  return trade.audit
    .slice(-10)
    .map((entry) => `${entry.event} • ${entry.createdAt.toISOString()}`);
}

function buildReviewState(trade: Awaited<ReturnType<typeof loadTradeReviewContext>>) {
  const vetoCount = trade.reviewVotes.filter(
    (vote) => vote.voteType === TradeReviewVoteType.VETO
  ).length;

  const status =
    trade.status === TradeStatus.PROPOSED
      ? 'offered'
      : trade.status === TradeStatus.REVIEW_PENDING
        ? 'underReview'
        : trade.status === TradeStatus.EXECUTED
          ? 'processed'
          : 'vetoed';

  return {
    status,
    tradeStatus: trade.status,
    reviewMode: trade.reviewMode,
    reviewStatus: trade.reviewStatus,
    vetoCount,
    reviewWindowExpiresAt: trade.reviewWindowEndsAt?.getTime(),
    acceptedAt: trade.acceptedAt?.toISOString(),
    executedAt: trade.executedAt?.toISOString(),
    reviewRequestedAt: trade.reviewRequestedAt?.toISOString(),
    reviewDecidedAt: trade.reviewDecidedAt?.toISOString(),
    votes: trade.reviewVotes.map((vote) => ({
      voterUserId: vote.voterUserId,
      voteType: vote.voteType,
      createdAt: vote.createdAt.toISOString(),
    })),
  };
}

function errorResponse(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const tradeId = getTradeIdOrThrow(request.url);
    const userId = await getAuthenticatedUserId(request as NextRequest);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const isAdmin = await getAdminRole(userId);
    const trade = await loadTradeReviewContext(tradeId);
    assertTradeViewerAccess(trade, userId, isAdmin);

    return NextResponse.json(
      {
        success: true,
        data: {
          state: buildReviewState(trade),
          auditLog: trade.audit.map((entry) => ({
            event: entry.event,
            actorUserId: entry.actorUserId,
            createdAt: entry.createdAt.toISOString(),
            payloadJson: entry.payloadJson,
            errorCode: entry.errorCode,
          })),
          notifications: buildNotifications(trade),
        },
      },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=30' } }
    );
  } catch (error) {
    if (error instanceof BadRequestError) {
      return errorResponse(400, 'Failed to get trade review');
    }
    if (error instanceof Error && error.message === 'forbidden') {
      return errorResponse(403, 'Forbidden');
    }
    logger.error(
      'Failed to get trade review',
      error instanceof Error ? error : new Error(String(error))
    );
    return errorResponse(500, 'Failed to get trade review');
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return errorResponse(400, 'Bad Request: expected application/json');
    }

    const parsedBody = actionSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return errorResponse(400, 'Bad Request: invalid payload');
    }

    const body = parsedBody.data;
    const tradeId = getTradeIdOrThrow(request.url, body);
    const userId = await getAuthenticatedUserId(request as NextRequest);
    if (!userId) {
      return errorResponse(401, 'Unauthorized');
    }

    const isAdmin = await getAdminRole(userId);
    const trade = await loadTradeReviewContext(tradeId);
    assertTradeViewerAccess(trade, userId, isAdmin);

    const requestId = body.requestId ?? `review:${tradeId}:${body.action ?? 'read'}:${userId}`;

    if (body.action === 'accept') {
      if (trade.status === TradeStatus.PROPOSED) {
        if (trade.recipientUserId !== userId && !isAdmin) {
          return errorResponse(403, 'Forbidden');
        }
        await tradeService.acceptTrade({ requestId, tradeId, actorUserId: userId });
      } else {
        assertCommissionerAccess(trade, userId, isAdmin);
        await tradeService.approveTradeReview({ requestId, tradeId, actorUserId: userId });
      }
    } else if (body.action === 'veto') {
      await tradeService.castTradeReviewVote({
        requestId,
        tradeId,
        actorUserId: userId,
        voteType: TradeReviewVoteType.VETO,
      });
    } else if (body.action === 'process') {
      assertCommissionerAccess(trade, userId, isAdmin);
      await tradeService.finalizeTradeReview({ requestId, tradeId, actorUserId: userId });
    } else if (body.action === 'adminOverride') {
      assertCommissionerAccess(trade, userId, isAdmin);
      if (body.overrideStatus === 'processed' || body.overrideStatus === 'EXECUTED') {
        await tradeService.approveTradeReview({ requestId, tradeId, actorUserId: userId });
      } else {
        await tradeService.rejectTradeReview({ requestId, tradeId, actorUserId: userId });
      }
    } else if (body.action === 'archive' || body.action === 'reset') {
      assertCommissionerAccess(trade, userId, isAdmin);
      await tradeService.rejectTradeReview({ requestId, tradeId, actorUserId: userId });
    }

    const refreshedTrade = await loadTradeReviewContext(tradeId);

    return NextResponse.json(
      {
        success: true,
        data: {
          state: buildReviewState(refreshedTrade),
          auditLog: refreshedTrade.audit.map((entry) => ({
            event: entry.event,
            actorUserId: entry.actorUserId,
            createdAt: entry.createdAt.toISOString(),
            payloadJson: entry.payloadJson,
            errorCode: entry.errorCode,
          })),
          notifications: buildNotifications(refreshedTrade),
        },
      },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=30' } }
    );
  } catch (error) {
    if (error instanceof TradeServiceError) {
      const status =
        error.code === 'TRADE_FORBIDDEN'
          ? 403
          : error.code === 'TRADE_NOT_FOUND'
            ? 404
            : error.code === 'TRADE_INVALID_PAYLOAD'
              ? 400
              : error.code === 'TRADE_PLAYER_NOT_OWNED' ||
                  error.code === 'TRADE_ROSTER_INVALID'
                ? 422
                : 409;
      return errorResponse(status, error.message);
    }
    if (error instanceof BadRequestError) {
      return errorResponse(400, 'Failed to update trade review');
    }
    if (error instanceof Error && error.message === 'forbidden') {
      return errorResponse(403, 'Forbidden');
    }
    logger.error(
      'Failed to update trade review',
      error instanceof Error ? error : new Error(String(error))
    );
    return errorResponse(500, 'Failed to update trade review');
  }
}
