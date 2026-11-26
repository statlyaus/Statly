import type { MetadataRoute } from 'next';

import { clubChainsHref, tradeStoryHref } from '@/components/aflTradeStory/tradePageModel';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

// Read at request time, like the trade pages: the approved bundle lives in Netlify Blobs, not the
// build. The CDN caches the answer (config/publicPageCaching.mjs).
export const dynamic = 'force-dynamic';

const ORIGIN = 'https://statly.com.au';

/**
 * Every public page a search engine should know about, so the graded trades get indexed from one
 * list instead of being found by crawling. Filtered list views (?year=, ?club=) stay out, as in
 * robots.txt. The trade pages are listed only while they are available.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paths = ['/', '/afl', '/afl/stories/jeremy-cameron'];
  const read = await publicTradeStoryReads.listStories();
  if (read.available) {
    const { stories } = read.value;
    const clubIds = new Set(stories.flatMap((story) => story.clubIds));
    paths.push(
      '/afl/trades',
      '/afl/trades/method',
      '/afl/trades/general-managers',
      ...stories.map((story) => tradeStoryHref(story.tradeId, 'public')),
      ...[...clubIds].map((clubId) => clubChainsHref(clubId, 'public'))
    );
  }
  return paths.map((path) => ({ url: `${ORIGIN}${path}` }));
}
