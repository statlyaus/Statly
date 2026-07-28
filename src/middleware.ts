import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/authConstants';
import {
  DEVELOPMENT_AUTH_COOKIE,
  DEVELOPMENT_AUTH_USER_ID,
  isServerDevelopmentAuthEnabled,
} from '@/lib/devAuth';
import { isSameOriginRequest } from '@/lib/requestOrigin';

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  const match = authorization?.trim().match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/**
 * Perform optimistic routing checks only. Protected server loaders and API handlers remain
 * responsible for verifying the credential before reading or mutating data.
 */
export function middleware(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin');
      if (!origin || !isSameOriginRequest(request)) {
        return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
      }

      const headers = new Headers({
        'Access-Control-Allow-Origin': new URL(origin).origin,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      return new NextResponse(null, { status: 204, headers });
    }

    const token = getBearerToken(request);
    if (isServerDevelopmentAuthEnabled() && token?.startsWith('dev:')) {
      const userId = token.slice('dev:'.length);
      if (userId === DEVELOPMENT_AUTH_USER_ID) {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-auth-user', userId);
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
    }

    return NextResponse.next();
  }

  const protectedPrefixes = ['/dashboard', '/app', '/league', '/leagues'];
  const isProtected = protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-statly-request-path', `${pathname}${request.nextUrl.search}`);

  if (!isProtected) return NextResponse.next({ request: { headers: requestHeaders } });

  const hasBearerToken = Boolean(getBearerToken(request));
  const hasLegacySession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const hasDevelopmentSession =
    isServerDevelopmentAuthEnabled() &&
    request.cookies.get(DEVELOPMENT_AUTH_COOKIE)?.value === DEVELOPMENT_AUTH_USER_ID;

  if (!hasBearerToken && !hasLegacySession && !hasDevelopmentSession) {
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/api/:path*', '/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
