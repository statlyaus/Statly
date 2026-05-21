// Server Component wrapper
import { Suspense } from 'react';

import dynamic from 'next/dynamic';

import { GroupedListSkeleton, FlatListSkeleton } from '@/components/ui';
import { ComponentErrorBoundary } from '@/components/ui/ErrorBoundary';

import type { InjuryData } from './InjuryListDisplay.client';

interface InjuryListDisplayProps {
  injuries: InjuryData[];
  groupByTeam?: boolean;
  virtualizeThreshold?: number;
}

const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 72;

export default function InjuryListDisplay(props: InjuryListDisplayProps) {
  const fallback =
    props.groupByTeam !== false ? (
      <GroupedListSkeleton
        headerHeight={HEADER_HEIGHT}
        rowHeight={ROW_HEIGHT}
        ariaLabel="Loading team injuries"
      />
    ) : (
      <FlatListSkeleton rowHeight={ROW_HEIGHT} ariaLabel="Loading injury list" />
    );

  const InjuryListClient = dynamic(
    () =>
      import('./InjuryListDisplay.client')
        .then((mod) => {
          if (!mod || !mod.default) {
            console.error('InjuryListDisplay.client has no default export');
            return { default: (): React.ReactElement => <div>Failed to load module</div> };
          }
          return mod;
        })
        .catch((error) => {
          console.error('Failed to load InjuryListDisplay.client:', error);
          return { default: (): React.ReactElement => <div>Failed to load module</div> };
        }),
    {
      ssr: false,
      loading: () => null,
    }
  );

  const errorFallback = (
    <div className="p-4 border border-destructive/20 bg-destructive/10 rounded-lg">
      <div className="font-semibold text-destructive">Failed to load injuries UI</div>
      <div className="text-sm text-destructive mt-1">Please check your connection and try again.</div>
      <button
        type="button"
        onClick={() => (typeof window !== 'undefined' ? window.location.reload() : undefined)}
        className="mt-3 inline-flex items-center px-3 py-1.5 text-sm rounded border border-destructive/20 text-destructive hover:bg-destructive/10"
      >
        Retry
      </button>
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      <ComponentErrorBoundary name="InjuryListClient" fallback={errorFallback}>
        <InjuryListClient {...props} />
      </ComponentErrorBoundary>
    </Suspense>
  );
}
