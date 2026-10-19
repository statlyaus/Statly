import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  socialMessage: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/server/leagues/social/socialSystemEvents', () => ({
  publishLeagueSystemMessage: vi.fn(),
}));

import {
  encodeWaiverActivityCursor,
  loadWaiverOutcomes,
  parseWaiverActivityCursor,
} from '@/server/waivers/waiverActivity';

describe('waiver activity cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.league.findUnique.mockResolvedValue({ activeSeasonId: 'season-1' });
    prismaMocks.socialMessage.findMany.mockResolvedValue([]);
  });

  it('pages rows that share the cursor timestamp by id', async () => {
    const before = new Date('2026-10-05T05:00:00.000Z');

    await loadWaiverOutcomes('league-1', { limit: 2, before, beforeId: 'message-b' });

    const where = prismaMocks.socialMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { createdAt: { lt: before } },
      { createdAt: before, id: { lt: 'message-b' } },
    ]);
  });

  it('pages by timestamp alone when a cursor has no id', async () => {
    const before = new Date('2026-10-05T05:00:00.000Z');

    await loadWaiverOutcomes('league-1', { limit: 2, before });

    const where = prismaMocks.socialMessage.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.createdAt).toEqual({ lt: before });
  });

  it('round-trips the timestamp and id through the cursor', () => {
    const cursor = encodeWaiverActivityCursor({
      id: 'message-b',
      timestamp: '2026-10-05T05:00:00.000Z',
    });

    expect(parseWaiverActivityCursor(cursor)).toEqual({
      before: new Date('2026-10-05T05:00:00.000Z'),
      beforeId: 'message-b',
    });
  });

  it('still reads a bare timestamp cursor and rejects an invalid one', () => {
    expect(parseWaiverActivityCursor('2026-10-05T05:00:00.000Z')).toEqual({
      before: new Date('2026-10-05T05:00:00.000Z'),
    });
    expect(parseWaiverActivityCursor('not-a-date')).toBeNull();
  });
});
