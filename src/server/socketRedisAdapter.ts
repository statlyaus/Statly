import { createAdapter } from '@socket.io/redis-adapter';
import type { Cluster, Redis } from 'ioredis';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '@/lib/logger';

const DEFAULT_CONNECTION_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

export interface SocketRedisAdapterLifecycle {
  close: () => Promise<void>;
}

type RedisAdapterClient = Redis | Cluster;

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function pingWithRetry(
  publishClient: RedisAdapterClient,
  subscribeClient: RedisAdapterClient
): Promise<void> {
  const attempts = Math.max(
    1,
    readNonNegativeInteger(
      process.env.SOCKET_REDIS_ADAPTER_CONNECTION_ATTEMPTS,
      DEFAULT_CONNECTION_ATTEMPTS
    )
  );
  const retryDelayMs = readNonNegativeInteger(
    process.env.SOCKET_REDIS_ADAPTER_RETRY_DELAY_MS,
    DEFAULT_RETRY_DELAY_MS
  );

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await Promise.all([publishClient.ping(), subscribeClient.ping()]);
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }

      const delayMs = retryDelayMs * 2 ** (attempt - 1);
      logger.warn('Socket.IO Redis adapter connection attempt failed; retrying', {
        attempt,
        attempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function installSocketRedisAdapter(
  io: SocketIOServer,
  redis: RedisAdapterClient
): Promise<SocketRedisAdapterLifecycle> {
  const publishClient = redis.duplicate();
  const subscribeClient = redis.duplicate();

  try {
    await pingWithRetry(publishClient, subscribeClient);
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
