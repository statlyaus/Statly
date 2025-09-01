import React from 'react';
import dynamic from 'next/dynamic';
import PlayerSpotlightSkeleton from '@/components/ui/skeletons/PlayerSpotlightSkeleton';
import type { Socket } from 'socket.io-client';

type Props = { socket: Socket | null };

const Client = dynamic(() => import('@/components/dashboard/PlayerSpotlightModule.client'), {
  ssr: false,
  loading: () => <PlayerSpotlightSkeleton />,
}) as React.ComponentType<Props>;

export default function PlayerSpotlightModule(props: Props) {
  return <Client {...props} />;
}
