import React from 'react';
import dynamic from 'next/dynamic';
import LiveInjuryFeedSkeleton from '@/components/ui/skeletons/LiveInjuryFeedSkeleton';
import type { Socket } from 'socket.io-client';

type Props = {
  teamFilter?: string;
  userTeamPlayers?: string[];
  autoRefresh?: boolean;
  socket?: Socket | null;
};

const Client = dynamic<Props>(() => import('./LiveInjuryFeed.client'), {
  ssr: false,
  loading: () => <LiveInjuryFeedSkeleton />,
});

export default function LiveInjuryFeed(props: Props) {
  return <Client {...props} />;
}
