import { NextResponse } from 'next/server';
import { logger } from './logger';

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    [key: string]: unknown;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
  timestamp: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Creates a standardized success response
 */
export function createSuccessResponse<T>(
  data: T,
  meta?: ApiSuccessResponse<T>['meta']
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    ...(meta && { meta }),
  };
}

/**
 * Creates a standardized error response
 */
export function createErrorResponse(
  message: string,
  code?: string,
  details?: Record<string, unknown>
): ApiErrorResponse {
  return {
    success: false,
    error: {
      message,
      ...(code && { code }),
      ...(details && { details }),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns a standardized success NextResponse
 */
export function successResponse<T>(
  data: T,
  status = 200,
  meta?: ApiSuccessResponse<T>['meta']
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(createSuccessResponse(data, meta), { status });
}

/**
 * Returns a standardized error NextResponse with logging
 */
export function errorResponse(
  message: string,
  status = 500,
  code?: string,
  details?: Record<string, unknown>
): NextResponse<ApiErrorResponse> {
  const response = createErrorResponse(message, code, details);

  if (status >= 500) {
    logger.error(`API Error (${status}): ${message}`, undefined, { code, details });
  }

  return NextResponse.json(response, { status });
}

/**
 * Common error responses
 */
export const commonErrors = {
  badRequest: (message = 'Bad Request', details?: Record<string, unknown>) =>
    errorResponse(message, 400, 'BAD_REQUEST', details),

  unauthorized: (message = 'Unauthorized') => errorResponse(message, 401, 'UNAUTHORIZED'),

  forbidden: (message = 'Forbidden') => errorResponse(message, 403, 'FORBIDDEN'),

  notFound: (message = 'Not Found') => errorResponse(message, 404, 'NOT_FOUND'),

  methodNotAllowed: (message = 'Method Not Allowed') =>
    errorResponse(message, 405, 'METHOD_NOT_ALLOWED'),

  unprocessableEntity: (message = 'Validation Error', details?: Record<string, unknown>) =>
    errorResponse(message, 422, 'VALIDATION_ERROR', details),

  tooManyRequests: (message = 'Too Many Requests') => errorResponse(message, 429, 'RATE_LIMIT'),

  internalServerError: (message = 'Internal Server Error', error?: Record<string, unknown>) =>
    errorResponse(message, 500, 'INTERNAL_ERROR', error),

  serviceUnavailable: (message = 'Service Unavailable') =>
    errorResponse(message, 503, 'SERVICE_UNAVAILABLE'),
};

/**
 * Wraps an API handler with error handling and logging
 */
export function withApiHandler<T>(
  handler: () => Promise<T>,
  operation: string
): Promise<NextResponse<ApiSuccessResponse<T> | ApiErrorResponse>> {
  return handler()
    .then((data) => successResponse(data))
    .catch((error) => {
      logger.apiError('unknown', operation, error);

      if (error instanceof Error) {
        return commonErrors.internalServerError(error.message, {
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        });
      }

      return commonErrors.internalServerError('An unexpected error occurred');
    });
}
