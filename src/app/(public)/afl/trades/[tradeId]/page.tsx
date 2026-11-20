import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AflTradeStoryPage, headline } from '@/components/aflTradeStory/AflTradeStoryPage';
import { tradeShareCardModel } from '@/components/aflTradeStory/shareCardModel';
import { tradeStoryHref } from '@/components/aflTradeStory/tradePageModel';
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
  const title = `${clubs} trade, ${story.trade.year} | Statly`;
  const description = `${headline(read.value)}. What each club gave and got in the ${story.trade.year} trade, valued in PAV.`;
  const url = tradeStoryHref(story.trade.id, 'public');
  // The share card a link to this trade shows on Reddit, X, Facebook and in chats.
  const card = {
    url: `${url}/share-card`,
    width: 1200,
    height: 630,
    alt: tradeShareCardModel(read.value).alt,
  };
  return {
    metadataBase: new URL('https://statly.com.au'),
    title,
    description,
    openGraph: { title, description, url, siteName: 'Statly', type: 'article', images: [card] },
    twitter: { card: 'summary_large_image', title, description, images: [card] },
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
