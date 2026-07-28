import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server as SocketIOServer } from 'socket.io';

export interface SocketRedisAdapterLifecycle {
  close: () => Promise<void>;
}

export async function installSocketRedisAdapter(
  io: SocketIOServer,
  redis: Redis
): Promise<SocketRedisAdapterLifecycle> {
  const publishClient = redis.duplicate();
  const subscribeClient = redis.duplicate();

  try {
    await Promise.all([publishClient.ping(), subscribeClient.ping()]);
    io.adapter(
      createAdapter(publishClient, subscribeClient, {
        publishOnSpecificResponseChannel: true,
      })
    );
  } catch (error) {
    publishClient.disconnect();
    subscribeClient.disconnect();
    throw error;
  }

  return {
    close: async () => {
      await Promise.allSettled([publishClient.quit(), subscribeClient.quit()]);
    },
  };
}
