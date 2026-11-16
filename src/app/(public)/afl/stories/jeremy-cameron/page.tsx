import type { Metadata } from 'next';

import { CameronStoryPage } from '@/components/aflStories/CameronStoryPage';

export const metadata: Metadata = {
  title: 'From Giant to Cat: the Jeremy Cameron story | Statly',
  description:
    'How a 17-year-old from a town of 150 became a new club’s first great forward, then went home at a record price and won a premiership.',
};

export default function JeremyCameronStoryPage() {
  return <CameronStoryPage />;
}
