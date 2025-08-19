'use client';

import React from 'react';
import type { ReactNode } from 'react';
import Button from '@/components/Button';
import { ComponentErrorBoundary } from '@/components/ui/ErrorBoundary';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

// Custom fallback component for draft errors
function DraftErrorFallback({ error, resetError }: { error?: Error; resetError: () => void }) {
  const handleRetry = () => {
    resetError();
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-2">Draft Room Error</h2>

        <p className="text-gray-600 mb-6">
          Something went wrong with the draft room. This could be due to a connection issue or a
          temporary problem.
        </p>

        <div className="space-y-3">
          <Button onClick={handleRetry} className="w-full" variant="primary">
            Retry Draft Room
          </Button>

          <Button onClick={() => window.history.back()} className="w-full" variant="secondary">
            Go Back
          </Button>
        </div>

        {process.env.NODE_ENV === 'development' && error && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-sm text-gray-500">
              Error Details (Development)
            </summary>
            <pre className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto">
              {error.toString()}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export function DraftErrorBoundary({ children, fallback }: Props) {
  return (
    <ComponentErrorBoundary
      name="DraftErrorBoundary"
      fallback={fallback || <DraftErrorFallback error={undefined} resetError={() => {}} />}
      onError={(error, errorInfo, errorId) => {
        console.error('Draft Error Boundary caught an error:', { error, errorInfo, errorId });
      }}
    >
      {children}
    </ComponentErrorBoundary>
  );
}

export default DraftErrorBoundary;
