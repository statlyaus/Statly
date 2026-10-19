import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  leagueTradeThread: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  invalidateConflictingTrades,
  processDueLeagueTrades,
} from '@/server/leagues/trades/tradeService';

describe('processDueLeagueTrades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps processing due threads after one thread fails unexpectedly', async () => {
    prismaMocks.leagueTradeThread.findMany.mockResolvedValue([
      { id: 'thread-a', status: 'OPEN', version: 1 },
      { id: 'thread-c', status: 'OPEN', version: 1 },
    ]);
    const tx = { leagueTradeThread: { findFirst: vi.fn().mockResolvedValue(null) } };
    prismaMocks.$transaction
      .mockRejectedValueOnce(new Error('unique constraint failed'))
      .mockImplementationOnce(async (work: (client: typeof tx) => unknown) => work(tx));

    await expect(processDueLeagueTrades(new Date('2026-10-14T00:00:00Z'))).rejects.toThrow(
      '1 due league trade(s) failed to process'
    );

    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.leagueTradeThread.findFirst).toHaveBeenCalledOnce();
  });
});

describe('invalidateConflictingTrades', () => {
  it('clears the review window and writes an outbox row for each invalidated conflict', async () => {
    const tx = {
      leagueTradeThread: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'thread-b', currentOfferId: 'offer-b', status: 'PENDING_VETO_REVIEW' },
          ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leagueTradeOffer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      leagueTradeEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      leagueTradeOutboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const completedThread = {
      id: 'thread-a',
      leagueId: 'league-1',
      seasonId: 'season-1',
    };

    await invalidateConflictingTrades(
      tx as never,
      completedThread as never,
      ['player-1'],
      new Date('2026-10-14T00:00:00Z')
    );

    expect(tx.leagueTradeThread.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['thread-b'] } },
      data: expect.objectContaining({ status: 'INVALIDATED', reviewEndsAt: null }),
    });
    expect(tx.leagueTradeOutboxEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          leagueId: 'league-1',
          seasonId: 'season-1',
          threadId: 'thread-b',
          offerId: 'offer-b',
          eventType: 'trade:invalidated',
          payloadJson: JSON.stringify({
            threadId: 'thread-b',
            offerId: 'offer-b',
            status: 'INVALIDATED',
          }),
        },
      ],
    });
  });
});
