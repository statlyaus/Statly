import 'server-only';

import { logger } from '@/lib/logger';

import {
  createAflTradeStoryBundleSource,
  verifyAflTradeStoryBundle,
} from '../development/tradeStoryBundle';
import type {
  AflTradeClubChainsModel,
  AflTradeStorySampleList,
  AflTradeStorySampleSource,
} from '../development/tradeStorySamples';
import type { AflTradePageModel } from '../valuation/realizedTradePageContracts';
import { loadStoredTradeStoryBundle } from './publicTradeBundleStore';

/**
 * The public trade pages' only way in (/afl/trades, statlyaus/Statly#789). A trade story bundle is
 * built private: it says `publicationProhibited` about itself, and its id is a hash of its content.
 * Publication is therefore an owner decision about one exact bundle, held in configuration as that
 * bundle's id. The reader shows the stored bundle only when the pages are switched on, the bundle
 * verifies, and its id is the approved one. Anything else is unavailable: never the samples, never a
 * different bundle, never a partial page.
 */

export interface PublicTradeStoryReadEnvironment {
  AFL_TRADE_STORY_PUBLIC_ENABLED?: string;
  /** The owner-approved `trade-story-bundle:<sha256>` id. */
  AFL_TRADE_STORY_PUBLIC_BUNDLE_ID?: string;
}

export interface PublicTradeStoryReadDependencies {
  environment(): PublicTradeStoryReadEnvironment;
  /** The stored bundle's JSON text for the approved id, or null when there is none. */
  loadBundleText(approvedId: string): Promise<string | null>;
}

/** `available: false` is the whole surface being off; `value: null` is one trade or club not found. */
export type PublicTradeStoryRead<T> =
  { readonly available: false } | { readonly available: true; readonly value: T };

export interface PublicTradeStoryReads {
  listStories(): Promise<PublicTradeStoryRead<AflTradeStorySampleList>>;
  loadStory(tradeId: string): Promise<PublicTradeStoryRead<AflTradePageModel | null>>;
  loadClubChains(clubId: string): Promise<PublicTradeStoryRead<AflTradeClubChainsModel | null>>;
}

const UNAVAILABLE = { available: false } as const;
const BUNDLE_ID = /^trade-story-bundle:[a-f0-9]{64}$/u;

export function createPublicTradeStoryReads(
  dependencies: PublicTradeStoryReadDependencies
): PublicTradeStoryReads {
  // One verified source per approved id; a failed load is not kept, so the next request tries again.
  let loaded: { approvedId: string; source: AflTradeStorySampleSource } | null = null;

  async function source(): Promise<AflTradeStorySampleSource | null> {
    const environment = dependencies.environment();
    if (environment.AFL_TRADE_STORY_PUBLIC_ENABLED?.trim().toLowerCase() !== 'true') return null;
    const approvedId = environment.AFL_TRADE_STORY_PUBLIC_BUNDLE_ID?.trim() ?? '';
    if (!BUNDLE_ID.test(approvedId)) {
      logger.warn('Public trade pages are on but the approved bundle id is malformed', {
        approvedId,
      });
      return null;
    }
    if (loaded?.approvedId === approvedId) return loaded.source;
    try {
      const text = await dependencies.loadBundleText(approvedId);
      if (text === null) {
        logger.warn('Public trade pages are on but the approved bundle is not stored', {
          approvedId,
        });
        return null;
      }
      const bundle = verifyAflTradeStoryBundle(JSON.parse(text));
      if (bundle.bundleId !== approvedId) {
        logger.warn(
          'Public trade pages are on but the stored bundle does not match the approved id',
          {
            approvedId,
            storedId: bundle.bundleId,
          }
        );
        return null;
      }
      loaded = {
        approvedId,
        source: createAflTradeStoryBundleSource(bundle, { audience: 'public' }),
      };
      return loaded.source;
    } catch (error) {
      logger.error('Public trade pages are on but the approved bundle could not be loaded', error, {
        approvedId,
      });
      return null;
    }
  }

  async function read<T>(
    select: (from: AflTradeStorySampleSource) => T
  ): Promise<PublicTradeStoryRead<T>> {
    const from = await source();
    return from === null ? UNAVAILABLE : { available: true, value: select(from) };
  }

  return {
    listStories: () => read((from) => from.list()),
    loadStory: (tradeId) => read((from) => from.load(tradeId)),
    loadClubChains: (clubId) => read((from) => from.loadClub(clubId)),
  };
}

export const publicTradeStoryReads = createPublicTradeStoryReads({
  environment: () => ({
    AFL_TRADE_STORY_PUBLIC_ENABLED: process.env.AFL_TRADE_STORY_PUBLIC_ENABLED,
    AFL_TRADE_STORY_PUBLIC_BUNDLE_ID: process.env.AFL_TRADE_STORY_PUBLIC_BUNDLE_ID,
  }),
  loadBundleText: (approvedId) =>
    loadStoredTradeStoryBundle(approvedId, {
      AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH: process.env.AFL_TRADE_STORY_PUBLIC_BUNDLE_PATH,
    }),
});
