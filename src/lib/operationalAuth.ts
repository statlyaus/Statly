import { NextResponse, type NextRequest } from 'next/server';

type AuthorizationResult = { ok: true } | { ok: false; response: NextResponse };

interface TokenAuthorizationOptions {
  secret: string | undefined;
  headerName: string;
  allowLocalWithoutSecret: boolean;
  missingSecretMessage: string;
}

function isExplicitLocalRuntime(): boolean {
  if (process.env.STATLY_RUNTIME_ENV === 'local') return true;
  return process.env.NODE_ENV === 'development' && !process.env.VERCEL_ENV;
}

function denied(message: string, status = 401): AuthorizationResult {
  return {
    ok: false,
    response: NextResponse.json({ success: false, error: message }, { status }),
  };
}

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

function tokenFromRequest(request: NextRequest, headerName: string): string | null {
  return request.headers.get(headerName)?.trim() || bearerToken(request);
}

function authorizeTokenRequest(
  request: NextRequest,
  options: TokenAuthorizationOptions
): AuthorizationResult {
  const secret = options.secret?.trim();
  if (!secret) {
    return options.allowLocalWithoutSecret && isExplicitLocalRuntime()
      ? { ok: true }
      : denied(options.missingSecretMessage);
  }

  return tokenFromRequest(request, options.headerName) === secret
    ? { ok: true }
    : denied('Unauthorized');
}

export function authorizeAdminRequest(request: NextRequest): AuthorizationResult {
  return authorizeTokenRequest(request, {
    secret: process.env.ADMIN_API_TOKEN,
    headerName: 'x-admin-token',
    allowLocalWithoutSecret: true,
    missingSecretMessage: 'Admin token is not configured',
  });
}

export function authorizeCronRequest(request: NextRequest): AuthorizationResult {
  return authorizeTokenRequest(request, {
    secret: process.env.CRON_SECRET,
    headerName: 'x-cron-token',
    allowLocalWithoutSecret: true,
    missingSecretMessage: 'Cron token is not configured',
  });
}

export function authorizeLocalOnlyRequest(): AuthorizationResult {
  return isExplicitLocalRuntime() ? { ok: true } : denied('Not found', 404);
}
