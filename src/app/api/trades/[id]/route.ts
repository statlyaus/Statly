import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1),
});

type TradeViewReceiptRow = {
  id: string;
  proposerViewedAt: Date | string | null;
  recipientViewedAt: Date | string | null;
};

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

async function loadTradeViewReceipt(tradeId: string): Promise<TradeViewReceiptRow | null> {
  const rows = await prisma.$queryRaw<TradeViewReceiptRow[]>(
    Prisma.sql`
      SELECT "id", "proposerViewedAt", "recipientViewedAt"
      FROM "Trade"
      WHERE "id" = ${tradeId}
      LIMIT 1
    `
  );
  return rows[0] ?? null;
}

async function markTradeViewed(tradeId: string, role: 'proposer' | 'recipient', viewedAt: Date) {
  if (role === 'proposer') {
    await prisma.$executeRaw`
      UPDATE "Trade"
      SET "proposerViewedAt" = ${viewedAt}
      WHERE "id" = ${tradeId}
    `;
    return;
  }

  await prisma.$executeRaw`
    UPDATE "Trade"
    SET "recipientViewedAt" = ${viewedAt}
    WHERE "id" = ${tradeId}
  `;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return commonErrors.unauthorized();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return commonErrors.badRequest('Trade ID is required');
    }
    const { id: tradeId } = parsedParams.data;

    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        items: true,
        reviewVotes: {
          select: {
            voterUserId: true,
            voteType: true,
            createdAt: true,
          },
        },
        audit: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!trade) {
      return commonErrors.notFound('Trade not found');
    }

    if (trade.proposerUserId !== userId && trade.recipientUserId !== userId) {
      return commonErrors.forbidden('Trade access denied');
    }

    const viewedAt = new Date();
    await markTradeViewed(
      tradeId,
      trade.proposerUserId === userId ? 'proposer' : 'recipient',
      viewedAt
    );
    const receipts = await loadTradeViewReceipt(tradeId);
    const latestAudit = trade.audit[trade.audit.length - 1];

    return successResponse({
      tradeId: trade.id,
      proposerUserId: trade.proposerUserId,
      recipientUserId: trade.recipientUserId,
      status: trade.status,
      createdAt: trade.createdAt.toISOString(),
      acceptedAt: trade.acceptedAt ? trade.acceptedAt.toISOString() : undefined,
      executedAt: trade.executedAt ? trade.executedAt.toISOString() : undefined,
      reviewMode: trade.reviewMode,
      reviewStatus: trade.reviewStatus,
      reviewRequestedAt: trade.reviewRequestedAt
        ? trade.reviewRequestedAt.toISOString()
        : undefined,
      reviewWindowEndsAt: trade.reviewWindowEndsAt
        ? trade.reviewWindowEndsAt.toISOString()
        : undefined,
      reviewDecidedAt: trade.reviewDecidedAt
        ? trade.reviewDecidedAt.toISOString()
        : undefined,
      proposerViewedAt: toIso(receipts?.proposerViewedAt),
      recipientViewedAt: toIso(receipts?.recipientViewedAt),
      latestActivityAt: (latestAudit?.createdAt ?? trade.createdAt).toISOString(),
      latestActivityEvent: latestAudit?.event ?? null,
      latestActivityActorUserId: latestAudit?.actorUserId ?? null,
      items: trade.items.map((item) => ({
        playerId: item.playerId,
        fromUserId: item.fromUserId,
        toUserId: item.toUserId,
      })),
      reviewVotes: trade.reviewVotes.map((vote) => ({
        voterUserId: vote.voterUserId,
        voteType: vote.voteType,
        createdAt: vote.createdAt.toISOString(),
      })),
      audit: trade.audit.map((entry) => ({
        event: entry.event,
        actorUserId: entry.actorUserId,
        payloadJson: entry.payloadJson,
        errorCode: entry.errorCode,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('Failed to fetch trade details', error instanceof Error ? error : new Error(String(error)));
    return commonErrors.internalServerError('Server error');
  }
}
