type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  sessionId?: string;
  userId?: string;
  requestId?: string;
  component?: string;
  action?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private isTest = process.env.NODE_ENV === 'test';
  private sessionId: string;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 100;
  private envMinLevel: LogLevel | null = ((): LogLevel | null => {
    const raw = process.env.LOG_LEVEL?.toLowerCase();
    return raw && raw in LEVELS ? (raw as LogLevel) : null;
  })();

  constructor() {
    this.sessionId = this.generateSessionId();

    // Flush logs periodically in production (browser only)
    if (!this.isDevelopment && typeof (globalThis as any).window !== 'undefined') {
      setInterval(() => this.flushLogs(), 30000); // Every 30 seconds
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error | unknown
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      sessionId: this.sessionId,
    };

    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  private formatMessage(entry: LogEntry): string {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const errorStr = entry.error ? ` ERROR: ${entry.error.message}` : '';
    return `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}${contextStr}${errorStr}`;
  }

  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);

    // Keep buffer size manageable
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer = this.logBuffer.slice(-this.maxBufferSize);
    }
  }

  private async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    try {
      const logs = [...this.logBuffer];
      this.logBuffer = [];

      // Send logs to server in production
      if (!this.isDevelopment) {
        await fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logs }),
        });
      }
    } catch (error) {
      // Silently fail - don't impact user experience
      console.warn('Failed to flush logs:', error);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.isTest) return false;

    // Determine minimum level: LOG_LEVEL override if provided, otherwise debug in dev, info in prod
    const envLevel = this.envMinLevel ? LEVELS[this.envMinLevel] : null;
    const defaultLevel = this.isDevelopment ? LEVELS.debug : LEVELS.info;
    const minLevel = envLevel ?? defaultLevel;
    return LEVELS[level] >= minLevel;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      const entry = this.createLogEntry('debug', message, context);
      console.log(this.formatMessage(entry));
      this.addToBuffer(entry);
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      const entry = this.createLogEntry('info', message, context);
      console.info(this.formatMessage(entry));
      this.addToBuffer(entry);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      const entry = this.createLogEntry('warn', message, context);
      console.warn(this.formatMessage(entry));
      this.addToBuffer(entry);
    }
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (this.shouldLog('error')) {
      const entry = this.createLogEntry('error', message, context, error);
      console.error(this.formatMessage(entry));
      this.addToBuffer(entry);
    }
  }

  // Convenience methods for common patterns
  apiRequest(method: string, path: string, context?: LogContext): void {
    this.info(`API ${method} ${path}`, { ...context, component: 'api', action: 'request' });
  }

  apiError(method: string, path: string, error: Error | unknown, context?: LogContext): void {
    this.error(`API ${method} ${path} failed`, error, {
      ...context,
      component: 'api',
      action: 'error',
    });
  }

  performanceWarn(operation: string, duration: number, threshold = 1000): void {
    if (duration > threshold) {
      this.warn(`Slow operation detected: ${operation}`, {
        duration,
        threshold,
        component: 'performance',
        action: 'slow_operation',
      });
    }
  }

  // Component-specific logging
  componentMount(componentName: string, props?: Record<string, unknown>): void {
    this.debug(`Component mounted: ${componentName}`, {
      component: componentName,
      action: 'mount',
      props,
    });
  }

  componentUnmount(componentName: string): void {
    this.debug(`Component unmounted: ${componentName}`, {
      component: componentName,
      action: 'unmount',
    });
  }

  userAction(action: string, details?: LogContext): void {
    this.info(`User action: ${action}`, {
      ...details,
      component: 'user_interaction',
      action,
    });
  }

  // Database operations
  dbQuery(query: string, duration?: number, context?: LogContext): void {
    this.debug(`Database query executed`, {
      ...context,
      query,
      duration,
      component: 'database',
      action: 'query',
    });
  }

  dbError(query: string, error: Error | unknown, context?: LogContext): void {
    this.error(`Database query failed`, error, {
      ...context,
      query,
      component: 'database',
      action: 'error',
    });
  }

  // Authentication events
  authSuccess(userId: string, method: string): void {
    this.info(`Authentication successful`, {
      userId,
      method,
      component: 'auth',
      action: 'success',
    });
  }

  authFailure(reason: string, context?: LogContext): void {
    this.warn(`Authentication failed`, {
      ...context,
      reason,
      component: 'auth',
      action: 'failure',
    });
  }

  // Business logic events
  businessEvent(event: string, details?: LogContext): void {
    this.info(`Business event: ${event}`, {
      ...details,
      component: 'business',
      action: event,
    });
  }

  // Get logs for debugging
  getLogs(): LogEntry[] {
    return [...this.logBuffer];
  }

  // Clear logs
  clearLogs(): void {
    this.logBuffer = [];
  }

  // Force flush logs
  async forceFLush(): Promise<void> {
    await this.flushLogs();
  }
}

export const logger = new Logger();

// Development-only performance timer
export function withTiming<T>(operation: string, fn: () => T | Promise<T>): T | Promise<T> {
  if (process.env.NODE_ENV !== 'development') {
    return fn();
  }

  const start = (globalThis as any).performance?.now?.() ?? Date.now();
  const result = fn();

  if (result instanceof Promise) {
    return result.finally(() => {
      const end = (globalThis as any).performance?.now?.() ?? Date.now();
      const duration = end - start;
      logger.performanceWarn(operation, duration);
    });
  } else {
    const end = (globalThis as any).performance?.now?.() ?? Date.now();
    const duration = end - start;
    logger.performanceWarn(operation, duration);
    return result;
  }
}
