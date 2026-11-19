import { describe, expect, it, vi } from 'vitest';

const listStories = vi.hoisted(() => vi.fn());
vi.mock('@/server/aflTradeIntelligence/publication/publicTradeStoryReads', () => ({
  publicTradeStoryReads: { listStories },
}));

import { generateMetadata } from '@/app/(public)/afl/trades/page';

describe('/afl/trades metadata', () => {
  it('asks search engines not to index the page while the trades are unavailable', async () => {
    listStories.mockResolvedValue({ available: false });
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
  });

  it('is indexable while the trades are available', async () => {
    listStories.mockResolvedValue({ available: true, value: { stories: [] } });
    const metadata = await generateMetadata();
    expect(metadata.robots).toBeUndefined();
    expect(metadata.title).toBe('AFL trades, valued | Statly');
  });
});
