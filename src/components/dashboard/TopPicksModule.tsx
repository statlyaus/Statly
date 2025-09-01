import React from 'react';
import dynamic from 'next/dynamic';
import TopPicksSkeleton from '@/components/ui/skeletons/TopPicksSkeleton';
import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types/socketEvents';

type Props = { socket: Socket<ServerToClientEvents, ClientToServerEvents> | null };

const Client = dynamic(() => import('./TopPicksModule.client'), {
  ssr: false,
  loading: () => <TopPicksSkeleton count={8} rowHeight={96} />,
}) as React.ComponentType<Props>;

export default function TopPicksModule(props: Props) {
  return <Client {...props} />;
}
