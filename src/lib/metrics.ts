import { redisClient } from './redis';
import { logger } from './logger';

interface ApplicationMetrics {
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  averageResponseTime: number;
  activeConnections: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
  uptime: number;
  version: string;
  redis?: {
    connectedClients: number;
    usedMemory: number;
    totalCommandsProcessed: number;
    keyspaceHits: number;
    keyspaceMisses: number;
    hitRate: number;
  };
}

class MetricsCollector {
  private readonly METRICS_PREFIX = 'metrics:';
  private readonly RESPONSE_TIMES_KEY = `${this.METRICS_PREFIX}response_times`;
  private readonly REQUEST_COUNT_KEY = `${this.METRICS_PREFIX}total_requests`;
  private readonly ERROR_COUNT_KEY = `${this.METRICS_PREFIX}total_errors`;
  
  // In-memory fallback for when Redis is not available
  private memoryMetrics = {
    totalRequests: 0,
    totalErrors: 0,
    responseTimes: [] as number[],
    maxResponseTimeSamples: 1000,
  };

  async recordRequest(responseTime: number, isError: boolean = false): Promise<void> {
    try {
      if (redisClient.isConnected()) {
        // Store in Redis
        await Promise.all([
          redisClient.incr(this.REQUEST_COUNT_KEY),
          this.addResponseTime(responseTime),
          isError ? redisClient.incr(this.ERROR_COUNT_KEY) : Promise.resolve(),
        ]);
      } else {
        // Fallback to memory
        this.memoryMetrics.totalRequests++;
        if (isError) {
          this.memoryMetrics.totalErrors++;
        }
        
        this.memoryMetrics.responseTimes.push(responseTime);
        if (this.memoryMetrics.responseTimes.length > this.memoryMetrics.maxResponseTimeSamples) {
          this.memoryMetrics.responseTimes = this.memoryMetrics.responseTimes.slice(-this.memoryMetrics.maxResponseTimeSamples);
        }
      }
    } catch (error) {
      logger.error('Failed to record request metrics', error as Error);
    }
  }

  private async addResponseTime(responseTime: number): Promise<void> {
    try {
      const client = redisClient.getClient();
      if (!client) return;

      // Store response time with timestamp for sliding window calculation
      const timestamp = Date.now();
      await client.zadd(this.RESPONSE_TIMES_KEY, timestamp, responseTime);
      
      // Keep only last hour of data
      const oneHourAgo = timestamp - (60 * 60 * 1000);
      await client.zremrangebyscore(this.RESPONSE_TIMES_KEY, '-inf', oneHourAgo);
    } catch (error) {
      logger.error('Failed to add response time', error as Error);
    }
  }

  async getTotalRequests(): Promise<number> {
    try {
      if (redisClient.isConnected()) {
        const count = await redisClient.get(this.REQUEST_COUNT_KEY);
        return parseInt(count || '0');
      }
      return this.memoryMetrics.totalRequests;
    } catch (error) {
      logger.error('Failed to get total requests', error as Error);
      return this.memoryMetrics.totalRequests;
    }
  }

  async getTotalErrors(): Promise<number> {
    try {
      if (redisClient.isConnected()) {
        const count = await redisClient.get(this.ERROR_COUNT_KEY);
        return parseInt(count || '0');
      }
      return this.memoryMetrics.totalErrors;
    } catch (error) {
      logger.error('Failed to get total errors', error as Error);
      return this.memoryMetrics.totalErrors;
    }
  }

  async getAverageResponseTime(): Promise<number> {
    try {
      if (redisClient.isConnected()) {
        const client = redisClient.getClient();
        if (!client) return 0;

        // Get response times from last hour
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const responseTimes = await client.zrangebyscore(
          this.RESPONSE_TIMES_KEY, 
          oneHourAgo, 
          '+inf'
        );

        if (responseTimes.length === 0) return 0;

        const total = responseTimes.reduce((sum, time) => sum + parseFloat(time), 0);
        return Math.round(total / responseTimes.length);
      } else {
        // Fallback to memory
        if (this.memoryMetrics.responseTimes.length === 0) return 0;
        const total = this.memoryMetrics.responseTimes.reduce((sum, time) => sum + time, 0);
        return Math.round(total / this.memoryMetrics.responseTimes.length);
      }
    } catch (error) {
      logger.error('Failed to get average response time', error as Error);
      return 0;
    }
  }

  async getErrorRate(): Promise<number> {
    try {
      const [totalRequests, totalErrors] = await Promise.all([
        this.getTotalRequests(),
        this.getTotalErrors(),
      ]);

      if (totalRequests === 0) return 0;
      return Math.round((totalErrors / totalRequests) * 100 * 100) / 100; // Round to 2 decimal places
    } catch (error) {
      logger.error('Failed to calculate error rate', error as Error);
      return 0;
    }
  }

  private getMemoryUsage() {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
    };
  }

  private getActiveConnections(): number {
    // This would need to be implemented based on your specific server setup
    // For Next.js, this might not be directly available
    return 0;
  }

  async getRedisMetrics() {
    try {
      if (!redisClient.isConnected()) {
        return undefined;
      }

      const stats = await redisClient.getStats();
      const hitRate = stats.keyspaceHits + stats.keyspaceMisses > 0 
        ? Math.round((stats.keyspaceHits / (stats.keyspaceHits + stats.keyspaceMisses)) * 100 * 100) / 100
        : 0;

      return {
        connectedClients: stats.connectedClients,
        usedMemory: stats.usedMemory,
        totalCommandsProcessed: stats.totalCommandsProcessed,
        keyspaceHits: stats.keyspaceHits,
        keyspaceMisses: stats.keyspaceMisses,
        hitRate,
      };
    } catch (error) {
      logger.error('Failed to get Redis metrics', error as Error);
      return undefined;
    }
  }

  async collectAllMetrics(startTime: number): Promise<ApplicationMetrics> {
    try {
      const [
        totalRequests,
        totalErrors,
        averageResponseTime,
        redisMetrics
      ] = await Promise.all([
        this.getTotalRequests(),
        this.getTotalErrors(),
        this.getAverageResponseTime(),
        this.getRedisMetrics(),
      ]);

      const errorRate = await this.getErrorRate();

      return {
        totalRequests,
        totalErrors,
        errorRate,
        averageResponseTime,
        activeConnections: this.getActiveConnections(),
        memoryUsage: this.getMemoryUsage(),
        uptime: Date.now() - startTime,
        version: process.env.npm_package_version || '1.0.0',
        redis: redisMetrics,
      };
    } catch (error) {
      logger.error('Failed to collect all metrics', error as Error);
      
      // Return minimal metrics on error
      return {
        totalRequests: this.memoryMetrics.totalRequests,
        totalErrors: this.memoryMetrics.totalErrors,
        errorRate: 0,
        averageResponseTime: 0,
        activeConnections: 0,
        memoryUsage: this.getMemoryUsage(),
        uptime: Date.now() - startTime,
        version: process.env.npm_package_version || '1.0.0',
      };
    }
  }

  async resetMetrics(): Promise<void> {
    try {
      if (redisClient.isConnected()) {
        const client = redisClient.getClient();
        if (client) {
          await Promise.all([
            client.del(this.REQUEST_COUNT_KEY),
            client.del(this.ERROR_COUNT_KEY),
            client.del(this.RESPONSE_TIMES_KEY),
          ]);
        }
      }
      
      // Reset memory metrics
      this.memoryMetrics = {
        totalRequests: 0,
        totalErrors: 0,
        responseTimes: [],
        maxResponseTimeSamples: 1000,
      };
      
      logger.info('Metrics reset successfully');
    } catch (error) {
      logger.error('Failed to reset metrics', error as Error);
    }
  }

  // Health check for metrics system itself
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; error?: string }> {
    try {
      // Test basic functionality
      await this.getTotalRequests();
      await this.getAverageResponseTime();
      
      return { status: 'healthy' };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();

// Middleware function for automatic request tracking
export function withMetrics<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  name?: string
): (...args: TArgs) => Promise<TResult> {
  return (async (...args: TArgs) => {
    const startTime = Date.now();
    let isError = false;

    try {
      const result = await fn(...args);
      return result;
    } catch (error) {
      isError = true;
      throw error;
    } finally {
      const responseTime = Date.now() - startTime;
      await metricsCollector.recordRequest(responseTime, isError);

      if (name) {
        logger.debug(`${name} completed`, { responseTime, isError });
      }
    }
  }) as (...args: TArgs) => Promise<TResult>;
}

export type { ApplicationMetrics };
