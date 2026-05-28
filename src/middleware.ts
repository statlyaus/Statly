import { NextResponse, type NextRequest } from 'next/server';

import { isAuthBypassEnabled } from '@/lib/authBypass';

const protectedPrefixes = ['/dashboard', '/app', '/league'];

const isProtectedRoute = (pathname: string) =>
  protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export async function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const pathname = url.pathname;

  // Inject auth for API routes by verifying a bearer token
  if (pathname.startsWith('/api/')) {
    const auth = req.headers.get('authorization') || '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

    // Allow CORS preflight to pass (with headers)
    if (req.method === 'OPTIONS') {
      const origin = req.headers.get('origin') || '*';
      const headers = new Headers({
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      return new NextResponse(null, { status: 204, headers });
    }

    // Dev-only token format: dev:<userId>
    if (process.env.NODE_ENV !== 'production' && token && token.startsWith('dev:')) {
      const userId = token.slice(4);
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-auth-user', userId);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // In production, do not verify here (edge). Let route handlers verify session cookies server-side.
    return NextResponse.next();
  }

  if (!isProtectedRoute(pathname)) return NextResponse.next();

  if (isAuthBypassEnabled()) {
    return NextResponse.next();
  }

  const session = req.cookies.get('statly_session');
  if (!session) {
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/:path*',
    '/dashboard',
    '/dashboard/:path*',
    '/app',
    '/app/:path*',
    '/league',
    '/league/:path*',
  ],
};
