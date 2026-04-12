import { TradeReviewMode, TradeStatus } from '@prisma/client';
import { cron } from 'inngest';

import { logger } from '@/lib/logger';
import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { tradeService } from '@/services/tradeService';

/**
 * Finalizes league veto trades whose review window has ended (no user click required).
 * Actor is the league owner for audit trails (automated job).
 */
export async function runTradeVetoWindowSweep(): Promise<{
  examined: number;
  finalized: number;
  errors: number;
}> {
  const now = new Date();
  const pending = await prisma.trade.findMany({
    where: {
      status: TradeStatus.REVIEW_PENDING,
      reviewMode: TradeReviewMode.VETO,
      reviewWindowEndsAt: { not: null, lte: now },
    },
    select: {
      id: true,
      league: { select: { ownerId: true } },
    },
  });

  let finalized = 0;
  let errors = 0;

  for (const row of pending) {
    const requestId = `inngest-veto-finalize:${row.id}:${row.league.ownerId}`;
    try {
      const result = await tradeService.finalizeTradeReview({
        tradeId: row.id,
        requestId,
        actorUserId: row.league.ownerId,
      });
      if (result.status === TradeStatus.EXECUTED || result.status === TradeStatus.REVIEW_REJECTED) {
        finalized += 1;
      }
    } catch (error) {
      errors += 1;
      logger.warn('tradeVetoWindowSweep: finalize failed', {
        tradeId: row.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (pending.length > 0) {
    logger.info('tradeVetoWindowSweep completed', {
      examined: pending.length,
      finalized,
      errors,
    });
  }

  return { examined: pending.length, finalized, errors };
}

export const tradeVetoWindowSweepFunction = inngest.createFunction(
  {
    id: 'trade-veto-window-sweep',
    name: 'Trade veto window sweep',
    triggers: [cron('TZ=UTC */15 * * * *')],
  },
  async ({ step }) => step.run('finalize-eligible-veto-trades', () => runTradeVetoWindowSweep())
);
