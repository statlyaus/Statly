import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isServedInTradesOnlyMode, isTradesOnlyMode } from '@/lib/tradesOnlyMode';
import { proxy } from '@/proxy';

/**
 * Trades-only mode: the AFL trade pages are live before fantasy. Only the home page, AFL and
 * draft-record pages, legal pages, public files and their two APIs answer; nothing sends a visitor
 * to sign in.
 */

const request = (path: string, init?: { cookie?: string }) =>
  new NextRequest(`https://statly.example${path}`, {
    headers: init?.cookie ? { cookie: init.cookie } : undefined,
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('trades-only mode', () => {
  it('is on only for the exact switch', () => {
    expect(isTradesOnlyMode({})).toBe(false);
    expect(isTradesOnlyMode({ STATLY_TRADES_ONLY: 'false' })).toBe(false);
    expect(isTradesOnlyMode({ STATLY_TRADES_ONLY: '1' })).toBe(false);
    expect(isTradesOnlyMode({ STATLY_TRADES_ONLY: ' TRUE ' })).toBe(true);
  });

  it.each([
    '/',
    '/afl',
    '/afl/trades',
    '/afl/trades/external-transaction:abc',
    '/afl/trades/clubs/club:abc',
    '/afl/trades/method',
    '/draft/trades',
    '/privacy',
    '/terms',
    '/data-deletion',
    '/brand/statly-hero-logo-overlay.png',
    '/favicon.svg',
    '/robots.txt',
    '/Assets/clubs/carlton.png',
    '/logos/statly.svg',
    '/api/admin/afl-trade-story-bundle',
    '/api/draft-trades/methodology',
  ])('serves %s', (path) => {
    expect(isServedInTradesOnlyMode(path)).toBe(true);
  });

  it.each([
    '/login',
    '/register',
    '/dashboard',
    '/leagues',
    '/leagues/abc/draft',
    '/basketball',
    '/dev/afl-trade-stories',
    '/aflx',
    '/api/leagues',
    '/api/cron/waivers',
    '/api/admin/queue',
    '/api/admin/afl-trade-story-bundle-other',
    '/api/players.json',
    // A fantasy page path that merely ends like a file name is still a fantasy page.
    '/leagues/x.png',
    '/leagues/abc.json',
    '/dashboard/x.json',
    '/players/a.bc',
  ])('does not serve %s', (path) => {
    expect(isServedInTradesOnlyMode(path)).toBe(false);
  });
});

describe('proxy in trades-only mode', () => {
  it('answers 404 for a fantasy API and rewrites a fantasy page to not found, never to sign-in', () => {
    vi.stubEnv('STATLY_TRADES_ONLY', 'true');
    const api = proxy(request('/api/leagues'));
    expect(api.status).toBe(404);
    const page = proxy(request('/dashboard'));
    expect(page.headers.get('location')).toBeNull();
    expect(page.headers.get('x-middleware-rewrite')).toContain('/_trades-only-not-found');
    const signedIn = proxy(request('/leagues/abc', { cookie: 'session=anything' }));
    expect(signedIn.headers.get('x-middleware-rewrite')).toContain('/_trades-only-not-found');
  });

  it('lets the trade pages and their upload route through', () => {
    vi.stubEnv('STATLY_TRADES_ONLY', 'true');
    for (const path of ['/', '/afl/trades', '/api/admin/afl-trade-story-bundle']) {
      const response = proxy(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    }
  });

  it('changes nothing when the switch is off', () => {
    const page = proxy(request('/dashboard'));
    expect(page.headers.get('location')).toContain('/login');
    expect(proxy(request('/api/leagues')).status).toBe(200);
  });
});
