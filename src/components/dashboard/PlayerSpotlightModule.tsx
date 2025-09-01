import React from 'react';
import dynamic from 'next/dynamic';
import PlayerSpotlightSkeleton from '@/components/ui/skeletons/PlayerSpotlightSkeleton';

const Client = dynamic(() => import('@/components/dashboard/PlayerSpotlightModule.client'), {
  ssr: false,
  loading: () => <PlayerSpotlightSkeleton />,
});

export default function PlayerSpotlightModule() {
  return <Client />;
}
