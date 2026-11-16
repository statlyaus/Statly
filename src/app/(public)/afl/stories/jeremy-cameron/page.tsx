import type { Metadata } from 'next';

import { CameronStoryPage } from '@/components/aflStories/CameronStoryPage';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'From Giant to Cat: the Jeremy Cameron story | Statly',
  description:
    'How a 17-year-old from a town of 150 became a new club’s first great forward, then went home at a record price and won a premiership.',
};

/** The address of the trade that sent Jeremy Cameron to Geelong, while the trade pages are served. */
async function cameronTradeHref(): Promise<string | null> {
  // The story does not need the trade data: if the reader is slow, the page goes out without the link.
  const trades = await Promise.race([
    publicTradeStoryReads.listStories(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
  if (!trades?.available) return null;
  const trade = trades.value.stories.find((story) =>
    (story.results ?? []).some(({ received }) =>
      received.some((name) => name.includes('Jeremy Cameron'))
    )
  );
  return trade ? `/afl/trades/${encodeURIComponent(trade.tradeId)}` : null;
}

export default async function JeremyCameronStoryPage() {
  return <CameronStoryPage tradeHref={await cameronTradeHref()} />;
}
