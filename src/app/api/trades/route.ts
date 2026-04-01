import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';

import {
  Prisma,
  TradeErrorCode,
  TradeReviewStatus,
  TradeStatus,
} from '@prisma/client';
import { z } from 'zod';

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
}).refine((item) => item.fromUserId !== item.toUserId, {
  message: 'Trade items must move between teams.',
  path: ['toUserId'],
});

const requestIdSchema = z.string().regex(
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|c[0-9a-z]{24})$/i,
  'Invalid requestId'
);

const bodySchema = z.object({
  requestId: requestIdSchema,
  leagueId: z.string().min(1),
  recipientUserId: z.string().min(1),
  roundId: z.string().optional().nullable(),
  parentTradeId: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
}).superRefine((value, ctx) => {
  const playerIds = new Set<string>();
  for (const item of value.items) {
    if (playerIds.has(item.playerId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate playerId in trade items.',
        path: ['items'],
      });
    }
    playerIds.add(item.playerId);
  }

  if (value.recipientUserId === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'recipientUserId is required.',
      path: ['recipientUserId'],
    });
  }
});

function errorStatus(code: TradeErrorCode): number {
  switch (code) {
    case TradeErrorCode.TRADE_NOT_FOUND:
      return 404;
    case TradeErrorCode.TRADE_FORBIDDEN:
      return 403;
    case TradeErrorCode.TRADE_INVALID_PAYLOAD:
      return 400;
    case TradeErrorCode.TRADE_INVALID_TRANSITION:
    case TradeErrorCode.TRADE_PLAYER_LOCKED:
    case TradeErrorCode.TRADE_IDEMPOTENCY_CONFLICT:
    case TradeErrorCode.TRADE_WINDOW_CLOSED:
    case TradeErrorCode.TRADE_LIMIT_REACHED:
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

type TradeViewReceiptRow = {
  id: string;
  proposerViewedAt: Date | string | null;
  recipientViewedAt: Date | string | null;
};

async function loadTradeViewReceiptMap(tradeIds: string[]) {
  if (tradeIds.length === 0) return new Map<string, TradeViewReceiptRow>();
  const rows = await prisma.$queryRaw<TradeViewReceiptRow[]>(
    Prisma.sql`
      SELECT "id", "proposerViewedAt", "recipientViewedAt"
      FROM "Trade"
      WHERE "id" IN (${Prisma.join(tradeIds)})
    `
  );

  return new Map(rows.map((row) => [row.id, row]));
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
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
      include: {
        audit: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            event: true,
            actorUserId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const receiptMap = await loadTradeViewReceiptMap(trades.map((trade) => trade.id));

    const payload = trades.map((trade) => {
      const latestAudit = trade.audit[0];
      const receipt = receiptMap.get(trade.id);
      return {
        tradeId: trade.id,
        proposerUserId: trade.proposerUserId,
        recipientUserId: trade.recipientUserId,
        status: trade.status,
        createdAt: trade.createdAt.toISOString(),
        acceptedAt: trade.acceptedAt ? trade.acceptedAt.toISOString() : undefined,
        executedAt: trade.executedAt ? trade.executedAt.toISOString() : undefined,
        reviewStatus:
          trade.reviewStatus !== TradeReviewStatus.NOT_REQUIRED ? trade.reviewStatus : undefined,
        reviewWindowEndsAt: trade.reviewWindowEndsAt
          ? trade.reviewWindowEndsAt.toISOString()
          : undefined,
        proposerViewedAt: toIso(receipt?.proposerViewedAt),
        recipientViewedAt: toIso(receipt?.recipientViewedAt),
        latestActivityAt: (latestAudit?.createdAt ?? trade.createdAt).toISOString(),
        latestActivityEvent: latestAudit?.event ?? null,
        latestActivityActorUserId: latestAudit?.actorUserId ?? null,
      };
    });

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
