import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';

import { TradeErrorCode } from '@prisma/client';
import { z } from 'zod';

import { commonErrors, errorResponse, successResponse } from '@/lib/apiResponse';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { tradeService, TradeServiceError } from '@/services/tradeService';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1),
  action: z.enum([
    'accept',
    'decline',
    'cancel',
    'approve-review',
    'reject-review',
    'finalize-review',
  ]),
});

const bodySchema = z.object({
  requestId: z.string().min(1),
});

function errorStatus(code: TradeErrorCode): number {
  switch (code) {
    case 'TRADE_NOT_FOUND':
      return 404;
    case 'TRADE_FORBIDDEN':
      return 403;
    case 'TRADE_INVALID_PAYLOAD':
      return 400;
    case 'TRADE_INVALID_TRANSITION':
    case 'TRADE_PLAYER_LOCKED':
    case 'TRADE_IDEMPOTENCY_CONFLICT':
    case 'TRADE_WINDOW_CLOSED':
    case 'TRADE_LIMIT_REACHED':
      return 409;
    case 'TRADE_PLAYER_NOT_OWNED':
    case 'TRADE_ROSTER_INVALID':
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  try {
    const actorUserId = await getAuthenticatedUserId(request);
    if (!actorUserId) {
      return commonErrors.unauthorized();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return commonErrors.badRequest('Invalid trade action');
    }

    const parsedBody = bodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return commonErrors.badRequest('Request ID is required');
    }

    const { id: tradeId, action } = parsedParams.data;
    const tradeMeta = await prisma.trade.findUnique({
      where: { id: tradeId },
      select: { leagueId: true },
    });

    const payload = {
      requestId: parsedBody.data.requestId,
      tradeId,
      actorUserId,
    };

    const result =
      action === 'accept'
        ? await tradeService.acceptTrade(payload)
        : action === 'decline'
          ? await tradeService.declineTrade(payload)
          : action === 'cancel'
            ? await tradeService.cancelTrade(payload)
            : action === 'approve-review'
              ? await tradeService.approveTradeReview(payload)
              : action === 'reject-review'
                ? await tradeService.rejectTradeReview(payload)
                : await tradeService.finalizeTradeReview(payload);

    if (tradeMeta?.leagueId) {
      try {
        const results = await Promise.allSettled([
          revalidateTag(tags.trades(tradeMeta.leagueId)),
          revalidateTag(tags.league(tradeMeta.leagueId)),
        ]);
        const failed = results.filter((entry) => entry.status === 'rejected').length;
        if (failed) {
          logger.warn('Trade action revalidation failed', {
            tradeId,
            action,
            leagueId: tradeMeta.leagueId,
            failed,
          });
        }
      } catch (error) {
        logger.warn('Trade action revalidation error', {
          tradeId,
          action,
          leagueId: tradeMeta.leagueId,
          error,
        });
      }
    }

    return successResponse(result);
  } catch (error) {
    if (error instanceof TradeServiceError) {
      return handleTradeError(error);
    }
    logger.error('Failed to process trade action', error instanceof Error ? error : new Error(String(error)));
    return commonErrors.internalServerError('Server error');
  }
}
