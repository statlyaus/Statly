import 'server-only';
import { createClient, type RedisClientType } from 'redis';

type AnyRedisClient = RedisClientType<any, any, any>;

declare global {
  // eslint-disable-next-line no-var
  var __statly_redis__: AnyRedisClient | undefined;
  // eslint-disable-next-line no-var
  var __statly_redis_pub__: AnyRedisClient | undefined;
  // eslint-disable-next-line no-var
  var __statly_redis_sub__: AnyRedisClient | undefined;
}

const url = process.env.REDIS_URL;

// Single client (general use)
export async function getRedis(): Promise<AnyRedisClient> {
  if (globalThis.__statly_redis__) return globalThis.__statly_redis__!;
  const client: AnyRedisClient = createClient(url ? { url } : {} as any);
  client.on('error', (err) => console.error('[redis] error', err));
  await client.connect().catch((e) => {
    console.error('[redis] connect error', e);
  });
  globalThis.__statly_redis__ = client;
  return client;
}

// Pub/Sub pair
export async function getPubSub(): Promise<{ pub: AnyRedisClient; sub: AnyRedisClient }> {
  if (globalThis.__statly_redis_pub__ && globalThis.__statly_redis_sub__) {
    return { pub: globalThis.__statly_redis_pub__!, sub: globalThis.__statly_redis_sub__! };
  }

  const pub: AnyRedisClient = createClient(url ? { url } : {} as any);
  const sub: AnyRedisClient = createClient(url ? { url } : {} as any);

  pub.on('error', (e) => console.error('[redis:pub] error', e));
  sub.on('error', (e) => console.error('[redis:sub] error', e));

  await Promise.all([
    pub.connect().catch((e) => console.error('[redis:pub] connect error', e)),
    sub.connect().catch((e) => console.error('[redis:sub] connect error', e)),
  ]);

  globalThis.__statly_redis_pub__ = pub;
  globalThis.__statly_redis_sub__ = sub;
  return { pub, sub };
}

// Backwards-compatible alias some modules expect
export async function getRedisPubSub() {
  return getPubSub();
}
