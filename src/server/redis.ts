import { Redis, type RedisOptions } from 'ioredis';

type AnyRedisClient = Redis;

declare global {
  // Singleton clients stored on globalThis for reuse across hot reloads
  var __statly_redis__: AnyRedisClient | undefined;
  var __statly_redis_pub__: AnyRedisClient | undefined;
  var __statly_redis_sub__: AnyRedisClient | undefined;
}

const url = process.env.REDIS_URL;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

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

function getConnectTimeoutMs(): number {
  const timeoutMs = Number.parseInt(
    process.env.REDIS_CONNECT_TIMEOUT_MS || String(DEFAULT_CONNECT_TIMEOUT_MS),
    10
  );

  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CONNECT_TIMEOUT_MS;
}

function canReuseClient(client: AnyRedisClient | undefined): client is AnyRedisClient {
  return !!client && client.status !== 'end';
}

async function waitForReady(client: AnyRedisClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      client.off('ready', handleReady);
      client.off('error', handleError);
      client.off('end', handleEnd);
      if (timeout) {
        clearTimeout(timeout);
      }
    };

    const settle = (complete: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      complete();
    };

    const handleReady = () => settle(resolve);
    const handleError = (error: Error) => settle(() => reject(error));
    const handleEnd = () =>
      settle(() => reject(new Error('Redis client connection ended before ready')));
    const handleTimeout = () =>
      settle(() => reject(new Error('Redis client connection timed out before ready')));

    client.once('ready', handleReady);
    client.once('error', handleError);
    client.once('end', handleEnd);
    timeout = setTimeout(handleTimeout, getConnectTimeoutMs());

    if (client.status === 'ready') {
      handleReady();
    } else if (client.status === 'end') {
      handleEnd();
    }
  });
}

async function ensureConnected(client: AnyRedisClient): Promise<void> {
  if (client.status === 'ready') {
    return;
  }

  if (client.status === 'end') {
    throw new Error('Redis client connection has ended');
  }

  if (client.status === 'wait') {
    const readyPromise = waitForReady(client);
    const connectPromise = client.connect().then(() => undefined);
    await Promise.race([readyPromise, connectPromise]);
    await readyPromise;
    return;
  }

  await waitForReady(client);
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
