import React from 'react';

import { GroupedListSkeleton } from './ListSkeletons';

export default function LiveInjuryFeedSkeleton() {
  return (
    <div className="space-y-4" role="region" aria-busy="true" aria-label="Loading live injury feed">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-5 w-40 bg-muted rounded" />
          <div className="h-5 w-24 bg-destructive/10 rounded" />
        </div>
        <div className="flex items-center space-x-2">
          <div className="h-8 w-36 bg-muted rounded" />
          <div className="h-8 w-8 bg-muted rounded" />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="h-3 w-40 bg-muted rounded" />
        <div className="h-3 w-28 bg-muted rounded" />
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
