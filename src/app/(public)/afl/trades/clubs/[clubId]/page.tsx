import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClubChainsPage } from '@/components/aflTradeStory/ClubChainsPage';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { parseTradeRouteId } from '../../tradeRouteParams';
import { TradesUnavailable } from '../../TradesUnavailable';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ clubId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const clubId = parseTradeRouteId((await params).clubId);
  const read = clubId === null ? null : await publicTradeStoryReads.loadClubChains(clubId);
  if (!read?.available || read.value === null)
    return { title: 'AFL club trades | Statly', robots: { index: false, follow: false } };
  const club = read.value.chains.clubName;
  return {
    title: `${club} trade chains | Statly`,
    description: `Every chain of trades ${club} has made among the trades Statly has graded, and what each has returned in PAV.`,
  };
}

/** Every trade chain of one club, from the owner-approved bundle. */
export default async function PublicClubChainsPage({ params }: Params) {
  const clubId = parseTradeRouteId((await params).clubId);
  if (clubId === null) notFound();
  const read = await publicTradeStoryReads.loadClubChains(clubId);
  if (!read.available) return <TradesUnavailable />;
  if (read.value === null) notFound();
  return <ClubChainsPage model={read.value} />;
}
