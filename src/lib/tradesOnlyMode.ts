/**
 * Trades-only mode (owner, 2026-11-16): the AFL trade pages go live before fantasy, on a deployment
 * with no fantasy database, Redis or sign-in. With `STATLY_TRADES_ONLY=true` the proxy answers only the
 * home page, the AFL and draft-record pages, the legal pages, public files and the two APIs those
 * pages use. Every other page and API is not found, so nobody is sent to a sign-in that cannot work.
 * Unset (the default everywhere else) changes nothing.
 */

const PAGE_PREFIXES = ['/afl', '/draft', '/privacy', '/terms', '/data-deletion'] as const;
const API_PREFIXES = ['/api/admin/afl-trade-story-bundle', '/api/draft-trades'] as const;
const PUBLIC_FILE_FOLDERS = ['/brand', '/Assets', '/logos'] as const;

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isTradesOnlyMode(environment: { STATLY_TRADES_ONLY?: string }): boolean {
  return environment.STATLY_TRADES_ONLY?.trim().toLowerCase() === 'true';
}

/** Whether a request path is served in trades-only mode. */
export function isServedInTradesOnlyMode(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return API_PREFIXES.some((prefix) => under(pathname, prefix));
  if (pathname === '/') return true;
  // Public files and generated metadata live at the root (/favicon.svg, /robots.txt) or in the
  // public folders (/brand/logo.png). A deeper path that only ends like a file name
  // (/leagues/x.png) is a fantasy page, not a file.
  if (/\.[a-z0-9]{2,5}$/iu.test(pathname)) {
    return (
      pathname.lastIndexOf('/') === 0 ||
      PUBLIC_FILE_FOLDERS.some((folder) => pathname.startsWith(`${folder}/`))
    );
  }
  return PAGE_PREFIXES.some((prefix) => under(pathname, prefix));
}
