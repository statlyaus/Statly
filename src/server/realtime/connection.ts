import 'server-only';

import { Redis, type RedisOptions } from 'ioredis';

const redisOptions: RedisOptions = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: process.env.REDIS_PORT ? Number.parseInt(process.env.REDIS_PORT, 10) || 6379 : 6379,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB ? Number.parseInt(process.env.REDIS_DB, 10) || 0 : 0,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
};

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisOptions);
  }
  return redisClient;
}

export const redisClientInstance = getRedisClient();
export const redisConnection = redisOptions;
export default redisOptions;
