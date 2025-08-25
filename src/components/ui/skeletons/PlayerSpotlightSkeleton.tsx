import React from 'react';

export default function PlayerSpotlightSkeleton() {
  return (
    <div className="space-y-4" role="region" aria-busy="true" aria-label="Loading player spotlight">
      <div className="relative overflow-hidden rounded-lg p-4 bg-slate-200 motion-safe:animate-pulse h-28" aria-hidden="true" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-slate-100 rounded-lg p-3 text-center h-14 motion-safe:animate-pulse"
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="h-4 bg-slate-200 rounded w-24" aria-hidden="true" />
          <div className="h-5 bg-slate-200 rounded w-12" aria-hidden="true" />
        </div>
        <div className="h-12 bg-slate-200 rounded" aria-hidden="true" />
      </div>
      <div className="h-12 bg-yellow-100 rounded-lg motion-safe:animate-pulse" aria-hidden="true" />
      <div className="h-9 bg-blue-200 rounded-lg motion-safe:animate-pulse" aria-hidden="true" />
    </div>
  );
}
