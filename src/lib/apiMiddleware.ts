import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withRequestTracing, type RequestTracer } from './requestTracing';
import { withRateLimit, rateLimitConfigs } from './rateLimit';
import { logger } from './logger';
import { commonErrors } from './apiResponse';
import { ApplicationError } from './errorHandling';

export interface MiddlewareConfig {
  rateLimit?: {
    enabled: boolean;
    config?: keyof typeof rateLimitConfigs;
  };
  tracing?: {
    enabled: boolean;
    metadata?: Record<string, unknown>;
  };
  auth?: {
    required: boolean;
    allowedRoles?: string[];
  };
  validation?: {
    enabled: boolean;
  };
  caching?: {
    enabled: boolean;
    ttl?: number;
  };
}

export interface MiddlewareContext {
  req: NextRequest;
  tracer: RequestTracer;
  startTime: number;
  user?: {
    id: string;
    email?: string;
    roles?: string[];
  };
}

export type APIHandler = (context: MiddlewareContext) => Promise<NextResponse>;

/**
 * Authentication middleware
 */
async function authMiddleware(
  context: MiddlewareContext,
  config: MiddlewareConfig['auth']
): Promise<boolean> {
  if (!config?.required) return true;

  const authHeader = context.req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    context.tracer.error('Missing authentication token', 401);
    return false;
  }

  try {
    // In a real app, verify the token with your auth service
    // const decoded = await verifyToken(token);
    // context.user = decoded;

    // For now, just log that auth was attempted
    logger.debug('Authentication attempted', {
      traceId: context.tracer.getTraceId(),
      hasToken: !!token,
    });

    return true;
  } catch (_error) {
    context.tracer.error('Authentication failed', 401);
    return false;
  }
}

/**
 * Validation middleware
 */
function validationMiddleware(
  context: MiddlewareContext,
  config: MiddlewareConfig['validation']
): boolean {
  if (!config?.enabled) return true;

  // Add request validation logic here
  const contentType = context.req.headers.get('content-type');

  if (context.req.method === 'POST' || context.req.method === 'PUT') {
    if (!contentType?.includes('application/json')) {
      context.tracer.error('Invalid content type', 400);
      return false;
    }
  }

  return true;
}

/**
 * Comprehensive API middleware factory
 */
export function createAPIMiddleware(config: MiddlewareConfig = {}) {
  return function withMiddleware(handler: APIHandler) {
    return async function (req: NextRequest): Promise<NextResponse> {
      const startTime = Date.now();

      // Initialize tracing
      const tracer =
        config.tracing?.enabled !== false
          ? withRequestTracing(req, {
              endpoint: req.url.split('/').pop(),
              ...config.tracing?.metadata,
            })
          : withRequestTracing(req);

      const context: MiddlewareContext = {
        req,
        tracer,
        startTime,
      };

      try {
        // Rate limiting
        if (config.rateLimit?.enabled !== false) {
          const rateLimitConfig = config.rateLimit?.config || 'api';
          const rateLimitResult = withRateLimit(rateLimitConfigs[rateLimitConfig])(req);

          if (!rateLimitResult.success) {
            tracer.error('Rate limit exceeded', 429);
            return NextResponse.json(rateLimitResult.body, {
              status: rateLimitResult.status,
              headers: { ...rateLimitResult.headers, ...tracer.getTraceHeaders() },
            });
          }
        }

        // Validation
        if (!validationMiddleware(context, config.validation)) {
          return commonErrors.badRequest('Invalid request format');
        }

        // Authentication
        if (!(await authMiddleware(context, config.auth))) {
          return commonErrors.unauthorized();
        }

        // Execute the main handler
        const response = await handler(context);

        // Add trace headers to response
        const headers = tracer.getTraceHeaders();
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });

        const duration = Date.now() - startTime;
        tracer.complete(response.status, { duration });

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;

        if (error instanceof ApplicationError) {
          tracer.error(error, error.statusCode, { duration });

          return NextResponse.json(
            {
              success: false,
              error: {
                message: error.message,
                code: error.code,
              },
              timestamp: new Date().toISOString(),
            },
            {
              status: error.statusCode,
              headers: tracer.getTraceHeaders(),
            }
          );
        }

        tracer.error(error instanceof Error ? error : new Error(String(error)), 500, { duration });

        return NextResponse.json(
          {
            success: false,
            error: {
              message: 'Internal server error',
              code: 'INTERNAL_ERROR',
            },
            timestamp: new Date().toISOString(),
          },
          {
            status: 500,
            headers: tracer.getTraceHeaders(),
          }
        );
      }
    };
  };
}

/**
 * Predefined middleware configurations
 */
export const middlewareConfigs = {
  // Public endpoints (no auth, generous rate limits)
  public: createAPIMiddleware({
    rateLimit: { enabled: true, config: 'public' },
    tracing: { enabled: true },
    auth: { required: false },
    validation: { enabled: true },
  }),

  // Private endpoints (auth required, standard rate limits)
  private: createAPIMiddleware({
    rateLimit: { enabled: true, config: 'api' },
    tracing: { enabled: true },
    auth: { required: true },
    validation: { enabled: true },
  }),

  // Admin endpoints (auth + role check, strict rate limits)
  admin: createAPIMiddleware({
    rateLimit: { enabled: true, config: 'auth' },
    tracing: { enabled: true },
    auth: { required: true, allowedRoles: ['admin'] },
    validation: { enabled: true },
  }),

  // Heavy operations (very strict rate limits)
  heavy: createAPIMiddleware({
    rateLimit: { enabled: true, config: 'heavy' },
    tracing: { enabled: true },
    auth: { required: true },
    validation: { enabled: true },
  }),

  // No middleware (for health checks, etc.)
  none: createAPIMiddleware({
    rateLimit: { enabled: false },
    tracing: { enabled: true },
    auth: { required: false },
    validation: { enabled: false },
  }),
};

/**
 * Helper to create a standardized API response
 */
export function createResponse<T>(
  data: T,
  status: number = 200,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    },
    { status, headers }
  );
}
