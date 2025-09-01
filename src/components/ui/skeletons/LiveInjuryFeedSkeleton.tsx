import React from 'react';
import { GroupedListSkeleton } from './ListSkeletons';

export default function LiveInjuryFeedSkeleton() {
  return (
    <div className="space-y-4" role="region" aria-busy="true" aria-label="Loading live injury feed">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-5 w-40 bg-slate-200 rounded" />
          <div className="h-5 w-24 bg-red-200/70 rounded" />
        </div>
        <div className="flex items-center space-x-2">
          <div className="h-8 w-36 bg-slate-200 rounded" />
          <div className="h-8 w-8 bg-slate-200 rounded" />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <div className="h-3 w-40 bg-slate-200 rounded" />
        <div className="h-3 w-28 bg-slate-200 rounded" />
      </div>

      <GroupedListSkeleton
        headerHeight={44}
        rowHeight={72}
        groups={3}
        rowsPerGroup={3}
        ariaLabel="Injury list loading"
      />
    </div>
  );
}
