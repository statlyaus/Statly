import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/** How long outbox rows are kept after they are written. */
export const OUTBOX_RETENTION_DAYS = 7;
/** The publishers stop retrying a row after this many attempts (tradePublisher, socialPublisher). */
export const OUTBOX_MAX_ATTEMPTS = 8;

export interface OutboxPruneResult {
  tradeDeleted: number;
  deadSocial: number;
  deadTrade: number;
}

/**
 * Daily clean-up of the outboxes. Rows of either outbox at the retry limit are reported as an error
 * (it reaches Sentry). Trade rows older than the retention window are deleted whatever their status:
 * nothing reads a trade row once announced, and on Netlify no process drains the trade outbox.
 * Social rows are kept: they are also the source of unread counts, each channel's latest sequence
 * and read positions (socialQueries.ts, socialCommands.ts), so deleting them would change chat.
 */
export async function pruneOutboxes(now = new Date()): Promise<OutboxPruneResult> {
  const cutoff = new Date(now.getTime() - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const dead = {
    attempts: { gte: OUTBOX_MAX_ATTEMPTS },
    status: { not: 'PUBLISHED' as const },
  };

  const [deadSocial, deadTrade] = await Promise.all([
    prisma.socialOutboxEvent.count({ where: dead }),
    prisma.leagueTradeOutboxEvent.count({ where: dead }),
  ]);
  if (deadSocial + deadTrade > 0) {
    logger.error(
      `Outbox rows reached the retry limit: ${deadSocial} social, ${deadTrade} trade`,
      undefined,
      { deadSocial, deadTrade }
    );
  }

  const trade = await prisma.leagueTradeOutboxEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return { tradeDeleted: trade.count, deadSocial, deadTrade };
}
