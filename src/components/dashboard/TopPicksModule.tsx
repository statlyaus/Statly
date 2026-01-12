import React from 'react';

import dynamic from 'next/dynamic';

import TopPicksSkeleton from '@/components/ui/skeletons/TopPicksSkeleton';

type Props = { refreshTrigger: number };

const Client = dynamic(
  () =>
    import('./TopPicksModule.client')
      .then((mod) => {
        if (!mod || !mod.default) {
          console.error('TopPicksModule.client has no default export');
          return { default: (): React.ReactElement => <div>Failed to load module</div> };
        }
        return mod;
      })
      .catch((error) => {
        console.error('Failed to load TopPicksModule.client:', error);
        return { default: (): React.ReactElement => <div>Failed to load module</div> };
      }),
  {
    ssr: false,
    loading: (): React.ReactElement => <TopPicksSkeleton count={8} rowHeight={96} />,
  }
) as React.ComponentType<Props>;

export default function TopPicksModule(props: Props): React.ReactElement {
  return <Client {...props} />;
}
