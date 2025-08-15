import { logger } from './logger';

export interface ErrorContext {
  traceId?: string;
  userId?: string;
  endpoint?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown; // Index signature for logger compatibility
}

export class ApplicationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: ErrorContext;
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    statusCode: number = 500,
    context?: ErrorContext
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.timestamp = new Date();

    // Capture stack trace
    Error.captureStackTrace(this, ApplicationError);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'VALIDATION_ERROR', 400, context);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ApplicationError {
  constructor(resource: string, context?: ErrorContext) {
    super(`${resource} not found`, 'NOT_FOUND', 404, context);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message: string = 'Unauthorized', context?: ErrorContext) {
    super(message, 'UNAUTHORIZED', 401, context);
    this.name = 'UnauthorizedError';
  }
}

export class RateLimitError extends ApplicationError {
  constructor(context?: ErrorContext) {
    super('Too many requests', 'RATE_LIMIT_EXCEEDED', 429, context);
    this.name = 'RateLimitError';
  }
}

/**
 * Global error handler for unhandled errors
 */
export function setupGlobalErrorHandlers() {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception', error, {
      type: 'uncaughtException',
      fatal: true,
    });

    // Give time for logging before exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error(
      'Unhandled Promise Rejection',
      reason instanceof Error ? reason : new Error(String(reason)),
      {
        type: 'unhandledRejection',
        promise: promise.toString(),
      }
    );
  });

  // Handle process termination signals
  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`, { signal });

    // Add cleanup logic here (close database connections, etc.)
    setTimeout(() => {
      logger.info('Graceful shutdown completed');
      process.exit(0);
    }, 5000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

/**
 * Error reporting service (placeholder for services like Sentry)
 */
export class ErrorReporter {
  private static instance: ErrorReporter;

  static getInstance(): ErrorReporter {
    if (!ErrorReporter.instance) {
      ErrorReporter.instance = new ErrorReporter();
    }
    return ErrorReporter.instance;
  }

  reportError(error: Error, context?: ErrorContext): void {
    // Log locally
    logger.error('Error reported', error, context);

    // In production, this would send to an error tracking service
    if (process.env.NODE_ENV === 'production') {
      // Example: Sentry.captureException(error, { contexts: context });
      // Example: Rollbar.error(error, context);
      console.error('Production error reporting would happen here', {
        error: error.message,
        stack: error.stack,
        context,
      });
    }
  }

  reportMessage(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
    context?: ErrorContext
  ): void {
    logger.info(`Message reported: ${message}`, context);

    if (process.env.NODE_ENV === 'production') {
      // Example: Sentry.captureMessage(message, level);
      console.log('Production message reporting would happen here', {
        message,
        level,
        context,
      });
    }
  }
}

/**
 * Async error wrapper for safe async operations
 */
export function safeAsync<T>(
  fn: () => Promise<T>,
  fallback?: T,
  context?: ErrorContext
): Promise<T | undefined> {
  return fn().catch((error: unknown) => {
    const appError =
      error instanceof ApplicationError
        ? error
        : new ApplicationError(
            error instanceof Error ? error.message : String(error),
            'ASYNC_ERROR',
            500,
            context
          );

    ErrorReporter.getInstance().reportError(appError, context);

    return fallback;
  });
}

/**
 * Retry mechanism with exponential backoff
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000,
  context?: ErrorContext
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        break;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;

      logger.warn(`Operation failed, retrying in ${delay}ms`, {
        attempt,
        maxAttempts,
        delay,
        error: lastError.message,
        ...context,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new ApplicationError(
    `Operation failed after ${maxAttempts} attempts: ${lastError!.message}`,
    'RETRY_EXHAUSTED',
    500,
    { ...context, attempts: maxAttempts, finalError: lastError!.message }
  );
}
