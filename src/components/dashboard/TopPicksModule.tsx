import React from 'react';
import dynamic from 'next/dynamic';
import TopPicksSkeleton from '@/components/ui/skeletons/TopPicksSkeleton';

type Props = { refreshTrigger: number };

const Client = dynamic(() => import('./TopPicksModule.client'), {
  ssr: false,
  loading: () => <TopPicksSkeleton count={8} rowHeight={96} />,
}) as React.ComponentType<Props>;

export default function TopPicksModule(props: Props) {
  return <Client {...props} />;
}
