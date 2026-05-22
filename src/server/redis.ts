import { Redis, type RedisOptions } from 'ioredis';

type AnyRedisClient = Redis;

declare global {
  // Singleton clients stored on globalThis for reuse across hot reloads
  var __statly_redis__: AnyRedisClient | undefined;
  var __statly_redis_pub__: AnyRedisClient | undefined;
  var __statly_redis_sub__: AnyRedisClient | undefined;
}

const url = process.env.REDIS_URL;

function getRedisOptions(): RedisOptions {
  return {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: Number.parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
  };
}

function createRedisClient(label = 'redis'): AnyRedisClient {
  const client = url
    ? new Redis(url, getRedisOptions())
    : new Redis({
        ...getRedisOptions(),
        host: process.env.REDIS_HOST || 'localhost',
        port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD,
        db: Number.parseInt(process.env.REDIS_DB || '0', 10),
      });

  client.on('error', (error: Error) => console.error(`[${label}] error`, error));

  return client;
}

function canReuseClient(client: AnyRedisClient | undefined): client is AnyRedisClient {
  return !!client && client.status !== 'end';
}

async function ensureConnected(client: AnyRedisClient): Promise<void> {
  if (client.status === 'ready') {
    return;
  }

  if (client.status === 'end') {
    throw new Error('Redis client connection has ended');
  }

  if (client.status === 'wait') {
    await client.connect();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      client.off('ready', handleReady);
      client.off('error', handleError);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    client.once('ready', handleReady);
    client.once('error', handleError);
  });
}

export async function getRedis(): Promise<AnyRedisClient> {
  if (globalThis.__statly_redis__?.status === 'ready') return globalThis.__statly_redis__;

  const client: AnyRedisClient = canReuseClient(globalThis.__statly_redis__)
    ? globalThis.__statly_redis__
    : createRedisClient();
  await ensureConnected(client);

  globalThis.__statly_redis__ = client;
  return client;
}

export async function getPubSub(): Promise<{ pub: AnyRedisClient; sub: AnyRedisClient }> {
  // Reuse existing pub/sub clients if available
  if (
    globalThis.__statly_redis_pub__?.status === 'ready' &&
    globalThis.__statly_redis_sub__?.status === 'ready'
  ) {
    return { pub: globalThis.__statly_redis_pub__, sub: globalThis.__statly_redis_sub__ };
  }

  const pub: AnyRedisClient = canReuseClient(globalThis.__statly_redis_pub__)
    ? globalThis.__statly_redis_pub__
    : createRedisClient('redis:pub');
  const sub: AnyRedisClient = canReuseClient(globalThis.__statly_redis_sub__)
    ? globalThis.__statly_redis_sub__
    : createRedisClient('redis:sub');

  if (pub.status !== 'ready') await ensureConnected(pub);
  if (sub.status !== 'ready') await ensureConnected(sub);

  globalThis.__statly_redis_pub__ = pub;
  globalThis.__statly_redis_sub__ = sub;
  return { pub, sub };
}

// Backwards-compatible alias
export async function getRedisPubSub(): Promise<{ pub: AnyRedisClient; sub: AnyRedisClient }> {
  return getPubSub();
}
