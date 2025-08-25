import React from 'react';

export interface TopPicksSkeletonProps {
  count?: number;
  rowHeight?: number;
}

export function TopPicksSkeleton({ count = 8, rowHeight = 96 }: TopPicksSkeletonProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6" role="region" aria-busy="true" aria-label="Loading top picks">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Top Picks This Round</h3>
        <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">Loading...</span>
      </div>
      <div role="list" className="space-y-3">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            role="listitem"
            className="rounded-lg bg-gray-50 motion-safe:animate-pulse"
            style={{ height: rowHeight }}
          >
            <div className="h-full flex items-center justify-between px-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full" />
                <div>
                  <div className="h-4 bg-gray-200 rounded w-24 mb-1" />
                  <div className="h-3 bg-gray-200 rounded w-16" />
                </div>
              </div>
              <div className="flex space-x-2">
                {Array.from({ length: 5 }).map((__, i) => (
                  <div key={i} className="w-8 h-6 bg-gray-200 rounded" />
                ))}
              </div>
              <div className="text-right">
                <div className="h-4 bg-gray-200 rounded w-12 mb-1" />
                <div className="h-3 bg-gray-200 rounded w-8" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TopPicksSkeleton;
