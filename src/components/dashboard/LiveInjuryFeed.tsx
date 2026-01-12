import React from 'react';

import dynamic from 'next/dynamic';

import LiveInjuryFeedSkeleton from '@/components/ui/skeletons/LiveInjuryFeedSkeleton';

type Props = {
  refreshTrigger: number;
  teamFilter?: string;
  userTeamPlayers?: string[];
  autoRefresh?: boolean;
};

const Client = dynamic<Props>(
  () =>
    import('./LiveInjuryFeed.client')
      .then((mod) => {
        if (!mod || !mod.default) {
          console.error('LiveInjuryFeed.client has no default export');
          return { default: (): React.ReactElement => <div>Failed to load module</div> };
        }
        return mod;
      })
      .catch((error) => {
        console.error('Failed to load LiveInjuryFeed.client:', error);
        return { default: (): React.ReactElement => <div>Failed to load module</div> };
      }),
  {
    ssr: false,
    loading: (): React.ReactElement => <LiveInjuryFeedSkeleton />,
  }
);

export default function LiveInjuryFeed(props: Props): React.ReactElement {
  return <Client {...props} />;
}
