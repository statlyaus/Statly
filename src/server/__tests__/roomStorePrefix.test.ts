import { afterEach, describe, expect, it, vi } from 'vitest';

import * as redis from '@/lib/redis';
import { draftRoomStore } from '@/server/roomStore';

describe('DraftRoomStore key prefix', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('keys participant data and ready state under REDIS_ROOM_PREFIX', async () => {
    vi.stubEnv('REDIS_ROOM_PREFIX', 'stage');
    const client = {
      hset: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };
    vi.spyOn(redis.redisClient, 'getClient').mockReturnValue(client as never);

    await draftRoomStore.setParticipantData('draft-1', 'socket-1', { name: 'A' });
    await draftRoomStore.setReady('draft-1', 'member-1', true);

    expect(client.hset).toHaveBeenCalledWith(
      'stage:draft-1:participants:data',
      'socket-1',
      expect.any(String)
    );
    expect(client.hset).toHaveBeenCalledWith('stage:draft-1:ready', 'member-1', '1');
  });
});
