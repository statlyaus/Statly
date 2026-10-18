import 'server-only';

import { DEVELOPMENT_AUTH_USER_ID } from '@/lib/devAuth';
import { getExplicitAuthenticatedUserIdFromServerContext } from '@/lib/serverAuth';

import type { AflTradePageModel } from '../valuation/realizedTradePageContracts';
import {
  aflTradeStorySamples,
  type AflTradeStorySampleSource,
  type AflTradeStorySampleList,
} from './tradeStorySamples';

/**
 * The private trade page's only way in (statlyaus/Statly#789). Realized values are
 * publication-prohibited, so the page is a local private reader: it answers only outside production,
 * with the development tools and the trade story reader switched on, for the verified local
 * development user. Anything else reads as not found. Public pages never import this module.
 */

export interface PrivateTradeStoryReadEnvironment {
  NODE_ENV?: string;
  STATLY_ENABLE_DEV_TOOLS?: string;
  AFL_TRADE_STORY_READER_ENABLED?: string;
}

export interface PrivateTradeStoryReadDependencies {
  /** The verified session's user id, or null. The development-auth fallback is not accepted. */
  authenticate(): Promise<string | null>;
  environment(): PrivateTradeStoryReadEnvironment;
  source: AflTradeStorySampleSource;
}

export interface PrivateTradeStoryReads {
  listStories(): Promise<AflTradeStorySampleList | null>;
  loadStory(tradeId: string): Promise<AflTradePageModel | null>;
}

const isTrue = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

function isEnabled(environment: PrivateTradeStoryReadEnvironment): boolean {
  return (
    environment.NODE_ENV !== 'production' &&
    isTrue(environment.STATLY_ENABLE_DEV_TOOLS) &&
    isTrue(environment.AFL_TRADE_STORY_READER_ENABLED)
  );
}

export function createPrivateTradeStoryReads(
  dependencies: PrivateTradeStoryReadDependencies
): PrivateTradeStoryReads {
  async function admitted(): Promise<boolean> {
    const { NODE_ENV, STATLY_ENABLE_DEV_TOOLS, AFL_TRADE_STORY_READER_ENABLED } =
      dependencies.environment();
    if (!isEnabled({ NODE_ENV, STATLY_ENABLE_DEV_TOOLS, AFL_TRADE_STORY_READER_ENABLED }))
      return false;
    return (await dependencies.authenticate()) === DEVELOPMENT_AUTH_USER_ID;
  }

  return {
    async listStories() {
      return (await admitted()) ? dependencies.source.list() : null;
    },
    async loadStory(tradeId) {
      return (await admitted()) ? dependencies.source.load(tradeId) : null;
    },
  };
}

export const privateTradeStoryReads = createPrivateTradeStoryReads({
  authenticate: getExplicitAuthenticatedUserIdFromServerContext,
  environment: () => process.env,
  source: aflTradeStorySamples,
});
