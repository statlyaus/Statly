import { NextResponse, type NextRequest } from 'next/server';

// Example protected route enforcement placeholder.
// If you move to server-verified Firebase sessions, replace the stub with real checks.
export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();

  // List of protected route prefixes (customize to your app)
  const protectedPrefixes = ['/dashboard', '/app', '/league'];
  const isProtected = protectedPrefixes.some((p) => url.pathname.startsWith(p));

  if (!isProtected) return NextResponse.next();

  // Read a session cookie set by server after verifying Firebase ID token
  const session = req.cookies.get('statly_session');
  if (!session) {
    url.pathname = '/login';
    url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Optionally: verify/refresh session via a lightweight endpoint if needed
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/app/:path*', '/league/:path*'],
};
