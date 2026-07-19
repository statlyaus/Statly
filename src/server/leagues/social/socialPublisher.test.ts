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
    socialOutboxEvent: {
      findMany: mocks.outboxFindMany,
      updateMany: mocks.outboxUpdateMany,
      update: mocks.outboxUpdate,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: mocks.loggerWarn },
}));

vi.mock('./socialSocket', () => ({
  publishLeagueSocialRealtimeEvent: mocks.publishRealtime,
}));

import { flushSocialOutboxBatch } from './socialPublisher';

describe('league social outbox publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
    mocks.outboxUpdate.mockResolvedValue({});
    mocks.publishRealtime.mockResolvedValue(undefined);
  });

  it('uses authoritative outbox routing while extracting payloads from legacy envelopes', async () => {
    const createdAt = new Date('2026-07-19T10:00:00.000Z');
    mocks.outboxFindMany.mockResolvedValueOnce([{ sequence: 12 }]).mockResolvedValueOnce([
      {
        sequence: 12,
        id: 'outbox-12',
        leagueId: 'league-1',
        seasonId: 'season-1',
        channel: 'ACTIVITY',
        actorUserId: null,
        eventType: 'social:activity',
        aggregateType: 'activity',
        aggregateId: 'message-1',
        payloadJson: JSON.stringify({
          id: 'legacy-id',
          sequence: 2,
          leagueId: 'wrong-league',
          seasonId: 'wrong-season',
          channel: 'chat',
          event: 'social:message',
          payload: {
            id: 'message-1',
            type: 'system',
            content: 'Jordan Example was drafted.',
          },
          occurredAt: '2025-01-01T00:00:00.000Z',
        }),
        status: 'PROCESSING',
        attempts: 1,
        availableAt: createdAt,
        lockedAt: createdAt,
        lockedBy: 'claim',
        publishedAt: null,
        lastError: null,
        createdAt,
      },
    ]);

    await expect(flushSocialOutboxBatch({} as never)).resolves.toBe(1);

    expect(mocks.publishRealtime).toHaveBeenCalledWith(
      {},
      {
        id: 'outbox-12',
        sequence: 12,
        leagueId: 'league-1',
        seasonId: 'season-1',
        channel: 'activity',
        event: 'social:activity',
        payload: {
          id: 'message-1',
          type: 'system',
          content: 'Jordan Example was drafted.',
        },
        occurredAt: createdAt.toISOString(),
      }
    );
  });
});
