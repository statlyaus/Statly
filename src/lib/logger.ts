type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private isTest = process.env.NODE_ENV === 'test';

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.isTest) return false;

    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    const minLevel = this.isDevelopment ? 0 : 1; // debug in dev, info+ in prod
    return levels[level] >= minLevel;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (this.shouldLog('error')) {
      const errorContext = {
        ...context,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
      };
      console.error(this.formatMessage('error', message, errorContext));
    }
  }

  // Convenience methods for common patterns
  apiRequest(method: string, path: string, context?: LogContext): void {
    this.info(`API ${method} ${path}`, context);
  }

  apiError(method: string, path: string, error: Error | unknown, context?: LogContext): void {
    this.error(`API ${method} ${path} failed`, error, context);
  }

  performanceWarn(operation: string, duration: number, threshold = 1000): void {
    if (duration > threshold) {
      this.warn(`Slow operation detected: ${operation}`, { duration, threshold });
    }
  }
}

export const logger = new Logger();

// Development-only performance timer
export function withTiming<T>(operation: string, fn: () => T | Promise<T>): T | Promise<T> {
  if (process.env.NODE_ENV !== 'development') {
    return fn();
  }

  const start = performance.now();
  const result = fn();

  if (result instanceof Promise) {
    return result.finally(() => {
      const duration = performance.now() - start;
      logger.performanceWarn(operation, duration);
    });
  } else {
    const duration = performance.now() - start;
    logger.performanceWarn(operation, duration);
    return result;
  }
}
