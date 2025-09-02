import { Redis } from 'ioredis';
import { logger } from './logger';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  enableReadyCheck?: boolean;
  maxRetriesPerRequest?: number;
}

class RedisClient {
  private client: Redis | null = null;
  private config: RedisConfig;
  private isConnecting = false;

  constructor() {
    this.config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      enableReadyCheck: true,
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
    };

    if (process.env.REDIS_URL) {
      // Parse Redis URL if provided
      this.initializeFromUrl(process.env.REDIS_URL);
    } else {
      this.initialize();
    }
  }

  private initializeFromUrl(url: string) {
    try {
      this.client = new Redis(url);
      this.setupEventListeners();
    } catch (error) {
      logger.error('Failed to initialize Redis from URL', error as Error);
    }
  }

  private initialize() {
    try {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db,
        enableReadyCheck: this.config.enableReadyCheck,
        maxRetriesPerRequest: this.config.maxRetriesPerRequest,
      });
      this.setupEventListeners();
    } catch (error) {
      logger.error('Failed to initialize Redis client', error as Error);
    }
  }

  private setupEventListeners() {
    if (!this.client) return;

    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error', error);
    });

    this.client.on('close', () => {
      logger.warn('Redis connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
    });
  }

  async connect(): Promise<void> {
    if (this.isConnecting || this.isConnected()) {
      return;
    }

    this.isConnecting = true;
    try {
      if (!this.client) {
        this.initialize();
      }
      await this.client?.ping();
      logger.info('Redis connection established');
    } catch (error) {
      logger.error('Failed to connect to Redis', error as Error);
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  // Health check method
  async ping(): Promise<string> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return await this.client.ping();
  }

  // Basic cache operations
  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      logger.error(`Redis GET error for key ${key}`, error as Error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      logger.error(`Redis SET error for key ${key}`, error as Error);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}`, error as Error);
    }
  }

  async incr(key: string): Promise<number> {
    if (!this.client) return 0;
    try {
      return await this.client.incr(key);
    } catch (error) {
      logger.error(`Redis INCR error for key ${key}`, error as Error);
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}`, error as Error);
      return false;
    }
  }

  // Metrics methods
  async getStats(): Promise<{
    connectedClients: number;
    usedMemory: number;
    totalCommandsProcessed: number;
    keyspaceHits: number;
    keyspaceMisses: number;
  }> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    try {
      const info = await this.client.info();
      const lines = info.split('\r\n');
      const stats: Record<string, string> = {};

      lines.forEach((line) => {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          stats[key] = value;
        }
      });

      return {
        connectedClients: parseInt(stats.connected_clients || '0'),
        usedMemory: parseInt(stats.used_memory || '0'),
        totalCommandsProcessed: parseInt(stats.total_commands_processed || '0'),
        keyspaceHits: parseInt(stats.keyspace_hits || '0'),
        keyspaceMisses: parseInt(stats.keyspace_misses || '0'),
      };
    } catch (error) {
      logger.error('Failed to get Redis stats', error as Error);
      throw error;
    }
  }
}

// Singleton instance
export const redisClient = new RedisClient();

// Initialize connection in development/production
if (process.env.NODE_ENV !== 'test') {
  redisClient.connect().catch((error) => {
    logger.error('Failed to initialize Redis connection', error);
  });
}

export { Redis } from 'ioredis';
