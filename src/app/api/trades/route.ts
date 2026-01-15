import { revalidateTag } from 'next/cache';

import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { TradeErrorCode, TradeStatus } from '@prisma/client';

import { commonErrors, errorResponse, successResponse } from '@/lib/apiResponse';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { tradeService, TradeServiceError } from '@/services/tradeService';

export const runtime = 'nodejs';

const itemSchema = z.object({
  playerId: z.string().min(1),
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
});

const bodySchema = z.object({
  requestId: z.string().min(1),
  leagueId: z.string().min(1),
  recipientUserId: z.string().min(1),
  roundId: z.string().optional().nullable(),
  parentTradeId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

function errorStatus(code: TradeErrorCode): number {
  switch (code) {
    case TradeErrorCode.TRADE_NOT_FOUND:
      return 404;
    case TradeErrorCode.TRADE_FORBIDDEN:
      return 403;
    case TradeErrorCode.TRADE_INVALID_TRANSITION:
    case TradeErrorCode.TRADE_PLAYER_LOCKED:
    case TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT:
    case TradeErrorCode.TRADE_WINDOW_CLOSED:
      return 409;
    case TradeErrorCode.TRADE_PLAYER_NOT_OWNED:
    case TradeErrorCode.TRADE_ROSTER_INVALID:
      return 422;
    default:
      return 400;
  }
}

function handleTradeError(error: unknown) {
  if (error instanceof TradeServiceError) {
    return errorResponse(
      error.message,
      errorStatus(error.code),
      error.code,
      error.context ?? {}
    );
  }
  return commonErrors.internalServerError(
    error instanceof Error ? error.message : 'Server error'
  );
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return commonErrors.unauthorized();
    }

    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId') || undefined;
    const statusRaw = searchParams.get('status') || undefined;
    const status =
      statusRaw && Object.values(TradeStatus).includes(statusRaw as TradeStatus)
        ? (statusRaw as TradeStatus)
        : undefined;

    const trades = await prisma.trade.findMany({
      where: {
        ...(leagueId ? { leagueId } : {}),
        ...(status ? { status } : {}),
        OR: [{ proposerUserId: userId }, { recipientUserId: userId }],
      },
      orderBy: { createdAt: 'desc' },
    });

    const payload = trades.map((trade) => ({
      tradeId: trade.id,
      proposerUserId: trade.proposerUserId,
      recipientUserId: trade.recipientUserId,
      status: trade.status,
      createdAt: trade.createdAt.toISOString(),
      executedAt: trade.executedAt ? trade.executedAt.toISOString() : undefined,
    }));

    return successResponse({ trades: payload });
  } catch (err) {
    logger.error('Error listing trades', err instanceof Error ? err : new Error(String(err)));
    return commonErrors.internalServerError('Server error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return commonErrors.unauthorized();
    }

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid payload', {
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const payload = parsed.data;
    const result = await tradeService.proposeTrade({
      requestId: payload.requestId,
      leagueId: payload.leagueId,
      roundId: payload.roundId ?? null,
      proposerUserId: userId,
      recipientUserId: payload.recipientUserId,
      parentTradeId: payload.parentTradeId ?? null,
      note: payload.note ?? null,
      items: payload.items,
    });

    try {
      const results = await Promise.allSettled([
        revalidateTag(tags.trades(payload.leagueId)),
        revalidateTag(tags.league(payload.leagueId)),
      ]);
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed) {
        logger.warn('Trades revalidation failed', { leagueId: payload.leagueId, failed });
      }
    } catch (e) {
      logger.warn('Trades revalidation error', { leagueId: payload.leagueId, error: e });
    }

    return successResponse(result);
  } catch (err) {
    if (err instanceof TradeServiceError) {
      return handleTradeError(err);
    }
    logger.error('Error processing trade offer', err instanceof Error ? err : new Error(String(err)));
    return commonErrors.internalServerError('Server error');
  }
}
