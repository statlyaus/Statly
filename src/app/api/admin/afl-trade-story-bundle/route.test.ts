import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.fn();
const loadMock = vi.fn();

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/aflTradeIntelligence/publication/publicTradeBundleStore', () => ({
  storeApprovedTradeStoryBundle: (...args: unknown[]) => storeMock(...args),
  loadStoredTradeStoryBundle: (...args: unknown[]) => loadMock(...args),
}));

const { GET, POST } = await import('./route');

const URL_BASE = 'http://localhost/api/admin/afl-trade-story-bundle';
const ID = `trade-story-bundle:${'a'.repeat(64)}`;
const authorized = { authorization: 'Bearer secret' };
const post = (headers: Record<string, string>, body = 'bundle-bytes') =>
  POST(new NextRequest(URL_BASE, { method: 'POST', headers, body }));

describe('/api/admin/afl-trade-story-bundle', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'secret');
    vi.stubEnv('AFL_TRADE_STORY_PUBLIC_BUNDLE_ID', ID);
    storeMock.mockReset();
    loadMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a missing or wrong secret before reading the upload', async () => {
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await GET(new NextRequest(URL_BASE))).status).toBe(401);
    expect(storeMock).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('stores the upload against the approved id and says what it stored', async () => {
    storeMock.mockResolvedValue({ stored: true, bundleId: ID, bytes: 12 });
    const response = await post(authorized);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, stored: true, bundleId: ID, bytes: 12 });
    const [body, environment] = storeMock.mock.calls[0]!;
    expect(Buffer.from(body as Uint8Array).toString()).toBe('bundle-bytes');
    expect(environment).toEqual({ AFL_TRADE_STORY_PUBLIC_BUNDLE_ID: ID });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['no_approved_bundle_id', 409],
    ['not_a_valid_bundle', 422],
    ['not_the_approved_bundle', 422],
  ])('refuses with %s', async (reason, status) => {
    storeMock.mockResolvedValue({ stored: false, reason });
    const response = await post(authorized);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: reason });
  });

  it('answers 503 when the blob store cannot be reached', async () => {
    storeMock.mockRejectedValue(new Error('no blobs here'));
    expect((await post(authorized)).status).toBe(503);
    loadMock.mockRejectedValue(new Error('no blobs here'));
    expect((await GET(new NextRequest(URL_BASE, { headers: authorized }))).status).toBe(503);
  });

  it('reports whether the approved bundle is stored', async () => {
    loadMock.mockResolvedValue('{}');
    const there = await GET(new NextRequest(URL_BASE, { headers: authorized }));
    expect(await there.json()).toEqual({ ok: true, approvedBundleId: ID, stored: true });
    expect(loadMock).toHaveBeenCalledWith(ID, {});
    loadMock.mockResolvedValue(null);
    const missing = await GET(new NextRequest(URL_BASE, { headers: authorized }));
    expect(await missing.json()).toEqual({ ok: true, approvedBundleId: ID, stored: false });
  });
});
