import 'server-only';
import Redis, { Cluster } from 'ioredis';
import type {
  Redis as IORedisClient,
  Cluster as IORedisCluster,
  ClusterOptions,
  RedisOptions,
} from 'ioredis';
import { logger } from '@/lib/logger';

// Lightweight interface describing the methods we use from ioredis clients
type RedisLike = { ping: () => Promise<string>; quit: () => Promise<void> };

interface ScalableRedisConfig {
  cluster?: {
    nodes: Array<{ host: string; port: number }>;
    options?: Record<string, unknown>;
  };
  standalone?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    db?: number;
  };
  poolSize?: number;
  maxRetries?: number;
  retryDelayOnFailover?: number;
  enableHealthCheck?: boolean;
  // New: configurable health check interval (milliseconds)
  healthCheckIntervalMs?: number;
}

interface ConnectionHealth {
  isHealthy: boolean;
  lastCheck: Date;
  consecutiveFailures: number;
  latency?: number;
  error?: string;
}

// Unique Symbol used to mark shutdown handler registration on globalThis to avoid
// name collisions and ensure safety across module reloads and worker contexts.
const SHUTDOWN_HANDLERS_SYMBOL = Symbol.for('scalableRedisShutdownHandlersRegistered');

class ScalableRedisConnection {
  private static instance: ScalableRedisConnection;
  // Per-role ioredis clients (created lazily)
  private publisherClient?: IORedisClient | IORedisCluster;
  private workerClient?: IORedisClient | IORedisCluster;
  private queueEventsClient?: IORedisClient | IORedisCluster;
  private genericClient?: IORedisClient | IORedisCluster;
  // New: dedicated subscriber client for Pub/Sub to avoid hijacking a shared client
  private subscriberClient?: IORedisClient | IORedisCluster;

  private healthStatus: ConnectionHealth;
  private healthCheckInterval?: NodeJS.Timeout;
  private healthChecksStarted = false;
  private clientForHealth?: RedisLike;

  // Connection type determined once at construction to avoid recomputing later
  private connectionType: 'cluster' | 'standalone';

  private constructor() {
    this.healthStatus = {
      isHealthy: false,
      lastCheck: new Date(),
      consecutiveFailures: 0,
    };

    this.connectionType = process.env.REDIS_CLUSTER_NODES ? 'cluster' : 'standalone';
    // Do NOT create any clients here — creation is lazy via getters
  }

  /**
   * Build the configuration object from environment variables.
   * Made static and public so tests can call it without creating the singleton.
   */
  static buildScalableRedisConfig(): ScalableRedisConfig {
    const clusterNodesRaw = process.env.REDIS_CLUSTER_NODES;
    const cluster = clusterNodesRaw
      ? (() => {
          try {
            return {
              nodes: JSON.parse(clusterNodesRaw) as Array<{ host: string; port: number }>,
              options: {
                enableOfflineQueue: false,
                retryDelayOnFailover: 100,
                lazyConnect: true,
                enableReadyCheck: true,
                // BullMQ requires maxRetriesPerRequest=null; set in RedisOptions where it's allowed
                redisOptions: {
                  family: 4,
                  keepAlive: 30000,
                  connectTimeout: 10000,
                  commandTimeout: 5000,
                  maxRetriesPerRequest: null,
                },
              },
            } as ScalableRedisConfig['cluster'];
          } catch (error) {
            logger.error('Invalid REDIS_CLUSTER_NODES JSON', {
              value: clusterNodesRaw,
              error: error instanceof Error ? error.message : String(error),
            });
            throw new Error('Failed to parse REDIS_CLUSTER_NODES configuration');
          }
        })()
      : undefined;

    const standalone = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379,
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      db: process.env.REDIS_DB ? Number(process.env.REDIS_DB) : 0,
    };

    // Parse health check interval from env, accepting seconds or milliseconds when numeric
    const defaultIntervalMs = 30_000;
    const rawInterval = process.env.REDIS_HEALTH_CHECK_INTERVAL;
    let healthCheckIntervalMs = defaultIntervalMs;
    if (rawInterval && rawInterval.trim().length > 0) {
      const n = Number(rawInterval);
      if (!Number.isNaN(n) && n > 0) {
        // Heuristic: values >= 1000 are treated as ms; smaller numbers as seconds
        healthCheckIntervalMs = n >= 1000 ? Math.round(n) : Math.round(n * 1000);
      } else {
        logger.warn('Invalid REDIS_HEALTH_CHECK_INTERVAL; falling back to default 30s', {
          value: rawInterval,
        });
      }
    }

    return {
      cluster,
      standalone,
      poolSize: Number(process.env.REDIS_POOL_SIZE) || 10,
      maxRetries: Number(process.env.REDIS_MAX_RETRIES) || 3,
      retryDelayOnFailover: Number(process.env.REDIS_RETRY_DELAY) || 100,
      enableHealthCheck: process.env.REDIS_HEALTH_CHECK !== 'false',
      healthCheckIntervalMs,
    } as ScalableRedisConfig;
  }

  static getInstance(): ScalableRedisConnection {
    if (!ScalableRedisConnection.instance) {
      ScalableRedisConnection.instance = new ScalableRedisConnection();
    }
    return ScalableRedisConnection.instance;
  }

  // Internal factory used by role getters. Uses static config builder to remain consistent and testable.
  private createClientInstance(
    role: 'publisher' | 'worker' | 'queueEvents' | 'generic' | 'subscriber'
  ): IORedisClient | IORedisCluster {
    const config = ScalableRedisConnection.buildScalableRedisConfig();

    if (config.cluster) {
      logger.info(`Creating Redis cluster client for role=${role}`, {
        nodeCount: config.cluster.nodes.length,
        poolSize: config.poolSize,
      });

      const nodes = config.cluster.nodes.map((n) => ({ host: n.host, port: n.port }));
      const clusterOptions = (config.cluster.options ?? {}) as ClusterOptions;
      const cluster = new Cluster(nodes, clusterOptions);
      cluster.on('error', (err: Error) => {
        logger.error(`Redis Cluster error (role=${role})`, { error: err.message });
      });

      this.setupHealthAndHandlers(cluster);
      return cluster as unknown as IORedisCluster;
    }

    // Standalone client
    const standalone = config.standalone ?? {
      host: 'localhost',
      port: 6379,
      db: 0,
    };

    logger.info(`Creating Redis standalone client for role=${role}`, {
      host: standalone.host,
      port: standalone.port,
      db: standalone.db,
      poolSize: config.poolSize,
    });

    const redisOptions: RedisOptions = {
      host: standalone.host,
      port: standalone.port,
      username: standalone.username,
      password: standalone.password,
      db: standalone.db,
      // BullMQ requires this to be null
      maxRetriesPerRequest: null,
      lazyConnect: true,
      family: 4,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      enableAutoPipelining: true,
    };

    const client = new Redis(redisOptions);
    client.on('error', (err: Error) =>
      logger.error(`Redis client error (role=${role})`, { error: err.message })
    );

    this.setupHealthAndHandlers(client);
    return client as unknown as IORedisClient;
  }

  // Attach health-handling and common wiring for a newly created client. Starts health checks once.
  private setupHealthAndHandlers(client: IORedisClient | IORedisCluster) {
    // Use the first client created as the health-check target
    if (!this.healthChecksStarted) {
      // Prefer worker client for health checks as it's the most critical; fall back to the provided client
      const preferredClient = (this.workerClient ?? client) as unknown as RedisLike;
      this.clientForHealth = preferredClient;
      // Start periodic health checks only if enabled in config
      const cfg = ScalableRedisConnection.buildScalableRedisConfig();
      if (cfg.enableHealthCheck) {
        void this.initializeHealthChecks();
        this.healthChecksStarted = true;
        logger.info('Health checks initialized', {
          role:
            preferredClient === (this.workerClient as unknown as RedisLike) ? 'worker' : 'other',
        });
      }
    }
  }

  // Role-specific lazy getters
  getPublisherClient(): IORedisClient | IORedisCluster {
    if (!this.publisherClient) {
      this.publisherClient = this.createClientInstance('publisher');
    }
    return this.publisherClient;
  }

  getWorkerClient(): IORedisClient | IORedisCluster {
    if (!this.workerClient) {
      this.workerClient = this.createClientInstance('worker');
    }
    return this.workerClient;
  }

  getQueueEventsClient(): IORedisClient | IORedisCluster {
    if (!this.queueEventsClient) {
      this.queueEventsClient = this.createClientInstance('queueEvents');
    }
    return this.queueEventsClient;
  }

  // New: dedicated subscriber client getter
  getSubscriberClient(): IORedisClient | IORedisCluster {
    if (!this.subscriberClient) {
      this.subscriberClient = this.createClientInstance('subscriber');
    }
    return this.subscriberClient;
  }

  // Generic getter for places still using a single client
  getConnection(): IORedisClient | IORedisCluster {
    if (!this.genericClient) {
      this.genericClient = this.createClientInstance('generic');
    }
    return this.genericClient;
  }

  // Resolve interval from config (env-driven) with validation and sensible default
  private resolveHealthCheckIntervalMs(): number {
    const cfg = ScalableRedisConnection.buildScalableRedisConfig();
    const ms = cfg.healthCheckIntervalMs;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
      return Math.round(ms);
    }
    return 30_000; // default 30s
  }

  private async initializeHealthChecks(): Promise<void> {
    if (!this.clientForHealth) return;

    const intervalMs = this.resolveHealthCheckIntervalMs();

    // Initial health check
    await this.performHealthCheck();

    // Set up periodic health checks based on resolved interval
    this.healthCheckInterval = setInterval(() => {
      void this.performHealthCheck();
    }, intervalMs);

    logger.info('Redis health checks initialized', {
      intervalMs,
      intervalSeconds: Math.round(intervalMs / 1000),
      enabled: true,
    });
  }

  private async performHealthCheck(): Promise<void> {
    const start = Date.now();

    try {
      if (!this.clientForHealth) throw new Error('No Redis client available for health checks');
      await this.clientForHealth.ping();

      const latency = Date.now() - start;
      const previousFailures = this.healthStatus.consecutiveFailures;

      this.healthStatus = {
        isHealthy: true,
        lastCheck: new Date(),
        consecutiveFailures: 0,
        latency,
      };

      if (previousFailures > 0) {
        logger.info('Redis connection recovered', {
          latency,
          previousFailures,
        });
      }
    } catch (error) {
      this.healthStatus = {
        isHealthy: false,
        lastCheck: new Date(),
        consecutiveFailures: this.healthStatus.consecutiveFailures + 1,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      logger.error('Redis health check failed', {
        consecutiveFailures: this.healthStatus.consecutiveFailures,
        error: this.healthStatus.error,
        latency: Date.now() - start,
      });

      if (this.healthStatus.consecutiveFailures >= 3) {
        logger.error('Redis connection unhealthy - multiple failures detected', {
          consecutiveFailures: this.healthStatus.consecutiveFailures,
          lastError: this.healthStatus.error,
        });
      }
    }
  }

  getHealthStatus(): ConnectionHealth {
    return { ...this.healthStatus };
  }

  async forceHealthCheck(): Promise<ConnectionHealth> {
    await this.performHealthCheck();
    return this.getHealthStatus();
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const healthStatus = await this.forceHealthCheck();
    return {
      healthy: healthStatus.isHealthy,
      latency: healthStatus.latency,
      error: healthStatus.error,
    };
  }

  getConnectionMetrics(): {
    isHealthy: boolean;
    consecutiveFailures: number;
    lastCheckAge: number;
    connectionType: 'cluster' | 'standalone';
  } {
    const lastCheckAge = Date.now() - this.healthStatus.lastCheck.getTime();

    return {
      isHealthy: this.healthStatus.isHealthy,
      consecutiveFailures: this.healthStatus.consecutiveFailures,
      lastCheckAge,
      connectionType: this.connectionType,
    };
  }

  // Graceful shutdown: close any clients that were created
  async shutdown(): Promise<void> {
    logger.info('Shutting down Redis connection manager');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    const closeIfExists = async (c?: IORedisClient | IORedisCluster) => {
      if (!c) return;
      try {
        const r = c as unknown as RedisLike;
        await r.quit();
      } catch (err) {
        logger.warn('Error closing Redis client', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    await closeIfExists(this.publisherClient);
    await closeIfExists(this.workerClient);
    await closeIfExists(this.queueEventsClient);
    await closeIfExists(this.genericClient);
    await closeIfExists(this.subscriberClient);

    logger.info('Redis connection manager shutdown complete');
  }
}

// Exports
// Provide a lazy getter so importing this module does NOT create a live Redis connection.
export function getRedisConnection(): IORedisClient | IORedisCluster {
  return ScalableRedisConnection.getInstance().getConnection();
}

export { ScalableRedisConnection };
// Convenience export for tests that want to validate config parsing without creating the singleton
export const buildScalableRedisConfig = ScalableRedisConnection.buildScalableRedisConfig;

// Role-specific convenience getters — prefer these over calling getInstance() in call sites
export function getPublisherClient(): IORedisClient | IORedisCluster {
  return ScalableRedisConnection.getInstance().getPublisherClient();
}

export function getWorkerClient(): IORedisClient | IORedisCluster {
  return ScalableRedisConnection.getInstance().getWorkerClient();
}

export function getQueueEventsClient(): IORedisClient | IORedisCluster {
  return ScalableRedisConnection.getInstance().getQueueEventsClient();
}

// New: export a subscriber client getter for Pub/Sub consumers
export function getSubscriberClient(): IORedisClient | IORedisCluster {
  return ScalableRedisConnection.getInstance().getSubscriberClient();
}

// Convenience health getter
export async function getHealthStatus(): Promise<ConnectionHealth> {
  return ScalableRedisConnection.getInstance().getHealthStatus();
}

// Register shutdown handlers once per process
const __g = globalThis as unknown as Record<symbol, unknown>;
if (!__g[SHUTDOWN_HANDLERS_SYMBOL]) {
  process.on('SIGTERM', () => {
    ScalableRedisConnection.getInstance()
      .shutdown()
      .then(() => {
        logger.info('Redis connection shutdown complete on SIGTERM');
        process.exit(0);
      })
      .catch((error) => {
        logger.error('Redis shutdown failed on SIGTERM', { error });
        process.exit(1);
      });
  });

  process.on('SIGINT', () => {
    ScalableRedisConnection.getInstance()
      .shutdown()
      .then(() => {
        logger.info('Redis connection shutdown complete on SIGINT');
        process.exit(0);
      })
      .catch((error) => {
        logger.error('Redis shutdown failed on SIGINT', { error });
        process.exit(1);
      });
  });

  // Store the Symbol itself as a marker to indicate handlers are registered
  __g[SHUTDOWN_HANDLERS_SYMBOL] = SHUTDOWN_HANDLERS_SYMBOL;
}

export default getRedisConnection;
