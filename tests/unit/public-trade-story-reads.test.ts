import { describe, expect, it, vi } from 'vitest';

import {
  createPublicTradeStoryReads,
  type PublicTradeStoryReadEnvironment,
} from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { sampleTradeStoryBundle } from '../fixtures/aflTradeStorySampleBundle';

vi.mock('server-only', () => ({}));

/**
 * The public trade pages (/afl/trades) show one owner-approved trade story bundle and nothing else.
 * A bundle says "publication prohibited" about itself and its id is a hash of its content, so the
 * approval is the exact id held in configuration. Anything short of that reads as unavailable.
 */

const bundle = sampleTradeStoryBundle();
const text = JSON.stringify(bundle);
const approved: PublicTradeStoryReadEnvironment = {
  AFL_TRADE_STORY_PUBLIC_ENABLED: 'true',
  AFL_TRADE_STORY_PUBLIC_BUNDLE_ID: bundle.bundleId,
};

function reads(
  environment: PublicTradeStoryReadEnvironment,
  loadBundleText: () => Promise<string | null> = async () => text
) {
  const load = vi.fn(loadBundleText);
  return {
    load,
    reads: createPublicTradeStoryReads({ environment: () => environment, loadBundleText: load }),
  };
}

describe('public trade story reads', () => {
  it('serves the approved bundle: the list, a trade and a club', async () => {
    const { reads: r } = reads(approved);
    const list = await r.listStories();
    expect(list.available).toBe(true);
    if (!list.available) return;
    expect(list.value.stories.length).toBeGreaterThan(0);
    const first = list.value.stories[0]!;
    const story = await r.loadStory(first.tradeId);
    expect(story).toMatchObject({ available: true });
    expect(story.available && story.value?.story.trade.id).toBe(first.tradeId);
    const club = await r.loadClubChains(first.clubIds[0]!);
    expect(club.available && club.value !== null).toBe(true);
  });

  it('labels the source for the public, not as private', async () => {
    const list = await reads(approved).reads.listStories();
    expect(list.available && list.value.source.label).not.toMatch(/private|not for publication/iu);
  });

  it('answers not found, not unavailable, for a trade or club the bundle does not hold', async () => {
    const { reads: r } = reads(approved);
    expect(await r.loadStory('external-transaction:missing')).toEqual({
      available: true,
      value: null,
    });
    expect(await r.loadClubChains('club:missing')).toEqual({ available: true, value: null });
  });

  it('is unavailable and never loads the bundle while switched off', async () => {
    for (const flag of [undefined, 'false', '1', '']) {
      const { reads: r, load } = reads({ ...approved, AFL_TRADE_STORY_PUBLIC_ENABLED: flag });
      expect(await r.listStories()).toEqual({ available: false });
      expect(await r.loadStory('x')).toEqual({ available: false });
      expect(await r.loadClubChains('x')).toEqual({ available: false });
      expect(load).not.toHaveBeenCalled();
    }
  });

  it('is unavailable with no approved bundle id', async () => {
    const { reads: r, load } = reads({ AFL_TRADE_STORY_PUBLIC_ENABLED: 'true' });
    expect(await r.listStories()).toEqual({ available: false });
    expect(load).not.toHaveBeenCalled();
  });

  it('is unavailable when the stored bundle is not the approved one', async () => {
    const { reads: r } = reads({
      ...approved,
      AFL_TRADE_STORY_PUBLIC_BUNDLE_ID: `trade-story-bundle:${'0'.repeat(64)}`,
    });
    expect(await r.listStories()).toEqual({ available: false });
  });

  it('is unavailable when the bundle is missing, unreadable or altered', async () => {
    expect(await reads(approved, async () => null).reads.listStories()).toEqual({
      available: false,
    });
    expect(await reads(approved, async () => '{not json').reads.listStories()).toEqual({
      available: false,
    });
    expect(
      await reads(approved, async () => {
        throw new Error('storage down');
      }).reads.listStories()
    ).toEqual({ available: false });
    const altered = JSON.parse(text) as { content: { names: { clubs: [string, string][] } } };
    altered.content.names.clubs[0]![1] = 'Altered';
    expect(
      await reads(approved, async () => JSON.stringify(altered)).reads.listStories()
    ).toEqual({ available: false });
  });

  it('loads and verifies the bundle once, and retries after a failed load', async () => {
    const { reads: r, load } = reads(approved);
    await r.listStories();
    await r.loadStory('x');
    await r.loadClubChains('x');
    expect(load).toHaveBeenCalledTimes(1);

    let calls = 0;
    const flaky = reads(approved, async () => (++calls === 1 ? null : text));
    expect(await flaky.reads.listStories()).toEqual({ available: false });
    expect((await flaky.reads.listStories()).available).toBe(true);
  });
});
