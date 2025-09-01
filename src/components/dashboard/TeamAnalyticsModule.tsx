import React from 'react';
import dynamic from 'next/dynamic';
import TeamAnalyticsSkeleton from '@/components/ui/skeletons/TeamAnalyticsSkeleton';

const Client = dynamic(() => import('@/components/dashboard/TeamAnalyticsModule.client'), {
  ssr: false,
  loading: () => <TeamAnalyticsSkeleton />,
});

export default function TeamAnalyticsModule() {
  return <Client />;
}
