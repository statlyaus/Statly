import React from 'react';
import dynamic from 'next/dynamic';
import TopPicksSkeleton from '@/components/ui/skeletons/TopPicksSkeleton';

const Client = dynamic(() => import('./TopPicksModule.client'), {
  ssr: false,
  loading: () => <TopPicksSkeleton count={8} rowHeight={96} />,
});

export default function TopPicksModule() {
  return <Client />;
}
