import React from 'react';

import dynamic from 'next/dynamic';

import LiveInjuryFeedSkeleton from '@/components/ui/skeletons/LiveInjuryFeedSkeleton';

type Props = {
  refreshTrigger: number;
  teamFilter?: string;
  userTeamPlayers?: string[];
  autoRefresh?: boolean;
};

const Client = dynamic<Props>(() => import('./LiveInjuryFeed.client'), {
  ssr: false,
  loading: () => <LiveInjuryFeedSkeleton />,
});

export default function LiveInjuryFeed(props: Props) {
  return <Client {...props} />;
}
