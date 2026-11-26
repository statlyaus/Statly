import type { Metadata } from 'next';

import { GeneralManagersPage } from '@/components/aflGeneralManagers/GeneralManagersPage';
import { generalManagerLadder } from '@/components/aflGeneralManagers/generalManagerLadder';
import { publicTradeStoryReads } from '@/server/aflTradeIntelligence/publication/publicTradeStoryReads';

import { TradesUnavailable } from '../TradesUnavailable';

export const dynamic = 'force-dynamic';

const metadata: Metadata = {
  title: 'General managers of football, by their trades | Statly',
  description:
    'Every AFL club’s head of football since 2019, ranked by how the trades made while they ran the football department turned out.',
};

/** While the pages are off, the "not available" answer is not for search engines to index. */
export async function generateMetadata(): Promise<Metadata> {
  const read = await publicTradeStoryReads.listStories();
  return read.available ? metadata : { ...metadata, robots: { index: false, follow: false } };
}

/** The general managers ladder, from the same owner-approved bundle as every trade page. */
export default async function PublicGeneralManagersPage() {
  const read = await publicTradeStoryReads.listStories();
  if (!read.available) return <TradesUnavailable />;
  return <GeneralManagersPage ladder={generalManagerLadder(read.value.stories)} />;
}
