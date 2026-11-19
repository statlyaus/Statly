import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  socialOutboxEvent: { count: vi.fn(), deleteMany: vi.fn() },
  leagueTradeOutboxEvent: { count: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
const logger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

import { OUTBOX_MAX_ATTEMPTS, OUTBOX_RETENTION_DAYS, pruneOutboxes } from './outboxRetention';

const now = new Date('2026-11-18T23:00:00Z');
const cutoff = new Date(now.getTime() - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
const dead = { attempts: { gte: OUTBOX_MAX_ATTEMPTS }, status: { not: 'PUBLISHED' } };

describe('daily outbox clean-up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.socialOutboxEvent.count.mockResolvedValue(0);
    prisma.leagueTradeOutboxEvent.count.mockResolvedValue(0);
    prisma.socialOutboxEvent.deleteMany.mockResolvedValue({ count: 3 });
    prisma.leagueTradeOutboxEvent.deleteMany.mockResolvedValue({ count: 5 });
  });

  it('deletes every trade row past the retention window and keeps social rows', async () => {
    const result = await pruneOutboxes(now);

    // Social rows also back unread counts and read positions.
    expect(prisma.socialOutboxEvent.deleteMany).not.toHaveBeenCalled();
    // Nothing drains the trade outbox on Netlify, so unsent rows are pruned too.
    expect(prisma.leagueTradeOutboxEvent.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
    });
    expect(result).toMatchObject({ tradeDeleted: 5 });
  });

  it('alerts on rows that reached the retry limit, before deleting', async () => {
    prisma.socialOutboxEvent.count.mockResolvedValue(2);
    prisma.leagueTradeOutboxEvent.count.mockResolvedValue(1);

    const result = await pruneOutboxes(now);

    expect(prisma.socialOutboxEvent.count).toHaveBeenCalledWith({ where: dead });
    expect(prisma.leagueTradeOutboxEvent.count).toHaveBeenCalledWith({ where: dead });
    expect(logger.error).toHaveBeenCalledWith(
      'Outbox rows reached the retry limit: 2 social, 1 trade',
      undefined,
      { deadSocial: 2, deadTrade: 1 }
    );
    expect(result).toMatchObject({ deadSocial: 2, deadTrade: 1 });
  });

  it('does not alert when no row is at the retry limit', async () => {
    await pruneOutboxes(now);

    expect(logger.error).not.toHaveBeenCalled();
  });
});
