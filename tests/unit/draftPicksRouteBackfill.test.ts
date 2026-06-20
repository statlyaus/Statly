import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  pick: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  draft: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMocks,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET } from '@/app/api/drafts/[id]/picks/route';

function request(path: string) {
  return new Request(`https://statly.test${path}`) as NextRequest;
}

describe('draft picks route backfill freshness', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    prismaMocks.pick.findFirst.mockResolvedValue({
      madeAt: new Date('2026-06-20T01:00:05.000Z'),
    });
    prismaMocks.draft.findUnique.mockResolvedValue({
      createdAt: new Date('2026-06-20T00:55:00.000Z'),
      startedAt: new Date('2026-06-20T01:00:00.000Z'),
      completedAt: null,
      currentPick: 2,
      status: 'LIVE',
      round: 1,
      direction: 'FORWARD',
      pickStartedAt: new Date('2026-06-20T01:00:05.000Z'),
      pickDeadlineAt: new Date('2026-06-20T01:01:05.000Z'),
      schedulingVersion: 2,
    });
    prismaMocks.pick.findMany.mockResolvedValue([]);
    prismaMocks.pick.count.mockResolvedValue(0);
  });

  it('returns draft state when the since cursor matches the latest persisted pick timestamp', async () => {
    const response = await GET(
      request(
        '/api/drafts/cmq29ngg50004ux5s39ya2azu/picks?since=2026-06-20T01%3A00%3A05.000Z&pageSize=100'
      ),
      { params: Promise.resolve({ id: 'cmq29ngg50004ux5s39ya2azu' }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data.picks).toEqual([]);
    expect(body.data.draftState).toMatchObject({
      currentPick: 2,
      status: 'LIVE',
      pickStartedAt: '2026-06-20T01:00:05.000Z',
      pickDeadlineAt: '2026-06-20T01:01:05.000Z',
      schedulingVersion: 2,
    });
  });
});
