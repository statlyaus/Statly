import React from 'react';

import dynamic from 'next/dynamic';

import PlayerSpotlightSkeleton from '@/components/ui/skeletons/PlayerSpotlightSkeleton';

type Props = { refreshTrigger: number };

const Client = dynamic(() => import('@/components/dashboard/PlayerSpotlightModule.client'), {
  ssr: false,
  loading: () => <PlayerSpotlightSkeleton />,
}) as React.ComponentType<Props>;

export default function PlayerSpotlightModule(props: Props) {
  return <Client {...props} />;
}
