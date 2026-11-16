import type { Metadata } from 'next';

import { TradesListPage } from '@/components/aflTradeStory/TradesListPage';
import { parseTradesListQuery } from '@/components/aflTradeStory/tradesListQuery';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { TradesUnavailable } from './TradesUnavailable';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFL trades, valued | Statly',
  description:
    'Every AFL trade Statly has graded: what each club gave and got, valued by what the players went on to do.',
};

/** The public list of graded trades, newest year first, from the owner-approved bundle. */
export default async function PublicTradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const read = await publicTradeStoryReads.listStories();
  if (!read.available) return <TradesUnavailable />;
  const query = parseTradesListQuery(await searchParams, read.value.stories);
  return <TradesListPage list={read.value} query={query} />;
}
