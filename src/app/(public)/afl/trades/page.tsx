import type { Metadata } from 'next';

import { TradesListPage } from '@/components/aflTradeStory/TradesListPage';
import { filterTrades, parseTradesListQuery } from '@/components/aflTradeStory/tradesListQuery';
import { selectedTrade } from '@/components/aflTradeStory/tradesPreviewModel';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { TradesUnavailable } from './TradesUnavailable';

export const dynamic = 'force-dynamic';

const metadata: Metadata = {
  title: 'AFL trades, valued | Statly',
  description:
    'Every AFL trade Statly has graded: what each club gave and got, valued by what the players went on to do.',
};

/** While the pages are off, the "not available" answer is not for search engines to index. */
export async function generateMetadata(): Promise<Metadata> {
  const read = await publicTradeStoryReads.listStories();
  return read.available ? metadata : { ...metadata, robots: { index: false, follow: false } };
}

/**
 * The public list of graded trades, newest year first, from the owner-approved bundle, with one trade
 * open in the preview. The preview's story is a lookup in the same loaded bundle, not a second read.
 */
export default async function PublicTradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const read = await publicTradeStoryReads.listStories();
  if (!read.available) return <TradesUnavailable />;
  const query = parseTradesListQuery(await searchParams, read.value.stories);
  const selected = selectedTrade(filterTrades(read.value.stories, query), query.trade);
  const story = selected ? await publicTradeStoryReads.loadStory(selected.tradeId) : null;
  const preview = story?.available ? story.value : null;
  return <TradesListPage list={read.value} query={query} preview={preview} />;
}
