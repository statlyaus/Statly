import * as Sentry from '@sentry/react';

// Utility functions for Sentry operations

/**
 * Capture an error manually
 */
export const captureError = (error: Error, context?: Record<string, any>) => {
  Sentry.captureException(error, {
    contexts: context ? { custom: context } : undefined,
  });
};

/**
 * Capture a message
 */
export const captureMessage = (message: string, level: Sentry.SeverityLevel = 'info') => {
  Sentry.captureMessage(message, level);
};

/**
 * Set user context for better error tracking
 */
export const setUser = (user: {
  id: string;
  email?: string;
  username?: string;
  [key: string]: any;
}) => {
  Sentry.setUser(user);
};

/**
 * Clear user context
 */
export const clearUser = () => {
  Sentry.setUser(null);
};

/**
 * Add breadcrumb for better debugging
 */
export const addBreadcrumb = (
  message: string,
  category: string = 'ui',
  level: Sentry.SeverityLevel = 'info',
  data?: Record<string, any>
) => {
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
  });
};

/**
 * Set tag for better filtering in Sentry dashboard
 */
export const setTag = (key: string, value: string) => {
  Sentry.setTag(key, value);
};

/**
 * Set extra context data
 */
export const setExtra = (key: string, value: any) => {
  Sentry.setExtra(key, value);
};

/**
 * Start a performance transaction
 */
export const startTransaction = (
  name: string,
  operation: string,
  data?: Record<string, any>
) => {
  return Sentry.startTransaction({
    name,
    op: operation,
    data,
  });
};

/**
 * Get current Sentry hub for advanced operations
 */
export const getCurrentHub = () => {
  return Sentry.getCurrentHub();
};

export default Sentry;
