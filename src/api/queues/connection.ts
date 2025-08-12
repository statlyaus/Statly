import type { RedisOptions } from 'bullmq';

export const redisConnection: RedisOptions = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  // Avoid connecting immediately in environments without Redis
  lazyConnect: true,
};

export default redisConnection;
