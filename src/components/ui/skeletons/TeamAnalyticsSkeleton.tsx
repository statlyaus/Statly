import React from 'react';

interface SkeletonRowProps {
  leftClass: string; // e.g. "w-10 h-4"
  middleClass: string; // e.g. "h-4 w-40"
  rightClass: string; // e.g. "w-10 h-4"
  animate?: boolean;
}

function SkeletonRow({ leftClass, middleClass, rightClass, animate = false }: SkeletonRowProps) {
  return (
    <div
      className={`flex items-center justify-between py-1 ${animate ? 'motion-safe:animate-pulse' : ''}`}
      aria-hidden="true"
    >
      <div className="flex items-center gap-2">
        <div className={`bg-muted rounded ${leftClass}`} />
        <div className={`bg-muted rounded ${middleClass}`} />
      </div>
      <div className={`bg-muted rounded ${rightClass}`} />
    </div>
  );
}

export default function TeamAnalyticsSkeleton() {
  return (
    <div className="space-y-4" role="region" aria-busy="true" aria-label="Loading team analytics">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-info/10 rounded-lg p-3 animate-pulse">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 bg-info/10 rounded w-20 mb-2" />
              <div className="h-5 bg-info/10 rounded w-16" />
            </div>
            <div className="w-6 h-6 bg-info/10 rounded" />
          </div>
          <div className="mt-1 h-3 bg-info/10 rounded w-24" />
        </div>
        <div className="bg-success/10 rounded-lg p-3 animate-pulse">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 bg-success/10 rounded w-20 mb-2" />
              <div className="h-5 bg-success/10 rounded w-16" />
            </div>
            <div className="w-6 h-6 bg-success/10 rounded" />
          </div>
          <div className="mt-1 h-3 bg-success/10 rounded w-24" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-28" />
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonRow key={i} leftClass="w-10 h-4" middleClass="h-4 w-40" rightClass="w-10 h-4" />
        ))}
      </div>

      <div className="space-y-2">
        <div className="h-4 bg-muted rounded w-28" />
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonRow
            key={i}
            animate
            leftClass="w-12 h-5"
            middleClass="h-4 w-44"
            rightClass="w-10 h-4"
          />
        ))}
      </div>

      <div className="h-9 bg-info/10 rounded-lg" />
    </div>
  );
}
