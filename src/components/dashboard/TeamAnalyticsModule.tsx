import React from 'react';

import dynamic from 'next/dynamic';

import TeamAnalyticsSkeleton from '@/components/ui/skeletons/TeamAnalyticsSkeleton';

type Props = { refreshTrigger: number };

const Client = dynamic(
  () =>
    import('@/components/dashboard/TeamAnalyticsModule.client')
      .then((mod) => {
        if (!mod || !mod.default) {
          console.error('TeamAnalyticsModule.client has no default export');
          return { default: (): React.ReactElement => <div>Failed to load module</div> };
        }
        return mod;
      })
      .catch((error) => {
        console.error('Failed to load TeamAnalyticsModule.client:', error);
        return { default: (): React.ReactElement => <div>Failed to load module</div> };
      }),
  {
    ssr: false,
    loading: (): React.ReactElement => <TeamAnalyticsSkeleton />,
  }
) as React.ComponentType<Props>;

export default function TeamAnalyticsModule(props: Props): React.ReactElement {
  return <Client {...props} />;
}
