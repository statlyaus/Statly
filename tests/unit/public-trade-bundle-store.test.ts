import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import {
  loadStoredTradeStoryBundle,
  storeApprovedTradeStoryBundle,
  type TradeStoryBundleBlobs,
} from '@/server/aflTradeIntelligence/publication/publicTradeBundleStore';

import { sampleTradeStoryBundle } from '../fixtures/aflTradeStorySampleBundle';

vi.mock('server-only', () => ({}));

/**
 * Where the public trade pages' bundle lives in production: a private blob store, keyed by bundle
 * id. Only the bundle whose id the owner approved can be stored, so an upload can never put
 * different numbers in front of readers.
 */

const bundle = sampleTradeStoryBundle();
const text = JSON.stringify(bundle);
const approved = { AFL_TRADE_STORY_PUBLIC_BUNDLE_ID: bundle.bundleId };

function blobs() {
  const held = new Map<string, string>();
  const store: TradeStoryBundleBlobs = {
    get: vi.fn(async (key) => held.get(key) ?? null),
    set: vi.fn(async (key, value) => void held.set(key, value)),
  };
  return { held, store };
}

describe('trade story bundle store', () => {
  it('stores the approved bundle, plain or gzipped, and reads it back by its id', async () => {
    for (const body of [Buffer.from(text), gzipSync(text)]) {
      const { store } = blobs();
      expect(await storeApprovedTradeStoryBundle(body, approved, store)).toEqual({
        stored: true,
        bundleId: bundle.bundleId,
        bytes: Buffer.byteLength(text),
      });
      expect(await loadStoredTradeStoryBundle(bundle.bundleId, {}, store)).toBe(text);
    }
  });

  it('keeps each bundle under its own id, so approving another id never reads this one', async () => {
    const { store } = blobs();
    await storeApprovedTradeStoryBundle(Buffer.from(text), approved, store);
    const other = `trade-story-bundle:${'0'.repeat(64)}`;
    expect(await loadStoredTradeStoryBundle(other, {}, store)).toBeNull();
  });

  it('refuses a bundle that is not the approved one, and stores nothing', async () => {
    const { store, held } = blobs();
    const result = await storeApprovedTradeStoryBundle(
      Buffer.from(text),
      { AFL_TRADE_STORY_PUBLIC_BUNDLE_ID: `trade-story-bundle:${'0'.repeat(64)}` },
      store
    );
    expect(result).toEqual({ stored: false, reason: 'not_the_approved_bundle' });
    expect(held.size).toBe(0);
  });

  it('refuses when no bundle id is approved', async () => {
    const { store, held } = blobs();
    expect(await storeApprovedTradeStoryBundle(Buffer.from(text), {}, store)).toEqual({
      stored: false,
      reason: 'no_approved_bundle_id',
    });
    expect(held.size).toBe(0);
  });

  it('refuses text that is not a bundle, or a bundle that was altered', async () => {
    const { store, held } = blobs();
    for (const body of ['{not json', '{}', JSON.stringify({ ...bundle, bundleId: 'x' })])
      expect(await storeApprovedTradeStoryBundle(Buffer.from(body), approved, store)).toEqual({
        stored: false,
        reason: 'not_a_valid_bundle',
      });
    const altered = JSON.parse(text) as { content: { names: { clubs: [string, string][] } } };
    altered.content.names.clubs[0]![1] = 'Altered';
    expect(
      await storeApprovedTradeStoryBundle(Buffer.from(JSON.stringify(altered)), approved, store)
    ).toEqual({ stored: false, reason: 'not_a_valid_bundle' });
    expect(held.size).toBe(0);
  });

  it('reads the file at AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH instead of the blob store when set', async () => {
    const { store } = blobs();
    const read = await loadStoredTradeStoryBundle(
      bundle.bundleId,
      { AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH: '/nonexistent/bundle.json' },
      store
    );
    expect(read).toBeNull();
    expect(store.get).not.toHaveBeenCalled();
  });
});
