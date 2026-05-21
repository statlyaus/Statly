import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DraftRealtimeDelta } from '@/server/draft/domain/draftTypes';

const { getRedisMock, redisMock } = vi.hoisted(() => {
  const redis = {
    zAdd: vi.fn(),
    zRemRangeByRank: vi.fn(),
    expire: vi.fn(),
    zRangeByScore: vi.fn(),
  };
  return {
    redisMock: redis,
    getRedisMock: vi.fn(() => Promise.resolve(redis)),
  };
});

vi.mock('@/server/redis', () => ({
  getRedis: getRedisMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import { appendDraftDelta, getDraftDeltasSince } from './draftDeltaLog';

function delta(overrides: Partial<DraftRealtimeDelta> = {}): DraftRealtimeDelta {
  return {
    type: 'PICK_MADE',
    eventId: 'draft-1:pick:1:player-1',
    payload: { pick: { overall: 1 } },
    ts: 1000,
    ...overrides,
  } as DraftRealtimeDelta;
}

describe('draftDeltaLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisMock.mockResolvedValue(redisMock);
  });

  it('appends deltas using timestamp scores and caps the retained log', async () => {
    await appendDraftDelta('draft-1', delta());

    expect(redisMock.zAdd).toHaveBeenCalledWith('draft:draft-1:events', {
      score: 1000,
      value: JSON.stringify(delta()),
    });
    expect(redisMock.zRemRangeByRank).toHaveBeenCalledWith('draft:draft-1:events', 0, -501);
    expect(redisMock.expire).toHaveBeenCalledWith('draft:draft-1:events', 3600);
  });

  it('returns only parseable deltas after the requested timestamp', async () => {
    redisMock.zRangeByScore.mockResolvedValue([
      JSON.stringify(delta({ eventId: 'draft-1:pick:2:player-2', ts: 1002 })),
      'not-json',
    ]);

    const result = await getDraftDeltasSince('draft-1', 1000);

    expect(redisMock.zRangeByScore).toHaveBeenCalledWith('draft:draft-1:events', 1001, '+inf');
    expect(result).toEqual([delta({ eventId: 'draft-1:pick:2:player-2', ts: 1002 })]);
  });
});
