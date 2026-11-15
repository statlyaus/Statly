import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AflTradeStoryPage, headline } from '@/components/aflTradeStory/AflTradeStoryPage';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { parseTradeRouteId } from '../tradeRouteParams';
import { TradesUnavailable } from '../TradesUnavailable';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ tradeId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const tradeId = parseTradeRouteId((await params).tradeId);
  const read = tradeId === null ? null : await publicTradeStoryReads.loadStory(tradeId);
  if (!read?.available || read.value === null)
    return { title: 'AFL trade | Statly', robots: { index: false, follow: false } };
  const { story } = read.value;
  const clubs = story.trade.clubs.map(({ clubName }) => clubName).join(' and ');
  return {
    title: `${clubs} trade, ${story.trade.year} | Statly`,
    description: `${headline(read.value)}. What each club gave and got in the ${story.trade.year} trade, valued in PAV.`,
  };
}

/** One trade's public page: the owner-approved bundle's story, unavailable or not found otherwise. */
export default async function PublicTradeStoryPage({ params }: Params) {
  const tradeId = parseTradeRouteId((await params).tradeId);
  if (tradeId === null) notFound();
  const read = await publicTradeStoryReads.loadStory(tradeId);
  if (!read.available) return <TradesUnavailable />;
  if (read.value === null) notFound();
  return <AflTradeStoryPage model={read.value} />;
}
