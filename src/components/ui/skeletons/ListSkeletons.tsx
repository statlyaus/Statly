import { Skeleton } from '../LoadingSpinner';
import clsx from 'clsx';

export function GroupedListSkeleton({
  headerHeight = 44,
  rowHeight = 72,
  groups = 3,
  rowsPerGroup = 3,
  className,
  ariaLabel,
}: {
  headerHeight?: number;
  rowHeight?: number;
  groups?: number;
  rowsPerGroup?: number;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      className={clsx('space-y-4', className)}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      {Array.from({ length: groups }, (_, i) => (
        <div key={i} className="border border-slate-200 rounded-lg overflow-hidden animate-pulse">
          <div
            className="bg-slate-50 border-b border-slate-200 flex items-center px-4"
            style={{ height: headerHeight }}
          >
            <Skeleton width="w-32" height="h-4" />
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: rowsPerGroup }, (_, j) => (
              <div key={j} className="p-4" style={{ height: rowHeight }}>
                <Skeleton width="w-48" height="h-4" className="mb-2" />
                <Skeleton width="w-64" height="h-3" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FlatListSkeleton({
  rows = 8,
  rowHeight = 72,
  className,
  ariaLabel,
}: {
  rows?: number;
  rowHeight?: number;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      className={clsx(
        'border border-slate-200 rounded-lg overflow-hidden animate-pulse',
        className
      )}
      role="list"
      aria-busy
      aria-label={ariaLabel}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-b border-slate-200 p-4" style={{ height: rowHeight }}>
          <Skeleton width="w-40" height="h-4" className="mb-2" />
          <Skeleton width="w-64" height="h-3" />
        </div>
      ))}
    </div>
  );
}
