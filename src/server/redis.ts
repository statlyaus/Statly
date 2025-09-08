import 'server-only';
import { createClient, type RedisClientType } from 'redis';

type AnyRedisClient = RedisClientType<any, any, any>;

declare global {
   
  var __statly_redis__: AnyRedisClient | undefined;
   
  var __statly_redis_pub__: AnyRedisClient | undefined;
   
  var __statly_redis_sub__: AnyRedisClient | undefined;
}

const url = process.env.REDIS_URL;

// Validate Redis URL format if provided
export async function getRedis(): Promise<AnyRedisClient> {
  if (globalThis.__statly_redis__?.isOpen) return globalThis.__statly_redis__!;
  const client: AnyRedisClient = createClient(url ? { url } : undefined);
    const opts = url ? { url } : undefined;
    const client: AnyRedisClient = createClient(opts);
    client.on('error', (err) => console.error('[redis] error', err));
    globalThis.__statly_redis_init__ = client.connect()
      .then(() => {
        globalThis.__statly_redis__ = client;
        return client;
      })
      .catch(async (e) => {
export async function getPubSub(): Promise<{ pub: AnyRedisClient; sub: AnyRedisClient }> {
  if (globalThis.__statly_redis_pub__ && globalThis.__statly_redis_sub__) {
    return { pub: globalThis.__statly_redis_pub__!, sub: globalThis.__statly_redis_sub__! };
  }

  const pub: AnyRedisClient   = globalThis.__statly_redis_pub__   || createClient(url ? { url } : undefined);
  const sub: AnyRedisClient   = globalThis.__statly_redis_sub__   || createClient(url ? { url } : undefined);

  pub.on('error', (e) => console.error('[redis:pub] error', e));
  sub.on('error', (e) => console.error('[redis:sub] error', e));

  try {
    await Promise.all([
      !globalThis.__statly_redis_pub__ ? pub.connect() : Promise.resolve(),
      !globalThis.__statly_redis_sub__ ? sub.connect() : Promise.resolve(),
    ]);
  } catch (e) {
    console.error('[redis:pub/sub] connect error', e);
    throw new Error(
      `Failed to connect to Redis pub/sub: ${e instanceof Error ? e.message : String(e)}`
    );
  }
export async function getRedisPubSub(): Promise<{ pub: AnyRedisClient; sub: AnyRedisClient }> {
  return getPubSub();
}
  return { pub, sub };
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
  globalThis.__statly_redis_pub__ = pub;
  globalThis.__statly_redis_sub__ = sub;
  return { pub, sub };
}

// Backwards-compatible alias some modules expect
export async function getRedisPubSub() {
  return getPubSub();
}
