/**
 * Sustainable Error Handling Utilities
 * 
 * This module provides utilities for handling errors in a sustainable way,
 * ensuring that non-critical failures are logged but don't break the main flow.
 */

import { logger } from '@/lib/logger';

/**
 * Execute a fire-and-forget operation with proper error logging
 * These operations should not fail the main flow but should be logged for debugging
 */
export async function executeSafely<T>(
  operation: () => Promise<T> | T,
  operationName: string,
  context: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    logger.warn(`Non-critical operation failed: ${operationName}`, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      operation: operationName,
    });
    return null;
  }
}

/**
 * Execute a fire-and-forget operation that returns void
 * Use this when you don't need the return value
 */
export async function executeSafelyVoid(
  operation: () => Promise<unknown> | unknown,
  operationName: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    logger.warn(`Non-critical operation failed: ${operationName}`, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      operation: operationName,
    });
  }
}

/**
 * Create a safe catch handler for Promise.catch() calls
 * Use this instead of .catch(() => undefined) for better observability
 */
export function createSafeCatch(
  operationName: string,
  context: Record<string, unknown> = {}
): (error: unknown) => void {
  return (error: unknown) => {
    logger.warn(`Non-critical operation failed: ${operationName}`, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      operation: operationName,
    });
  };
}

/**
 * Execute a database operation that might fail due to missing tables/schema
 * Use this for operations that are optional or have fallbacks
 */
export async function executeDbSafely<T>(
  operation: () => Promise<T> | T,
  operationName: string,
  context: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check if this is a schema/table missing error
    if (errorMessage.includes('doesn\'t exist') || 
        errorMessage.includes('relation') ||
        errorMessage.includes('table') ||
        errorMessage.includes('column')) {
      logger.debug(`Schema operation skipped: ${operationName}`, {
        ...context,
        reason: 'schema_not_ready',
        operation: operationName,
      });
    } else {
      logger.warn(`Database operation failed: ${operationName}`, {
        ...context,
        error: errorMessage,
        operation: operationName,
      });
    }
    return null;
  }
}

/**
 * Execute a network/API operation that might fail due to external factors
 * Use this for operations that are optional or have fallbacks
 */
export async function executeNetworkSafely<T>(
  operation: () => Promise<T> | T,
  operationName: string,
  context: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check if this is a network-related error
    if (errorMessage.includes('network') || 
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND')) {
      logger.debug(`Network operation failed: ${operationName}`, {
        ...context,
        reason: 'network_error',
        error: errorMessage,
        operation: operationName,
      });
    } else {
      logger.warn(`External operation failed: ${operationName}`, {
        ...context,
        error: errorMessage,
        operation: operationName,
      });
    }
    return null;
  }
}

/**
 * Legacy compatibility: Convert old .catch(() => undefined) patterns
 * Use this to gradually migrate existing code
 */
export function safeCatch<T extends Promise<unknown>>(
  promise: T,
  operationName: string,
  context: Record<string, unknown> = {}
): T {
  return promise.catch(createSafeCatch(operationName, context)) as T;
}

/**
 * Custom error class for application-specific errors with status codes
 */
export class ApplicationError extends Error {
  constructor(
    message: string, 
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
