import { logger } from './logger';

interface QueryMetrics {
  query: string;
  duration: number;
  timestamp: number;
  params?: any;
  resultCount?: number;
}

class QueryOptimizer {
  private queryMetrics: Map<string, QueryMetrics[]> = new Map();
  private slowQueryThreshold = 1000; // 1 second
  private maxMetricsPerQuery = 100;

  // Wrap database queries with performance monitoring
  async measureQuery<T>(queryName: string, queryFn: () => Promise<T>, params?: any): Promise<T> {
    const startTime = performance.now();

    try {
      const result = await queryFn();
      const duration = performance.now() - startTime;

      this.recordMetrics(queryName, duration, params, this.getResultCount(result));

      if (duration > this.slowQueryThreshold) {
        logger.performanceWarn(
          `Slow database query: ${queryName}`,
          duration,
          this.slowQueryThreshold
        );
      }

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      logger.dbError(queryName, error, { duration, params });
      throw error;
    }
  }

  private recordMetrics(query: string, duration: number, params?: any, resultCount?: number): void {
    if (!this.queryMetrics.has(query)) {
      this.queryMetrics.set(query, []);
    }

    const metrics = this.queryMetrics.get(query)!;
    metrics.push({
      query,
      duration,
      timestamp: Date.now(),
      params,
      resultCount,
    });

    // Keep only recent metrics
    if (metrics.length > this.maxMetricsPerQuery) {
      metrics.splice(0, metrics.length - this.maxMetricsPerQuery);
    }
  }

  private getResultCount(result: any): number | undefined {
    if (Array.isArray(result)) {
      return result.length;
    }
    if (result && typeof result === 'object' && 'count' in result) {
      return result.count;
    }
    return undefined;
  }

  // Get performance statistics for a query
  getQueryStats(queryName: string): {
    totalExecutions: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    slowQueries: number;
    recentExecutions: QueryMetrics[];
  } | null {
    const metrics = this.queryMetrics.get(queryName);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const durations = metrics.map((m) => m.duration);
    const slowQueries = durations.filter((d) => d > this.slowQueryThreshold).length;

    return {
      totalExecutions: metrics.length,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      slowQueries,
      recentExecutions: metrics.slice(-10), // Last 10 executions
    };
  }

  // Get all query statistics
  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const queryName of this.queryMetrics.keys()) {
      stats[queryName] = this.getQueryStats(queryName);
    }

    return stats;
  }

  // Identify problematic queries
  getProblematicQueries(): Array<{
    query: string;
    issues: string[];
    stats: any;
  }> {
    const problematic: Array<{ query: string; issues: string[]; stats: any }> = [];

    for (const queryName of this.queryMetrics.keys()) {
      const stats = this.getQueryStats(queryName);
      if (!stats) continue;

      const issues: string[] = [];

      // Check for consistently slow queries
      if (stats.averageDuration > this.slowQueryThreshold) {
        issues.push(`Average duration (${stats.averageDuration.toFixed(2)}ms) exceeds threshold`);
      }

      // Check for high percentage of slow executions
      const slowPercentage = (stats.slowQueries / stats.totalExecutions) * 100;
      if (slowPercentage > 20) {
        issues.push(`${slowPercentage.toFixed(1)}% of executions are slow`);
      }

      // Check for very slow maximum duration
      if (stats.maxDuration > this.slowQueryThreshold * 5) {
        issues.push(`Maximum duration (${stats.maxDuration.toFixed(2)}ms) is extremely high`);
      }

      if (issues.length > 0) {
        problematic.push({
          query: queryName,
          issues,
          stats,
        });
      }
    }

    return problematic.sort((a, b) => b.stats.averageDuration - a.stats.averageDuration);
  }

  // Generate optimization recommendations
  getOptimizationRecommendations(): Array<{
    query: string;
    recommendations: string[];
  }> {
    const recommendations: Array<{ query: string; recommendations: string[] }> = [];
    const problematic = this.getProblematicQueries();

    for (const { query, stats } of problematic) {
      const queryRecommendations: string[] = [];

      // Generic recommendations based on patterns
      if (stats.averageDuration > 2000) {
        queryRecommendations.push(
          'Consider adding database indexes for frequently queried columns'
        );
        queryRecommendations.push(
          'Review query complexity and consider breaking into smaller queries'
        );
      }

      if (stats.averageDuration > 1000) {
        queryRecommendations.push('Consider implementing query result caching');
        queryRecommendations.push('Review if all selected fields are necessary');
      }

      // Query-specific recommendations
      if (query.includes('findMany') && stats.averageDuration > 500) {
        queryRecommendations.push('Consider implementing pagination for large result sets');
        queryRecommendations.push('Add appropriate WHERE clauses to limit results');
      }

      if (query.includes('include') && stats.averageDuration > 800) {
        queryRecommendations.push('Review included relations - consider if all are necessary');
        queryRecommendations.push('Consider using select instead of include for specific fields');
      }

      if (queryRecommendations.length > 0) {
        recommendations.push({
          query,
          recommendations: queryRecommendations,
        });
      }
    }

    return recommendations;
  }

  // Clear metrics (useful for testing or periodic cleanup)
  clearMetrics(): void {
    this.queryMetrics.clear();
  }

  // Set slow query threshold
  setSlowQueryThreshold(threshold: number): void {
    this.slowQueryThreshold = threshold;
  }
}

// Singleton instance
export const queryOptimizer = new QueryOptimizer();

// Decorator for automatic query monitoring
export function monitorQuery(queryName: string) {
  return function (target: any, propertyName: string | symbol, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return queryOptimizer.measureQuery(
        `${target.constructor.name}.${propertyName}`,
        () => method.apply(this, args),
        args
      );
    };

    return descriptor;
  };
}

// Helper function for manual query monitoring
export async function withQueryMonitoring<T>(
export async function withQueryMonitoring<T, P = unknown>(
  queryName: string,
  queryFn: () => Promise<T>,
  params?: P
): Promise<T> {
  return queryOptimizer.measureQuery(queryName, queryFn, params);
}

export default queryOptimizer;
