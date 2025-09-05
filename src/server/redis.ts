// src/server/redis.ts
import { createClient, type RedisClientType } from 'redis';

declare global {
   
  var __statly_redis__: RedisClientType | undefined;
   
  var __statly_redis_pub__: RedisClientType | undefined;
   
  var __statly_redis_sub__: RedisClientType | undefined;
}

function buildRedisUrl() {
  const url = process.env.REDIS_URL?.trim();
  if (url) return url;

  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const user = process.env.REDIS_USERNAME ?? 'default';
  const pass = process.env.REDIS_PASSWORD;
  if (!host || !port || !pass) return '';
  return `rediss://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

async function connect(client: RedisClientType) {
  if (client.isOpen) return client;
  await client.connect();
  return client;
}

export async function getRedis(): Promise<RedisClientType | null> {
  if (globalThis.__statly_redis__?.isOpen) return globalThis.__statly_redis__!;
  const url = buildRedisUrl();
  if (!url) return null;

  const client = createClient({
    url,
    socket: { tls: process.env.REDIS_TLS !== 'false', keepAlive: 5000 },
  });

  globalThis.__statly_redis__ = client;
  try {
    return await connect(client);
  } catch (err) {
     
    console.error('❌ Redis connect failed:', (err as Error).message);
    return null;
  }
}

export async function getRedisPubSub(): Promise<{ pub: RedisClientType; sub: RedisClientType } | null> {
  if (globalThis.__statly_redis_pub__?.isOpen && globalThis.__statly_redis_sub__?.isOpen) {
    return { pub: globalThis.__statly_redis_pub__!, sub: globalThis.__statly_redis_sub__! };
  }

  const url = buildRedisUrl();
  if (!url) return null;

  const base = { url, socket: { tls: process.env.REDIS_TLS !== 'false', keepAlive: 5000 } } as const;

  const pub = createClient(base);
  const sub = pub.duplicate();

  globalThis.__statly_redis_pub__ = pub;
  globalThis.__statly_redis_sub__ = sub;

  try {
    await Promise.all([connect(pub), connect(sub)]);
    return { pub, sub };
  } catch (err) {
     
    console.error('❌ Redis pub/sub connect failed:', (err as Error).message);
    return null;
  }
}