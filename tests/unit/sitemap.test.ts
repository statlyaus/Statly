import { describe, expect, it, vi } from 'vitest';

const listStories = vi.hoisted(() => vi.fn());
vi.mock('@/server/aflTradeIntelligence/publication/publicTradeStoryReads', () => ({
  publicTradeStoryReads: { listStories },
}));

import sitemap from '@/app/sitemap';

const urls = async () => (await sitemap()).map((entry) => entry.url);

describe('/sitemap.xml', () => {
  it('lists the fixed public pages and nothing else while the trades are unavailable', async () => {
    listStories.mockResolvedValue({ available: false });
    expect(await urls()).toEqual([
      'https://statly.com.au/',
      'https://statly.com.au/afl',
      'https://statly.com.au/afl/stories/jeremy-cameron',
    ]);
  });

  it('adds the trade list, method, every trade and every club once while the trades are available', async () => {
    listStories.mockResolvedValue({
      available: true,
      value: {
        stories: [
          { tradeId: 'external-transaction:40cb6950', clubIds: ['gws', 'geelong'] },
          { tradeId: 'external-transaction:a1', clubIds: ['geelong', 'fremantle'] },
        ],
      },
    });
    expect(await urls()).toEqual([
      'https://statly.com.au/',
      'https://statly.com.au/afl',
      'https://statly.com.au/afl/stories/jeremy-cameron',
      'https://statly.com.au/afl/trades',
      'https://statly.com.au/afl/trades/method',
      'https://statly.com.au/afl/trades/external-transaction%3A40cb6950',
      'https://statly.com.au/afl/trades/external-transaction%3Aa1',
      'https://statly.com.au/afl/trades/clubs/gws',
      'https://statly.com.au/afl/trades/clubs/geelong',
      'https://statly.com.au/afl/trades/clubs/fremantle',
    ]);
  });
});
