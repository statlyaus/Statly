import type { Metadata } from 'next';

import { TradeMethodExplainer } from '@/components/aflTradeMethod/TradeMethodExplainer';

export const metadata: Metadata = {
  title: 'How Statly values trades | Statly',
  description:
    'Follow Jordan Dawson through Player Approximate Value (PAV), step by step, to the value line Statly uses to judge every AFL trade.',
};

/** The public method page: one real player's numbers, from the pot of value to his trade. */
export default function TradeMethodPage() {
  return <TradeMethodExplainer />;
}
