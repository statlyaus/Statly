import React from 'react';
import dynamic from 'next/dynamic';
import TeamAnalyticsSkeleton from '@/components/ui/skeletons/TeamAnalyticsSkeleton';
import type { Socket } from 'socket.io-client';

type Props = { socket: Socket | null };

const Client = dynamic(() => import('@/components/dashboard/TeamAnalyticsModule.client'), {
  ssr: false,
  loading: () => <TeamAnalyticsSkeleton />,
}) as React.ComponentType<Props>;

export default function TeamAnalyticsModule(props: Props) {
  return <Client {...props} />;
}
