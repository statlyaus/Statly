import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEVELOPMENT_AUTH_USER_ID } from '@/lib/devAuth';
import {
  createPrivateTradeStoryReads,
  type PrivateTradeStoryReadEnvironment,
} from '@/server/aflTradeIntelligence/development/privateTradeStoryReads';
import { aflTradeStorySamples } from '@/server/aflTradeIntelligence/development/tradeStorySamples';

import { TRADE } from '../fixtures/aflTradeStoryCameronChainFixture';

/**
 * The private trade page is unreachable from the public surface (statlyaus/Statly#789): realized
 * values are publication-prohibited. Only the private reader serves it, and no public module
 * imports it.
 */

const { loadStoryMock, listStoriesMock, notFoundMock } = vi.hoisted(() => ({
  loadStoryMock: vi.fn(),
  listStoriesMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/server/aflTradeIntelligence/development/privateTradeStoryReads', async (actual) => ({
  ...(await actual<
    typeof import('@/server/aflTradeIntelligence/development/privateTradeStoryReads')
  >()),
  privateTradeStoryReads: { loadStory: loadStoryMock, listStories: listStoriesMock },
}));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
// The reader's default wiring reads the request's session; these tests inject their own.
vi.mock('@/lib/serverAuth', () => ({ getExplicitAuthenticatedUserIdFromServerContext: vi.fn() }));

import PrivateTradeStoryPage, {
  metadata as storyMetadata,
} from '../../src/app/dev/afl-trade-stories/[tradeId]/page';
import PrivateTradeStoriesPage, {
  metadata as indexMetadata,
} from '../../src/app/dev/afl-trade-stories/page';

const ENABLED: PrivateTradeStoryReadEnvironment = {
  NODE_ENV: 'development',
  STATLY_ENABLE_DEV_TOOLS: 'true',
  AFL_TRADE_STORY_READER_ENABLED: 'true',
};

function reads(environment: PrivateTradeStoryReadEnvironment, userId: string | null) {
  const authenticate = vi.fn(async () => userId);
  return {
    authenticate,
    reads: createPrivateTradeStoryReads({
      authenticate,
      environment: () => environment,
      source: aflTradeStorySamples,
    }),
  };
}

describe('private trade story reader', () => {
  it('serves the verified local development user with the reader switched on', async () => {
    const { reads: admitted } = reads(ENABLED, DEVELOPMENT_AUTH_USER_ID);
    expect((await admitted.loadStory(TRADE.cameron))?.story.trade.id).toBe(TRADE.cameron);
    expect((await admitted.listStories())?.map(({ tradeId }) => tradeId)).toContain(TRADE.geeWbd);
    expect(await admitted.loadStory('trade:not-in-the-sample')).toBeNull();
  });

  it.each([
    ['production, even with every switch on', { ...ENABLED, NODE_ENV: 'production' }],
    ['development tools off', { ...ENABLED, STATLY_ENABLE_DEV_TOOLS: 'false' }],
    ['trade story reader off', { ...ENABLED, AFL_TRADE_STORY_READER_ENABLED: undefined }],
  ])('reads nothing in %s, before asking who is signed in', async (_case, environment) => {
    const { reads: refused, authenticate } = reads(environment, DEVELOPMENT_AUTH_USER_ID);
    expect(await refused.loadStory(TRADE.cameron)).toBeNull();
    expect(await refused.listStories()).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([
    ['no session', null],
    ['another user', 'firebase-user-1'],
  ])('reads nothing for %s', async (_case, userId) => {
    const { reads: refused } = reads(ENABLED, userId);
    expect(await refused.loadStory(TRADE.cameron)).toBeNull();
    expect(await refused.listStories()).toBeNull();
  });
});

describe('private trade story routes', () => {
  beforeEach(() => {
    loadStoryMock.mockReset();
    listStoriesMock.mockReset();
  });

  it('are not found when the reader refuses', async () => {
    loadStoryMock.mockResolvedValue(null);
    listStoriesMock.mockResolvedValue(null);
    await expect(
      PrivateTradeStoryPage({ params: Promise.resolve({ tradeId: TRADE.cameron }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(PrivateTradeStoriesPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('refuse a malformed trade id without reading', async () => {
    await expect(
      PrivateTradeStoryPage({ params: Promise.resolve({ tradeId: '..%2F..%2Fsecrets' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(loadStoryMock).not.toHaveBeenCalled();
  });

  it('render the story the reader admits, with the private notice', async () => {
    loadStoryMock.mockResolvedValue(aflTradeStorySamples.load(TRADE.cameron));
    render(
      await PrivateTradeStoryPage({
        params: Promise.resolve({ tradeId: encodeURIComponent(TRADE.cameron) }),
      })
    );
    expect(loadStoryMock).toHaveBeenCalledWith(TRADE.cameron);
    expect(screen.getByText(/Private page\./u)).toBeInTheDocument();
  });

  it('ask search engines not to index them', () => {
    for (const metadata of [storyMetadata, indexMetadata])
      expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('publication boundary', () => {
  const root = join(__dirname, '../../src');
  const files = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(directory, entry.name))
        : /\.(ts|tsx)$/u.test(entry.name)
          ? [join(directory, entry.name)]
          : []
    );
  /** The private page's modules. Only each other and the private route may import them. */
  const PRIVATE_MODULE =
    /from ['"][^'"]*(components\/aflTradeStory|privateTradeStoryReads|tradeStorySamples|tradeStorySampleChain|realizedTradePageContracts|realizedTradeStory)[^'"]*['"]/u;
  const ALLOWED = [
    /^app\/dev\/afl-trade-stories\//u,
    /^components\/aflTradeStory\//u,
    /^server\/aflTradeIntelligence\/development\/(privateTradeStoryReads|tradeStorySamples|tradeStorySampleChain)\.ts$/u,
    /^server\/aflTradeIntelligence\/valuation\/realizedTrade(Story|StoryAssets|StoryContracts|PageContracts)\.ts$/u,
  ];

  it('no public page, API or publication module imports the private trade page', () => {
    const importers = files(root)
      .map((file) => relative(root, file))
      .filter((file) => PRIVATE_MODULE.test(readFileSync(join(root, file), 'utf8')))
      .filter((file) => !ALLOWED.some((allowed) => allowed.test(file)));
    expect(importers).toEqual([]);
  });

  it('serves the page only under the private /dev reader path', () => {
    const routes = files(join(root, 'app'))
      .map((file) => relative(join(root, 'app'), file))
      .filter((file) =>
        readFileSync(join(root, 'app', file), 'utf8').includes('AflTradeStoryPage')
      );
    expect(routes).toEqual([join('dev', 'afl-trade-stories', '[tradeId]', 'page.tsx')]);
  });
});
