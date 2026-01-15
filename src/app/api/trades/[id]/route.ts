import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return commonErrors.unauthorized();
    }

    const { id: tradeId } = await params;
    if (!tradeId) {
      return commonErrors.badRequest('Trade ID is required');
    }

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
    return commonErrors.internalServerError(
      error instanceof Error ? error.message : 'Server error'
    );
  }
}
