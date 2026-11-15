import 'server-only';

import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { verifyAflTradeStoryBundle } from '../development/tradeStoryBundle';

/**
 * Where the public trade pages' bundle lives (statlyaus/Statly#789). The repository is public and
 * never holds generated output, so in production the bundle sits in a private Netlify Blobs store,
 * one blob per bundle id. Only the bundle whose id the owner approved
 * (`AFL_TRADE_STORY_PUBLIC_BUNDLE_ID`) can be stored, so an upload cannot put other numbers in
 * front of readers. A local run reads the file at `AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH` instead.
 */

const STORE_NAME = 'afl-trade-story-bundles';
const BUNDLE_ID = /^trade-story-bundle:([a-f0-9]{64})$/u;
const MAXIMUM_BUNDLE_BYTES = 96 * 1024 * 1024;

/** The two blob operations the store needs; the Netlify store in production, a map in tests. */
export interface TradeStoryBundleBlobs {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface TradeStoryBundleStoreEnvironment {
  AFL_TRADE_STORY_PUBLIC_BUNDLE_ID?: string;
  AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH?: string;
}

export type StoreTradeStoryBundleResult =
  | { readonly stored: true; readonly bundleId: string; readonly bytes: number }
  | {
      readonly stored: false;
      readonly reason: 'no_approved_bundle_id' | 'not_a_valid_bundle' | 'not_the_approved_bundle';
    };

const blobKey = (bundleId: string) => BUNDLE_ID.exec(bundleId)?.[1] ?? null;

/** The site's private blob store. Outside Netlify there is none, and using it throws. */
export async function netlifyTradeStoryBundleBlobs(): Promise<TradeStoryBundleBlobs> {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore(STORE_NAME, { consistency: 'strong' });
  return {
    get: (key) => store.get(key, { type: 'text' }),
    set: async (key, value) => void (await store.set(key, value)),
  };
}

/** The stored bundle's JSON text for one approved id, or null when there is none. */
export async function loadStoredTradeStoryBundle(
  approvedId: string,
  environment: TradeStoryBundleStoreEnvironment,
  blobs?: TradeStoryBundleBlobs
): Promise<string | null> {
  const path = environment.AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH?.trim();
  if (path) {
    if (!isAbsolute(path)) return null;
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  const key = blobKey(approvedId);
  if (key === null) return null;
  return (blobs ?? (await netlifyTradeStoryBundleBlobs())).get(key);
}

/** Stores an uploaded bundle (JSON, optionally gzipped) if, and only if, it is the approved one. */
export async function storeApprovedTradeStoryBundle(
  body: Uint8Array,
  environment: TradeStoryBundleStoreEnvironment,
  blobs?: TradeStoryBundleBlobs
): Promise<StoreTradeStoryBundleResult> {
  const approvedId = environment.AFL_TRADE_STORY_PUBLIC_BUNDLE_ID?.trim() ?? '';
  const key = blobKey(approvedId);
  if (key === null) return { stored: false, reason: 'no_approved_bundle_id' };
  let text: string;
  let bundleId: string;
  try {
    const gzipped = body[0] === 0x1f && body[1] === 0x8b;
    const bytes = gzipped ? gunzipSync(body, { maxOutputLength: MAXIMUM_BUNDLE_BYTES }) : body;
    if (bytes.byteLength > MAXIMUM_BUNDLE_BYTES)
      return { stored: false, reason: 'not_a_valid_bundle' };
    text = Buffer.from(bytes).toString('utf8');
    bundleId = verifyAflTradeStoryBundle(JSON.parse(text)).bundleId;
  } catch {
    return { stored: false, reason: 'not_a_valid_bundle' };
  }
  if (bundleId !== approvedId) return { stored: false, reason: 'not_the_approved_bundle' };
  await (blobs ?? (await netlifyTradeStoryBundleBlobs())).set(key, text);
  return { stored: true, bundleId, bytes: Buffer.byteLength(text) };
}
