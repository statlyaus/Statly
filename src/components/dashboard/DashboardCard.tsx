'use client';

import React, { useId, type ReactNode } from 'react';

/**
 * Maps or sanitizes error messages to user-friendly text.
 * Extend this function as needed to handle more error types.
 */
function getUserFriendlyError(error: unknown): string {
  if (!error) return 'An unknown error occurred.';
  if (typeof error === 'string') {
    const lower = error.toLowerCase();
    if (lower.includes('network')) return 'Network error. Please check your connection.';
    if (lower.includes('unauthorized')) return 'You are not authorized to perform this action.';
    return 'Something went wrong. Please try again.';
  }
  if (error instanceof Error) return 'Something went wrong. Please try again.';
  return 'An unexpected error occurred.';
}

interface Props {
  title: string;
  actions?: ReactNode;
  isLoading?: boolean;
  error?: unknown;
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
  const headingId = useId();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <h3 id={headingId} className="text-lg font-semibold text-gray-900">
          {title}
        </h3>
        {actions}
      </div>
      <div className="p-4" aria-labelledby={headingId} aria-busy={isLoading ? true : undefined}>
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
            {getUserFriendlyError(error)}
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

