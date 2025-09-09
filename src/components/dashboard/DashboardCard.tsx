'use client';

import type { ReactNode } from 'react';

interface Props {
  title: string;
  actions?: ReactNode;
  isLoading?: boolean;
  error?: string;
  empty?: boolean;
  children?: ReactNode;
}

export default function DashboardCard({
  title,
  actions,
  isLoading,
  error,
  empty,
  children,
}: Props) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {actions}
      </div>
      <div className="p-4">
        {isLoading ? (
          <div
            className="h-20 animate-pulse bg-gray-100 rounded"
            role="status"
            aria-live="polite"
            aria-label="Loading"
            aria-busy="true"
          />
        ) : error ? (
          <div className="text-red-500" role="alert">
            {error}
          </div>
        ) : empty ? (
          <div className="text-gray-500" role="status" aria-live="polite">
            No data
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}