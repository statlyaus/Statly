import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';

const paramsSchema = z.object({
  id: z.string().min(1),
});

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
        audit: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!trade) {
      return commonErrors.notFound('Trade not found');
    }

    if (trade.proposerUserId !== userId && trade.recipientUserId !== userId) {
      return commonErrors.forbidden('Trade access denied');
    }

    return successResponse({
      tradeId: trade.id,
      proposerUserId: trade.proposerUserId,
      recipientUserId: trade.recipientUserId,
      status: trade.status,
      createdAt: trade.createdAt.toISOString(),
      executedAt: trade.executedAt ? trade.executedAt.toISOString() : undefined,
      items: trade.items.map((item) => ({
        playerId: item.playerId,
        fromUserId: item.fromUserId,
        toUserId: item.toUserId,
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
