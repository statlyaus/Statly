import 'server-only';

import { Redis } from 'ioredis';
export const redisConnection: RedisOptions = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: process.env.REDIS_PORT
    ? (Number.parseInt(process.env.REDIS_PORT, 10) || 6379)
    : 6379,
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB ? (Number.parseInt(process.env.REDIS_DB, 10) || 0) : 0,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  connectionName: process.env.REDIS_CONNECTION_NAME ?? 'bullmq',
  // BullMQ best practices
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Avoid connecting immediately in environments without Redis
  lazyConnect: true,
};
    : 6379,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  // BullMQ best practices
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Avoid connecting immediately in environments without Redis
  lazyConnect: true,
};

// Singleton Redis client instance
let redisClient: Redis | null = null;

/**
 * Get the singleton Redis client instance
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisOptions);
    
    redisClient.on('error', (err: Error) => {
      logger.error('Redis client error', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    redisClient.on('close', () => {
      logger.info('Redis client connection closed');
    });

    // Setup graceful shutdown
    const shutdown = async () => {
      if (redisClient) {
        logger.info('Shutting down Redis client...');
        try {
          await redisClient.quit();
          logger.info('Redis client shutdown complete');
        } catch (error) {
          logger.error('Error during Redis client shutdown', { error });
        }
      }
    };

    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
    process.on('beforeExit', () => void shutdown());
  }

  return redisClient;
}

// Export the client instance for direct use
export const redisClientInstance = getRedisClient();

// Legacy export for backward compatibility (deprecated)
export const redisConnection = redisOptions;
export default redisConnection;