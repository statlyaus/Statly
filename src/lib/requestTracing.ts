import type { NextRequest } from 'next/server';
import { logger } from './logger';

export interface RequestTrace {
  traceId: string;
  method: string;
  url: string;
  userAgent?: string;
  ip?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  statusCode?: number;
  userId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// Generate a unique trace ID
function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Get client IP from request
function getClientIP(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : 'unknown';
}

/**
 * Request tracer for API routes
 */
export class RequestTracer {
  private trace: RequestTrace;

  constructor(req: NextRequest, metadata?: Record<string, unknown>) {
    this.trace = {
      traceId: generateTraceId(),
      method: req.method,
      url: req.url,
      userAgent: req.headers.get('user-agent') || undefined,
      ip: getClientIP(req),
      startTime: Date.now(),
      metadata,
    };

    // Log request start
    logger.info('Request started', {
      traceId: this.trace.traceId,
      method: this.trace.method,
      url: this.trace.url,
      ip: this.trace.ip,
      userAgent: this.trace.userAgent,
      ...metadata,
    });
  }

  /**
   * Add metadata to the trace
   */
  addMetadata(metadata: Record<string, unknown>): void {
    this.trace.metadata = { ...this.trace.metadata, ...metadata };
  }

  /**
   * Set user ID for the trace
   */
  setUserId(userId: string): void {
    this.trace.userId = userId;
  }

  /**
   * Complete the trace with success
   */
  complete(statusCode: number, additionalMetadata?: Record<string, unknown>): void {
    this.trace.endTime = Date.now();
    this.trace.duration = this.trace.endTime - this.trace.startTime;
    this.trace.statusCode = statusCode;

    if (additionalMetadata) {
      this.addMetadata(additionalMetadata);
    }

    logger.info('Request completed', {
      traceId: this.trace.traceId,
      method: this.trace.method,
      url: this.trace.url,
      statusCode: this.trace.statusCode,
      duration: this.trace.duration,
      userId: this.trace.userId,
      ...this.trace.metadata,
    });
  }

  /**
   * Complete the trace with error
   */
  error(error: Error | string, statusCode: number = 500, additionalMetadata?: Record<string, unknown>): void {
    this.trace.endTime = Date.now();
    this.trace.duration = this.trace.endTime - this.trace.startTime;
    this.trace.statusCode = statusCode;
    this.trace.error = error instanceof Error ? error.message : error;

    if (additionalMetadata) {
      this.addMetadata(additionalMetadata);
    }

    logger.error('Request failed', error instanceof Error ? error : new Error(error), {
      traceId: this.trace.traceId,
      method: this.trace.method,
      url: this.trace.url,
      statusCode: this.trace.statusCode,
      duration: this.trace.duration,
      userId: this.trace.userId,
      ...this.trace.metadata,
    });
  }

  /**
   * Get the current trace data
   */
  getTrace(): RequestTrace {
    return { ...this.trace };
  }

  /**
   * Get the trace ID for correlation
   */
  getTraceId(): string {
    return this.trace.traceId;
  }

  /**
   * Add trace ID to response headers
   */
  getTraceHeaders(): Record<string, string> {
    return {
      'X-Trace-Id': this.trace.traceId,
    };
  }
}

/**
 * Middleware to automatically trace requests
 */
export function withRequestTracing(
  req: NextRequest,
  metadata?: Record<string, unknown>
): RequestTracer {
  return new RequestTracer(req, metadata);
}

/**
 * Performance timing helper
 */
export class PerformanceTimer {
  private timers: Map<string, number> = new Map();
  private tracer?: RequestTracer;

  constructor(tracer?: RequestTracer) {
    this.tracer = tracer;
  }

  /**
   * Start a timer
   */
  start(name: string): void {
    this.timers.set(name, Date.now());
  }

  /**
   * End a timer and return duration
   */
  end(name: string): number {
    const startTime = this.timers.get(name);
    if (!startTime) {
      throw new Error(`Timer '${name}' was not started`);
    }

    const duration = Date.now() - startTime;
    this.timers.delete(name);

    if (this.tracer) {
      this.tracer.addMetadata({ [`${name}_duration`]: duration });
    }

    return duration;
  }

  /**
   * Measure a function execution time
   */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      const result = await fn();
      const duration = this.end(name);
      
      logger.debug(`Performance: ${name} completed in ${duration}ms`, {
        operation: name,
        duration,
        traceId: this.tracer?.getTraceId(),
      });
      
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * Get all timing data
   */
  getTimings(): Record<string, number> {
    const timings: Record<string, number> = {};
    const now = Date.now();
    
    for (const [name, startTime] of this.timers.entries()) {
      timings[name] = now - startTime;
    }
    
    return timings;
  }
}

/**
 * Database query tracer
 */
export interface DatabaseQuery {
  collection: string;
  operation: string;
  query?: Record<string, unknown>;
  duration?: number;
  resultCount?: number;
  error?: string;
}

export class DatabaseTracer {
  private queries: DatabaseQuery[] = [];
  private tracer?: RequestTracer;

  constructor(tracer?: RequestTracer) {
    this.tracer = tracer;
  }

  /**
   * Log a database query
   */
  logQuery(query: DatabaseQuery): void {
    this.queries.push(query);
    
    if (this.tracer) {
      this.tracer.addMetadata({
        databaseQueries: this.queries.length,
        lastQuery: query,
      });
    }

    logger.debug('Database query executed', {
      traceId: this.tracer?.getTraceId(),
      ...query,
    });
  }

  /**
   * Get all queries for this request
   */
  getQueries(): DatabaseQuery[] {
    return [...this.queries];
  }

  /**
   * Get query statistics
   */
  getStats(): {
    totalQueries: number;
    totalDuration: number;
    averageDuration: number;
    slowQueries: DatabaseQuery[];
  } {
    const totalQueries = this.queries.length;
    const totalDuration = this.queries.reduce((sum, q) => sum + (q.duration || 0), 0);
    const averageDuration = totalQueries > 0 ? totalDuration / totalQueries : 0;
    const slowQueries = this.queries.filter(q => (q.duration || 0) > 100); // >100ms

    return {
      totalQueries,
      totalDuration,
      averageDuration,
      slowQueries,
    };
  }
}
