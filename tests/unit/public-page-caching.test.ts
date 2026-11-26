import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { describe, expect, it } from 'vitest';

import {
  buildPublicPageCachingHeaders,
  PUBLIC_PAGE_CDN_CACHE_CONTROL,
} from '../../config/publicPageCaching.mjs';

/**
 * The public pages are cached at Netlify's CDN so visits, crawlers and link prefetches stop
 * rendering in a function each time. Only anonymous public pages may be cached.
 */

const rules = buildPublicPageCachingHeaders();

// The same matcher options Next.js uses for `headers()` sources.
const headersFor = (pathname: string) =>
  rules
    .filter(
      (rule) =>
        getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname) !== false
    )
    .flatMap((rule) => rule.headers);

describe('public page CDN caching', () => {
  it.each([
    '/',
    '/afl',
    '/afl/trades',
    '/afl/trades/method',
    '/afl/trades/general-managers',
    '/afl/trades/external-transaction:40cb6950',
    '/afl/trades/clubs/fremantle',
    '/afl/trades/external-transaction:40cb6950/share-card',
    '/afl/stories/jeremy-cameron',
    '/draft',
    '/draft/trades',
    '/draft/drafts/2019',
    '/draft/clubs/geelong',
    '/draft/outcomes/methodology',
    '/privacy',
    '/terms',
    '/data-deletion',
    '/sitemap.xml',
  ])('caches %s at the CDN, keyed on its query string', (pathname) => {
    expect(headersFor(pathname)).toEqual([
      { key: 'Netlify-CDN-Cache-Control', value: PUBLIC_PAGE_CDN_CACHE_CONTROL },
      { key: 'Netlify-Vary', value: 'query' },
    ]);
  });

  it.each([
    '/api/draft-trades',
    '/api/admin/afl-trade-story-bundle',
    '/api/cron/trades',
    '/dashboard',
    '/league/abc',
    '/login',
    '/aflx',
    '/drafts/create',
  ])('never caches %s', (pathname) => {
    expect(headersFor(pathname)).toEqual([]);
  });

  it('lets the shared cache store the page, but only for a bounded time', () => {
    expect(PUBLIC_PAGE_CDN_CACHE_CONTROL).toMatch(/^public, durable, /);
    expect(PUBLIC_PAGE_CDN_CACHE_CONTROL).toContain('s-maxage=3600');
    expect(PUBLIC_PAGE_CDN_CACHE_CONTROL).not.toMatch(/private|no-store|no-cache/);
  });
});
