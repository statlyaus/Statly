import { describe, it, expect, beforeEach, vi } from 'vitest';
import { draftRoomStore } from '@/server/roomStore';
import * as redis from '@/lib/redis';

describe('DraftRoomStore (in-memory fallback)', () => {
  // Force redisClient.getClient() to return null using a typed spy
  beforeEach(() => {
    vi.spyOn(redis.redisClient, 'getClient').mockReturnValue(null as any);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves and retrieves room state', async () => {
    const state = await draftRoomStore.initRoomIfMissing('draftA');
    expect(state.id).toBe('draftA');
    await draftRoomStore.saveRoom({ ...state, currentPick: 3 });
    const read = await draftRoomStore.getRoom('draftA');
    expect(read?.currentPick).toBe(3);
  });

  it('manages participants counts', async () => {
    await draftRoomStore.initRoomIfMissing('draftB');
    const c1 = await draftRoomStore.addParticipant('draftB', 's1');
    expect(c1).toBe(1);
    const c2 = await draftRoomStore.addParticipant('draftB', 's2');
    expect(c2).toBe(2);
    const c3 = await draftRoomStore.removeParticipant('draftB', 's1');
    expect(c3).toBe(1);
  });

  it('adds participants only while capacity is available', async () => {
    await draftRoomStore.initRoomIfMissing('draft-limit');

    await expect(
      draftRoomStore.addParticipantIfUnderLimit('draft-limit', 's1', 1)
    ).resolves.toEqual({ accepted: true, count: 1 });
    await expect(
      draftRoomStore.addParticipantIfUnderLimit('draft-limit', 's1', 1)
    ).resolves.toEqual({ accepted: true, count: 1 });
    await expect(
      draftRoomStore.addParticipantIfUnderLimit('draft-limit', 's2', 1)
    ).resolves.toEqual({ accepted: false, count: 1 });
    await expect(draftRoomStore.getParticipantCount('draft-limit')).resolves.toBe(1);
  });

  it('handles invalid or empty room IDs', async () => {
    await expect(draftRoomStore.getRoom('')).resolves.toBeNull();
    await expect(draftRoomStore.getRoom('unknown-room')).resolves.toBeNull();
    await expect(draftRoomStore.saveRoom as any).not.toThrow;
  });

  it('resolves concurrent modifications with last-write-wins', async () => {
    vi.useFakeTimers();

    try {
      const room = await draftRoomStore.initRoomIfMissing('concurrent');
      const a = { ...room, currentPick: 2 };
      const b = { ...room, currentPick: 3 };

      // Start both operations
      const promiseA = draftRoomStore.saveRoom(a);
      const promiseB = draftRoomStore.saveRoom(b);

      // Advance timers to trigger any delayed operations deterministically
      await vi.advanceTimersByTimeAsync(10);

      // Wait for both operations to complete
      await Promise.all([promiseA, promiseB]);

      const read = await draftRoomStore.getRoom('concurrent');
      expect(read?.currentPick).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles many rooms without crashing (memory load)', async () => {
    const N = 200;
    for (let i = 0; i < N; i++) {
      const id = `room-${i}`;
      const s = await draftRoomStore.initRoomIfMissing(id);
      await draftRoomStore.saveRoom({ ...s, currentPick: (i % 5) + 1 });
    }
    // No explicit eviction in in-memory fallback; ensure count is >= N
    const count = await draftRoomStore.getRoomsCount();
    expect(count).toBeGreaterThanOrEqual(N);
  });
});
