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

  const InjuryListClient = dynamic(() => import('./InjuryListDisplay.client'), {
    ssr: false,
    loading: () => null,
  });

  const errorFallback = (
    <div className="p-4 border border-red-200 bg-red-50 rounded-lg">
      <div className="font-semibold text-red-800">Failed to load injuries UI</div>
      <div className="text-sm text-red-700 mt-1">Please check your connection and try again.</div>
      <button
        type="button"
        onClick={() => (typeof window !== 'undefined' ? window.location.reload() : undefined)}
        className="mt-3 inline-flex items-center px-3 py-1.5 text-sm rounded border border-red-300 text-red-800 hover:bg-red-100"
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
