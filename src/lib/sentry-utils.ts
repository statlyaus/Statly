import {
  getSentryClient,
  type SentryClient,
} from '@/lib/sentry/clientInstrumentation';

type SentryLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

function withSentryClient(operation: (sentry: SentryClient) => void): void {
  const sentryClient = getSentryClient();
  if (!sentryClient) return;
  operation(sentryClient);
}

/**
 * Capture an error manually
 */
export const captureError = (error: unknown, context?: Record<string, unknown>): void => {
  withSentryClient((sentry) => {
    sentry.captureException(error, {
      contexts: context ? { custom: context } : undefined,
    });
  });
};

export const captureException = captureError;

/**
 * Capture a message
 */
export const captureMessage = (message: string, level: SentryLevel = 'info'): void => {
  withSentryClient((sentry) => {
    sentry.captureMessage(message, level);
  });
};

/**
 * Set user context for better error tracking
 */
export const setUser = (user: {
  id: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}): void => {
  withSentryClient((sentry) => {
    sentry.setUser(user);
  });
};

/**
 * Clear user context
 */
export const clearUser = (): void => {
  withSentryClient((sentry) => {
    sentry.setUser(null);
  });
};

/**
 * Add breadcrumb for better debugging
 */
export const addBreadcrumb = (
  message: string,
  category: string = 'ui',
  level: SentryLevel = 'info',
  data?: Record<string, unknown>
): void => {
  withSentryClient((sentry) => {
    sentry.addBreadcrumb({
      message,
      category,
      level,
      data,
    });
  });
};

/**
 * Set tag for better filtering in Sentry dashboard
 */
export const setTag = (key: string, value: string): void => {
  withSentryClient((sentry) => {
    sentry.setTag(key, value);
  });
};

/**
 * Set extra context data
 */
export const setExtra = (key: string, value: unknown): void => {
  withSentryClient((sentry) => {
    sentry.setExtra(key, value);
  });
};
