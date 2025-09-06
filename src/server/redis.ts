import 'server-only';
import { createClient, type RedisClientType } from 'redis';

declare global {
  // eslint-disable-next-line no-var
  var __statly_redis__: RedisClientType | undefined;
  // eslint-disable-next-line no-var
  var __statly_redis_pub__: RedisClientType | undefined;
  // eslint-disable-next-line no-var
  var __statly_redis_sub__: RedisClientType | undefined;
}

const url = process.env.REDIS_URL;

// Single client (general use)
export function getRedis(): RedisClientType {
  if (globalThis.__statly_redis__) return globalThis.__statly_redis__!;
  const client = createClient(url ? { url } : undefined);
  client.on('error', (err) => console.error('[redis] error', err));
  globalThis.__statly_redis__ = client;
  return client;
}

// Pub/Sub pair
export async function getPubSub(): Promise<{ pub: RedisClientType; sub: RedisClientType }> {
  if (globalThis.__statly_redis_pub__ && globalThis.__statly_redis_sub__) {
    return { pub: globalThis.__statly_redis_pub__!, sub: globalThis.__statly_redis_sub__! };
  }

  const pub = createClient(url ? { url } : undefined);
  const sub = createClient(url ? { url } : undefined);

  pub.on('error', (e) => console.error('[redis:pub] error', e));
  sub.on('error', (e) => console.error('[redis:sub] error', e));

  await Promise.all([pub.connect(), sub.connect()]);

  globalThis.__statly_redis_pub__ = pub;
  globalThis.__statly_redis_sub__ = sub;
  return { pub, sub };
}