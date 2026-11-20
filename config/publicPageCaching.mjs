// Netlify CDN caching for the public pages (owner, 2026-11-18). They show the same thing to every
// visitor and change only when a deploy changes the code or the approved trade bundle, and every
// deploy purges Netlify's cache. Uncached, every visit, crawler hit and link prefetch rendered in a
// function, which spent the free plan's monthly credits in two days.

const PUBLIC_PAGE_SOURCES = [
  '/',
  '/afl/:path*',
  '/draft/:path*',
  '/privacy',
  '/terms',
  '/data-deletion',
  '/sitemap.xml',
];

// One hour at the CDN, then served stale for up to a day while one request renders a fresh copy.
// An hour also bounds how long a transient "trades unavailable" page can stick.
export const PUBLIC_PAGE_CDN_CACHE_CONTROL =
  'public, durable, s-maxage=3600, stale-while-revalidate=86400';

/** Header rules for `next.config.mjs`. The browser's own Cache-Control is left as Next.js sets it. */
export function buildPublicPageCachingHeaders() {
  return PUBLIC_PAGE_SOURCES.map((source) => ({
    source,
    headers: [
      { key: 'Netlify-CDN-Cache-Control', value: PUBLIC_PAGE_CDN_CACHE_CONTROL },
      // Filters such as ?club= and ?year= change the page. Netlify's Next.js runtime otherwise keys
      // the cache on its own router parameters only, so this makes every query string its own entry.
      { key: 'Netlify-Vary', value: 'query' },
    ],
  }));
}
