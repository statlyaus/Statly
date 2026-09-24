import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';

/**
 * Authentication for the administrative control plane.
 *
 * These routes mutate shared operational state (the draft queue and the worker pool) rather than
 * league data, so they authenticate an operator secret instead of a Firebase identity. The
 * operator secret is the same credential already used by other administrative boundaries.
 *
 * The check fails closed. When ADMIN_SECRET is absent no caller is authorized, because an unset
 * secret must never leave a destructive endpoint reachable.
 */
export const ADMIN_SECRET_HEADER = 'x-admin-secret';

export function isAdminRequest(request: NextRequest): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return false;

  return request.headers.get(ADMIN_SECRET_HEADER) === expected;
}

export function adminForbiddenResponse(request: NextRequest): NextResponse {
  logger.warn('Rejected unauthenticated administrative request', {
    path: request.nextUrl.pathname,
    method: request.method,
    adminSecretConfigured: Boolean(process.env.ADMIN_SECRET),
  });

  return errorResponse('Forbidden', 403, 'FORBIDDEN');
}
