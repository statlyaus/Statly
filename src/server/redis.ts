import { createClient, type RedisClientType } from 'redis';

type AnyRedisClient = RedisClientType<any, any, any>;

declare global {
  // Singleton clients stored on globalThis for reuse across hot reloads
  var __statly_redis__: AnyRedisClient | undefined;
  var __statly_redis_pub__: AnyRedisClient | undefined;
  var __statly_redis_sub__: AnyRedisClient | undefined;
}

const url = process.env.REDIS_URL;

export async function getRedis(): Promise<AnyRedisClient> {
  if (globalThis.__statly_redis__?.isOpen) return globalThis.__statly_redis__!;

  const client: AnyRedisClient = createClient(url ? { url } : undefined);
  client.on('error', (err) => console.error('[redis] error', err));

  await client.connect();
  globalThis.__statly_redis__ = client;
  return client;
}

export async function getPubSub(): Promise<{ pub: AnyRedisClient; sub: AnyRedisClient }> {
  // Reuse existing pub/sub clients if available
  if (globalThis.__statly_redis_pub__ && globalThis.__statly_redis_sub__) {
    return { pub: globalThis.__statly_redis_pub__!, sub: globalThis.__statly_redis_sub__! };
  }

  const pub: AnyRedisClient =
    globalThis.__statly_redis_pub__ || createClient(url ? { url } : undefined);
  const sub: AnyRedisClient =
    globalThis.__statly_redis_sub__ || createClient(url ? { url } : undefined);

  pub.on('error', (e) => console.error('[redis:pub] error', e));
  sub.on('error', (e) => console.error('[redis:sub] error', e));

  if (!globalThis.__statly_redis_pub__) await pub.connect();
  if (!globalThis.__statly_redis_sub__) await sub.connect();

  globalThis.__statly_redis_pub__ = pub;
  globalThis.__statly_redis_sub__ = sub;
  return { pub, sub };
}

// Backwards-compatible alias
export async function getRedisPubSub() {
  return getPubSub();
}
