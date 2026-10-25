import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  outboxFindMany: vi.fn(),
  outboxUpdateMany: vi.fn(),
  outboxUpdate: vi.fn(),
  publishRealtime: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTradeOutboxEvent: {
      findMany: mocks.outboxFindMany,
      updateMany: mocks.outboxUpdateMany,
      update: mocks.outboxUpdate,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: mocks.loggerWarn },
}));

vi.mock('@/server/leagues/social/socialSocket', () => ({
  publishLeagueSocialRealtimeEvent: mocks.publishRealtime,
}));

import { flushTradeOutboxBatch } from './tradePublisher';

const createdAt = new Date('2026-10-25T09:00:00.000Z');

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    sequence: 7,
    id: 'trade-outbox-7',
    leagueId: 'league-1',
    seasonId: 'season-1',
    threadId: 'thread-1',
    offerId: 'offer-1',
    eventType: 'trade:proposed',
    payloadJson: JSON.stringify({ threadId: 'thread-1', offerId: 'offer-1', status: 'PENDING' }),
    status: 'PROCESSING',
    attempts: 1,
    availableAt: createdAt,
    lockedAt: createdAt,
    lockedBy: 'claim',
    publishedAt: null,
    lastError: null,
    createdAt,
    ...overrides,
  };
}

describe('league trade outbox publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.outboxUpdate.mockResolvedValue({});
    mocks.publishRealtime.mockResolvedValue(undefined);
  });

  it('does nothing when no trade event is due', async () => {
    mocks.outboxFindMany.mockResolvedValueOnce([]);

    await expect(flushTradeOutboxBatch({} as never)).resolves.toBe(0);

    expect(mocks.outboxUpdateMany).not.toHaveBeenCalled();
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
  });

  it('publishes a claimed row as a league-scoped trade:update and marks it published', async () => {
    mocks.outboxFindMany.mockResolvedValueOnce([{ sequence: 7 }]).mockResolvedValueOnce([outboxRow()]);

    await expect(flushTradeOutboxBatch({} as never)).resolves.toBe(1);

    expect(mocks.publishRealtime).toHaveBeenCalledWith(
      {},
      {
        id: 'trade-outbox-7',
        sequence: 7,
        leagueId: 'league-1',
        seasonId: 'season-1',
        channel: 'activity',
        event: 'trade:update',
        payload: {
          threadId: 'thread-1',
          offerId: 'offer-1',
          eventType: 'trade:proposed',
          status: 'PENDING',
        },
        occurredAt: createdAt.toISOString(),
      }
    );
    expect(mocks.outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sequence: 7 },
        data: expect.objectContaining({ status: 'PUBLISHED', lockedBy: null, lastError: null }),
      })
    );
  });

  it('marks a failed delivery for retry with backoff instead of dropping it', async () => {
    mocks.outboxFindMany
      .mockResolvedValueOnce([{ sequence: 7 }])
      .mockResolvedValueOnce([outboxRow({ attempts: 3 })]);
    mocks.publishRealtime.mockRejectedValueOnce(new Error('redis down'));

    await expect(flushTradeOutboxBatch({} as never)).resolves.toBe(0);

    expect(mocks.outboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sequence: 7 },
        data: expect.objectContaining({ status: 'FAILED', lastError: 'redis down' }),
      })
    );
    const data = mocks.outboxUpdate.mock.calls[0][0].data as { availableAt: Date };
    expect(data.availableAt.getTime()).toBeGreaterThan(Date.now() + 7_000);
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });
});
